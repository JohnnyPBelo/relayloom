package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"path/filepath"
	"testing"
	"time"
)

func samplePayload(title string) map[string]any {
	return map[string]any{"type": "site", "blocks": []any{}, "theme": "sand", "site": map[string]any{"version": 1, "title": title, "description": "Real catalog test", "home": "home", "design": map[string]any{"font": "sans", "width": "standard", "radius": "soft", "accent": "#207a70"}, "pages": []any{map[string]any{"id": "home", "slug": "inicio", "title": "Início", "blocks": []any{}}}}}
}
func requestFor(t *testing.T, c *Catalog, title string, readers any) map[string]any {
	t.Helper()
	s, e := c.State(c.identity.Public.ID, "profile")
	mustPrivate(t, e)
	return map[string]any{"sequence": *s.NextSequence, "operationId": "00000000-0000-0000-0000-000000000001", "expectedBase": s.Base, "payload": samplePayload(title), "readers": readers, "ttlMs": 3600000}
}
func TestCatalogLogicalRecoveryAndReaderScope(t *testing.T) {
	for _, public := range []bool{true, false} {
		t.Run(map[bool]string{true: "public", false: "private"}[public], func(t *testing.T) {
			path, owner, store := privateFixture(t, nil)
			reader := identity(t, "Go site reader")
			c := NewCatalog(store, owner)
			readers := any("public")
			if !public {
				readers = []core.PublicIdentity{reader.Public}
			}
			request := requestFor(t, c, "Original 🧶", readers)
			prepared, e := c.CreatePublication("profile", request)
			mustPrivate(t, e)
			if prepared.Phase != "prepared" || !prepared.Requested {
				t.Fatal("no preparation")
			}
			if _, e = c.AuthorizedBundle("profile", prepared.OperationHandle); e == nil {
				t.Fatal("prepared bytes escaped")
			}
			committed, e := c.Commit("profile", prepared.OperationHandle)
			mustPrivate(t, e)
			if committed.Phase != "committed" {
				t.Fatal("no authorization")
			}
			id, e := store.ID()
			mustPrivate(t, e)
			mustPrivate(t, store.Close())
			store, e = groupstore.Open(path, owner, groupstore.Options{ExpectedStoreID: id})
			mustPrivate(t, e)
			defer store.Close()
			c = NewCatalog(store, owner)
			bundle, e := c.AuthorizedBundle("profile", prepared.OperationHandle)
			mustPrivate(t, e)
			decoded, e := core.DecryptBundle(bundle, &reader)
			mustPrivate(t, e)
			verified, e := VerifyContent(decoded, owner.Public, "profile")
			mustPrivate(t, e)
			if verified.Revision.Body.Number != 1 {
				t.Fatal("wrong version")
			}
			contentStore, e := core.NewContentStore(filepath.Join(filepath.Dir(path), "content"), 16*1024*1024, 64)
			mustPrivate(t, e)
			_, e = contentStore.Put(bundle, true)
			mustPrivate(t, e)
			actual, e := contentStore.Get(bundle.Manifest.ID)
			mustPrivate(t, e)
			if !equalValue(actual, bundle) {
				t.Fatal("public copy changed")
			}
			ready, e := c.MarkReady("profile", prepared.OperationHandle)
			mustPrivate(t, e)
			again, e := c.CreatePublication("profile", request)
			mustPrivate(t, e)
			if ready.Phase != "ready" || again.BundleID != bundle.Manifest.ID || again.Phase != "ready" {
				t.Fatal("replay created different result")
			}
			state, e := c.State(owner.Public.ID, "profile")
			mustPrivate(t, e)
			if *state.NextSequence != 2 || len(state.Pending) != 0 {
				t.Fatal("sequence changed")
			}
		})
	}
}
func TestCatalogExpiryAndBaseConfirmation(t *testing.T) {
	_, owner, store := privateFixture(t, nil)
	c := NewCatalog(store, owner)
	clock := time.Now().UnixMilli()
	c.now = func() int64 { return clock }
	q := requestFor(t, c, "Expires", "public")
	q["ttlMs"] = 1000
	op, e := c.CreatePublication("profile", q)
	mustPrivate(t, e)
	_, e = c.Commit("profile", op.OperationHandle)
	mustPrivate(t, e)
	clock += 1001
	s, e := c.State(owner.Public.ID, "profile")
	mustPrivate(t, e)
	if s.Number != 1 || len(s.Pending) != 0 || *s.NextSequence != 2 {
		t.Fatal("expiry forgot authority")
	}
	ended, e := c.CreatePublication("profile", q)
	mustPrivate(t, e)
	if ended.Phase != "expired" {
		t.Fatal("expired request not recovered")
	}
	next := requestFor(t, c, "Pending change", "public")
	next["operationId"] = "00000000-0000-0000-0000-000000000002"
	pending, e := c.CreatePublication("profile", next)
	mustPrivate(t, e)
	other, e := CreateContent(owner, "profile", 2, []string{s.Heads[0].ID}, samplePayload("Other device"))
	mustPrivate(t, e)
	bundle, e := core.CreateBundleAt(owner, "site", other, nil, true, 3600000, clock)
	mustPrivate(t, e)
	_, e = c.Observe(bundle, "profile")
	mustPrivate(t, e)
	stopped, e := c.Commit("profile", pending.OperationHandle)
	mustPrivate(t, e)
	if stopped.Phase != "superseded" {
		t.Fatal("stale prepared page published")
	}
}
func TestCatalogForkRequiresExplicitHeadsAndObservationIsIdempotent(t *testing.T) {
	_, owner, store := privateFixture(t, nil)
	c := NewCatalog(store, owner)
	for _, title := range []string{"one", "two"} {
		content, e := CreateContent(owner, "profile", 1, []string{}, samplePayload(title))
		mustPrivate(t, e)
		bundle, e := core.CreateBundle(owner, "site", content, nil, true, 3600000)
		mustPrivate(t, e)
		_, e = c.Observe(bundle, "profile")
		mustPrivate(t, e)
		before, e := store.Accounting()
		mustPrivate(t, e)
		_, e = c.Observe(bundle, "profile")
		mustPrivate(t, e)
		after, e := store.Accounting()
		mustPrivate(t, e)
		if before.Revision != after.Revision {
			t.Fatal("duplicate changed catalog")
		}
	}
	state, e := c.State(owner.Public.ID, "profile")
	mustPrivate(t, e)
	if state.Status != "conflict" {
		t.Fatal("fork lost")
	}
	request := requestFor(t, c, "Chosen merged snapshot", "public")
	if _, e = c.CreatePublication("profile", request); e == nil {
		t.Fatal("implicit conflict resolution")
	}
	heads := []string{}
	for _, h := range state.Heads {
		heads = append(heads, h.ID)
	}
	request["confirmedHeads"] = heads
	op, e := c.CreatePublication("profile", request)
	mustPrivate(t, e)
	if op.Sequence != 2 {
		t.Fatal("wrong successor")
	}
}
