package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"os"
	"path/filepath"
	"testing"
)

type resourceCrashDatabase struct {
	store  *groupstore.Store
	before bool
}

func (d resourceCrashDatabase) Update(fn func(*groupstore.Tx) error) error {
	return d.store.Update(func(tx *groupstore.Tx) error {
		err := fn(tx)
		if err == nil && d.before {
			os.Exit(81)
		}
		return err
	})
}
func TestResourceCatalogWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_RESOURCE_CATALOG_CONTROL")
	if path == "" {
		t.Skip("parent-owned process worker")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 16*1024*1024 {
		t.Fatal("bounded control required", err)
	}
	v, err := core.DecodeJSON(data, 16*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	input, ok := v.(map[string]any)
	if !ok {
		t.Fatal("control object required")
	}
	encoded, err := core.Canonical(input["identity"])
	if err != nil {
		t.Fatal(err)
	}
	identity, err := core.DecodeIdentity(encoded)
	if err != nil {
		t.Fatal(err)
	}
	database, err := groupstore.Open(docTextValue(input["database"]), identity, groupstore.Options{ExpectedStoreID: docTextValue(input["storeId"])})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	mode := docTextValue(input["mode"])
	catalog := NewResourceCatalog(resourceCrashDatabase{database, mode == "before-commit"}, identity)
	resolve := func(scope any) ([]core.PublicIdentity, bool, error) {
		if input["denyResolver"] == true {
			t.Fatal("retained request attempted to resolve/sign again")
		}
		public, ids, err := resourceScope(scope)
		if err != nil {
			return nil, false, err
		}
		if public {
			return nil, true, nil
		}
		cards := []core.PublicIdentity{}
		for _, id := range ids {
			if id == identity.Public.ID {
				cards = append(cards, identity.Public)
				continue
			}
			matched := false
			if others, ok := input["readers"].([]any); ok {
				for _, other := range others {
					b, e := core.Canonical(other)
					if e != nil {
						return nil, false, e
					}
					card, e := core.DecodePublicIdentity(b)
					if e != nil {
						return nil, false, e
					}
					if card.ID == id {
						cards = append(cards, card)
						matched = true
						break
					}
				}
			}
			if !matched {
				return nil, false, creationError()
			}
		}
		return cards, false, nil
	}
	commands, ok := input["commands"].([]any)
	if !ok || len(commands) > 256 {
		t.Fatal("bounded commands required")
	}
	results := []any{}
	for _, raw := range commands {
		command := raw.(map[string]any)
		var value any
		switch docTextValue(command["action"]) {
		case "prepare":
			value, err = catalog.Prepare(command["request"], resolve)
		case "state":
			value, err = catalog.State()
		case "bundle", "ready":
			h := command["handle"].(map[string]any)
			handle := resourceHandle(h)
			if command["action"] == "bundle" {
				value, err = catalog.AuthorizedBundle(handle)
			} else {
				b, e := core.Canonical(command["bundle"])
				if e != nil {
					t.Fatal(e)
				}
				bundle, e := core.DecodeBundle(b)
				if e != nil {
					t.Fatal(e)
				}
				value, err = catalog.Ready(handle, bundle)
			}
		case "create-copy":
			var op map[string]any
			op, err = catalog.Prepare(command["request"], resolve)
			if err != nil {
				break
			}
			if mode == "after-commit" {
				os.Exit(82)
			}
			var bundle *core.Bundle
			bundle, err = catalog.AuthorizedBundle(resourceHandle(op))
			if err != nil {
				break
			}
			store, e := core.NewContentStore(filepath.Join(filepath.Dir(docTextValue(input["database"])), "store"), 16*1024*1024, 64)
			if e != nil {
				t.Fatal(e)
			}
			if _, err = store.Put(*bundle, false); err != nil {
				break
			}
			if mode == "after-copy" {
				os.Exit(83)
			}
			var copied core.Bundle
			copied, err = store.Get(bundle.Manifest.ID)
			if err != nil {
				break
			}
			value, err = catalog.Ready(resourceHandle(op), copied)
			if err == nil && mode == "after-ready" {
				os.Exit(84)
			}
		default:
			t.Fatal("unknown resource fixture command")
		}
		if err != nil {
			t.Fatal(err)
		}
		results = append(results, value)
	}
	output, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(docTextValue(input["output"]), output, 0600); err != nil {
		t.Fatal(err)
	}
}
