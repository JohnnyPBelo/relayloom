package app

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOwnerOutcomeBudgetWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_OWNER_OUTCOME_BUDGET_FORM")
	if path == "" {
		t.Skip("parent-owned form fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 16384 {
		t.Fatal("bounded form fixture", err)
	}
	payload, err := core.DecodeJSON(data, 16384)
	if err != nil {
		t.Fatal(err)
	}
	for _, constrained := range []bool{false, true} {
		func() {
			n, _ := nodeFor(t, "Receipt budget owner")
			n.mu.Lock()
			defer n.mu.Unlock()
			visitor, err := core.CreateIdentity("Receipt budget visitor")
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().UnixMilli()
			content, err := sites.CreateContent(*n.identity, "profile", 1, []string{}, payload)
			if err != nil {
				t.Fatal(err)
			}
			source, err := core.CreateBundleAt(*n.identity, "site", content, nil, true, 3600000, now)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = n.Store.Put(source, true); err != nil {
				t.Fatal(err)
			}
			resolved, err := sites.ResolveContributionForm(map[string]any{"action": "form", "snapshotId": source.Manifest.ID, "pageId": "entry", "formId": "form"}, source, content, visitor.Public.ID, now)
			if err != nil {
				t.Fatal(err)
			}
			schema, err := sites.ContributionSchemaHash(resolved.Context.Form, resolved.Context.Table)
			if err != nil {
				t.Fatal(err)
			}
			runtime, err := n.contributionsLocked()
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 5; i++ {
				proposal, err := sites.CreateContribution(visitor, map[string]any{"target": resolved.Context.Target, "schemaHash": schema, "operationId": operationFor(i + 1), "created": now, "expires": now + 180000, "values": map[string]any{"name": "batch", "count": 0, "open": false}, "publicationScope": "public"})
				if err != nil {
					t.Fatal(err)
				}
				bundle, err := core.CreateBundleAt(visitor, "site-contribution", map[string]any{"type": "site-contribution", "proposal": proposal}, []core.PublicIdentity{n.identity.Public}, false, 180000, now)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = runtime.incoming.Admit(bundle, runtime.policy); err != nil {
					t.Fatal(err)
				}
				if i < 4 {
					if _, err = runtime.incoming.AttachSource(proposal["id"].(string), source, runtime.policy); err != nil {
						t.Fatal(err)
					}
				}
				state, err := runtime.incoming.State()
				if err != nil {
					t.Fatal(err)
				}
				revision, err := number(state["revision"])
				if err != nil {
					t.Fatal(err)
				}
				if _, err = runtime.incoming.Reject(proposal["id"].(string), revision, "Declined", runtime.policy); err != nil {
					t.Fatal(err)
				}
			}
			original := n.Store
			if constrained {
				n.Store, err = core.NewContentStore(filepath.Join(n.Dir, "quota-control"), 1, core.MaxStoredObjects)
				if err != nil {
					t.Fatal(err)
				}
			}
			if err = runtime.tick(); err != nil {
				t.Fatal(err)
			}
			first, err := runtime.incoming.State()
			if err != nil {
				t.Fatal(err)
			}
			pool := func(state map[string]any) []map[string]any {
				out := []map[string]any{}
				for _, raw := range state["entries"].([]any) {
					e := raw.(map[string]any)
					for _, kind := range []string{"receipt", "rejection"} {
						if op, ok := e[kind].(map[string]any); ok {
							out = append(out, op)
						}
					}
				}
				return out
			}
			count := func(state map[string]any, phase string, copied bool) int {
				result := 0
				for _, op := range pool(state) {
					if op["phase"] != phase {
						continue
					}
					if copied {
						m, ok := op["transport"].(map[string]any)
						if !ok || m["copied"] != true {
							continue
						}
					}
					result++
				}
				return result
			}
			if count(first, "queued", false) != 8 || count(first, "prepared", false) != 1 {
				t.Fatal("receipt budget did not leave the ninth pending")
			}
			wanted := 8
			if constrained {
				wanted = 0
			}
			if len(runtime.published) != wanted {
				t.Fatal("copy failures published a receipt")
			}
			ids := []string{}
			for _, op := range pool(first) {
				if m, ok := op["transport"].(map[string]any); ok {
					ids = append(ids, text(m["bundleId"]))
				}
			}
			n.Store = original
			runtime.nextRetry = 0
			if err = runtime.tick(); err != nil {
				t.Fatal(err)
			}
			second, err := runtime.incoming.State()
			if err != nil {
				t.Fatal(err)
			}
			wanted = 9
			if constrained {
				wanted = 8
			}
			if count(second, "queued", false) != 9 || count(second, "queued", true) != wanted {
				t.Fatal("second batch lost pending copy")
			}
			for i, id := range ids {
				e := pool(second)[i]
				if e["transport"].(map[string]any)["bundleId"] != id {
					t.Fatal("retry rewrote envelope")
				}
			}
			runtime.nextRetry = 0
			if err = runtime.tick(); err != nil {
				t.Fatal(err)
			}
			final, err := runtime.incoming.State()
			if err != nil {
				t.Fatal(err)
			}
			if count(final, "queued", true) != 9 || len(runtime.published) != 9 {
				t.Fatal("third batch lost or duplicated receipt")
			}
		}()
	}
	encoded, _ := core.Canonical(map[string]any{"normal": true, "copyQuota": true, "preservedEnvelopeIDs": true})
	if err = os.WriteFile(path+".result.json", encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
