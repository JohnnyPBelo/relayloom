package sites

import (
	"encoding/json"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"os"
	"testing"
)

type inboxCrashDatabase struct{ store *groupstore.Store }

func (d inboxCrashDatabase) Update(fn func(*groupstore.Tx) error) error {
	return d.store.Update(func(tx *groupstore.Tx) error {
		if err := fn(tx); err != nil {
			return err
		}
		os.Exit(83)
		return nil
	})
}
func TestContributionInboxCatalogWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_INBOX_CATALOG_CONTROL")
	if path == "" {
		t.Skip("parent-owned encrypted profile")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 16*1024*1024 {
		t.Fatal("bounded fixture required", err)
	}
	var input struct {
		Database string          `json:"database"`
		StoreID  string          `json:"storeId"`
		Identity core.Identity   `json:"identity"`
		Now      *int64          `json:"now"`
		Action   string          `json:"action"`
		Envelope json.RawMessage `json:"envelope"`
		Source   json.RawMessage `json:"source"`
		ID       string          `json:"id"`
		Revision int64           `json:"revision"`
		Blocked  bool            `json:"blocked"`
		Crash    string          `json:"crash"`
		Output   string          `json:"output"`
	}
	if err = json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	store, err := groupstore.Open(input.Database, input.Identity, groupstore.Options{ExpectedStoreID: input.StoreID})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var database CatalogDatabase = store
	if input.Crash == "before-commit" {
		database = inboxCrashDatabase{store}
	}
	c := NewContributionInbox(database, input.Identity)
	if input.Now != nil {
		c.now = func() int64 { return *input.Now }
	}
	allow := func(string, string) error {
		if input.Blocked {
			return errors.New("fixture policy block")
		}
		return nil
	}
	var result any
	switch input.Action {
	case "state":
		result, err = c.State()
	case "dismiss":
		result, err = c.Dismiss(input.ID, input.Revision)
	case "read":
		result, err = c.Read(input.ID, allow)
	case "admit":
		var b core.Bundle
		b, err = core.DecodeBundle(input.Envelope)
		if err == nil {
			result, err = c.Admit(b, allow)
		}
	case "source":
		var b core.Bundle
		b, err = core.DecodeBundle(input.Source)
		if err == nil {
			result, err = c.AttachSource(input.ID, b, allow)
		}
	default:
		t.Fatal("unknown inbox action")
	}
	if err == nil && input.Crash == "after-command" {
		os.Exit(83)
	}
	var output any
	if err != nil {
		output = map[string]any{"error": err.Error(), "integrity": errors.Is(err, groupstore.ErrIntegrity)}
	} else {
		output = map[string]any{"value": result}
	}
	encoded, err := core.Canonical(output)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(input.Output, encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
