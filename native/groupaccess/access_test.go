package groupaccess

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestScopeLifetimeAndMutationInvalidation(t *testing.T) {
	root := filepath.Join("..", "..", ".cache", "group-access-go")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	identity, err := core.CreateIdentity("Scope owner")
	if err != nil {
		t.Fatal(err)
	}
	store, err := groupstore.Open(filepath.Join(dir, "state.sqlite"), identity, groupstore.Options{Create: true})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	standalone, err := groupauthority.New(store, identity)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := New(standalone, identity.Public); err == nil {
		t.Fatal("accepted an independent transaction registry")
	}
	var escaped *Access
	var group, epoch string
	err = store.Update(func(tx *groupstore.Tx) error {
		_, err := groupauthority.InTransaction(tx, identity, func(g *groupauthority.Registry) error {
			access, err := New(g, identity.Public)
			if err != nil {
				return err
			}
			escaped = access
			created, err := g.Create("11111111-1111-4111-8111-111111111111", "Scope")
			if err != nil {
				return err
			}
			group = created.GroupID
			epoch = *created.EpochID
			before, err := access.Retry(group, epoch)
			if err != nil {
				return err
			}
			if !before.Allowed {
				t.Fatal("current group not authorized")
			}
			if _, err := g.Close("22222222-2222-4222-8222-222222222222", group, epoch); err != nil {
				return err
			}
			after, err := access.Retry(group, epoch)
			if err != nil {
				return err
			}
			if after.Allowed || !after.Terminal || after.Reason != "group-closed" {
				t.Fatalf("stale permission after close: %+v", after)
			}
			return nil
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := escaped.Retry(group, epoch); err == nil {
		t.Fatal("escaped cache authorized after scope ended")
	}
}

func TestBindingPresenceAndStrictHistoricalPayload(t *testing.T) {
	for _, value := range []map[string]any{{"groupEpoch": nil}, {"groupAudience": []any{"epoch"}}, {"targetEpoch": false}} {
		if !HasBinding(value) {
			t.Fatal("falsy group tag became legacy")
		}
		if _, err := ParseBinding(value); err == nil {
			t.Fatal("malformed binding accepted")
		}
	}
	valid := map[string]any{"type": "receipt", "conversation": core.Hash([]byte("group")), "groupAudience": "historical", "target": core.Hash([]byte("target")), "targetEpoch": core.Hash([]byte("epoch"))}
	if _, err := ParseBinding(valid); err != nil {
		t.Fatal(err)
	}
	valid["text"] = "not a content-free receipt"
	if _, err := ParseBinding(valid); err == nil {
		t.Fatal("new payload smuggled through historical receipt")
	}
}
