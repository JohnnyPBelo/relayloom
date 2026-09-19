package core

import (
	"path/filepath"
	"testing"
	"time"
)

func TestHistoricalReadDoesNotPrimeLiveCache(t *testing.T) {
	dir := testDirectory(t)
	owner := identityFor(t, "Autora histórica")
	store, err := NewContentStore(dir, 1024*1024, MaxStoredObjects)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	b, err := CreateBundleAt(owner, "post", map[string]any{"type": "post", "text": "historical"}, nil, true, 1000, now-5000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Put(b, false); err == nil {
		t.Fatal("expired bytes admitted as live")
	}
	bytes, err := Canonical(b)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "objects", b.Manifest.ID+".json")
	if err = AtomicWrite(path, bytes); err != nil {
		t.Fatal(err)
	}
	// Model retained historical bytes with a corrupt future expiry hint.
	store.index[b.Manifest.ID] = storeEntry{Size: int64(len(bytes)), Expires: now + 60000, Accessed: now}
	if !store.HasRecord(b.Manifest.ID) {
		t.Fatal("lost record")
	}
	historical, err := store.GetStored(b.Manifest.ID)
	if err != nil {
		t.Fatal(err)
	}
	requireSameJSON(t, historical, b)
	if _, err = store.Get(b.Manifest.ID); err == nil {
		t.Fatal("expired object became readable as live")
	}
	if len(store.List()) != 0 {
		t.Fatal("historical read primed the live cache")
	}
	b.Chunks[b.Manifest.Chunks[0].Hash] = "Y29ycnVwdA=="
	bytes, _ = Canonical(b)
	if err = AtomicWrite(path, bytes); err != nil {
		t.Fatal(err)
	}
	if _, err = store.GetStored(b.Manifest.ID); err == nil {
		t.Fatal("corrupt historical bytes accepted")
	}
	live := bundleFor(t, owner, map[string]any{"type": "post", "text": "live control"})
	if _, err = store.Put(live, false); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get(live.Manifest.ID); err != nil {
		t.Fatal(err)
	}
	if list := store.List(); len(list) != 1 || list[0].ID != live.Manifest.ID {
		t.Fatal("live control failed")
	}
}
