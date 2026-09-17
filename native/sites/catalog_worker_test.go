package sites

import (
	"encoding/json"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"os"
	"testing"
)

func TestCatalogInteropWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_SITE_CATALOG_INPUT")
	if path == "" {
		t.Skip("parent-owned catalog fixture")
	}
	data, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	var input struct {
		Database string            `json:"database"`
		StoreID  string            `json:"storeId"`
		Identity json.RawMessage   `json:"identity"`
		Output   string            `json:"output"`
		Commands []json.RawMessage `json:"commands"`
	}
	if e = json.Unmarshal(data, &input); e != nil {
		t.Fatal(e)
	}
	identity, e := core.DecodeIdentity(input.Identity)
	if e != nil {
		t.Fatal(e)
	}
	store, e := groupstore.Open(input.Database, identity, groupstore.Options{ExpectedStoreID: input.StoreID})
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	c := NewCatalog(store, identity)
	results := []any{}
	for _, raw := range input.Commands {
		value, e := core.DecodeJSON(raw, PrivateBytes)
		if e != nil {
			t.Fatal(e)
		}
		m := value.(map[string]any)
		action, name := docTextValue(m["action"]), docTextValue(m["name"])
		var result any
		h := OperationHandle{}
		if v, ok := m["handle"].(map[string]any); ok {
			h.Sequence, _ = recordNumber(v["sequence"])
			h.OperationID = docTextValue(v["operationId"])
			h.Fingerprint = docTextValue(v["fingerprint"])
		}
		switch action {
		case "state":
			result, e = c.State(identity.Public.ID, name)
		case "create":
			result, e = c.CreatePublication(name, m["request"])
		case "commit":
			result, e = c.Commit(name, h)
		case "ready":
			result, e = c.MarkReady(name, h)
		case "bundle":
			result, e = c.AuthorizedBundle(name, h)
		case "operation":
			result, e = c.Operation(name, h.Sequence, h.OperationID)
		default:
			t.Fatal("unknown worker action")
		}
		if e != nil {
			t.Fatal(e)
		}
		results = append(results, result)
	}
	encoded, e := core.Canonical(results)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(input.Output, encoded, 0600); e != nil {
		t.Fatal(e)
	}
}
