package profilestate

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func fixture(t *testing.T) (*groupstore.Store, string, core.Identity) {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "profile-state-go")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := core.CreateIdentity("Synthetic private state owner")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "state.sqlite")
	store, err := groupstore.Open(path, identity, groupstore.Options{Create: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close(); os.RemoveAll(dir) })
	return store, path, identity
}
func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func encoded(t *testing.T, value any) []byte {
	b, err := core.Canonical(value)
	check(t, err)
	return b
}
func put(t *testing.T, s *groupstore.Store, data []byte, expected *string) string {
	var digest string
	check(t, s.Update(func(tx *groupstore.Tx) error { var err error; digest, err = Write(tx, data, expected); return err }))
	return digest
}
func read(t *testing.T, s *groupstore.Store) *State {
	var state *State
	check(t, s.View(func(tx *groupstore.Tx) error { var err error; state, err = Read(tx); return err }))
	return state
}
func TestPersistedPrivateBytesAndAtomicShrink(t *testing.T) {
	store, path, identity := fixture(t)
	data := encoded(t, map[string]any{"private": string(bytes.Repeat([]byte("Secret household document "), 45000)), "unicode": "🌊"})
	digest := put(t, store, data, nil)
	if digest != core.Hash(data) {
		t.Fatal("wrong digest")
	}
	raw, err := os.ReadFile(path)
	check(t, err)
	if bytes.Contains(raw, []byte("Secret household document")) {
		t.Fatal("plaintext stored")
	}
	id, err := store.ID()
	check(t, err)
	check(t, store.Close())
	store, err = groupstore.Open(path, identity, groupstore.Options{ExpectedStoreID: id})
	check(t, err)
	defer store.Close()
	if !bytes.Equal(read(t, store).Bytes, data) {
		t.Fatal("private state changed")
	}
	before, err := store.Accounting()
	check(t, err)
	put(t, store, data, &digest)
	after, err := store.Accounting()
	check(t, err)
	if before.Revision != after.Revision {
		t.Fatal("duplicate rewrote state")
	}
	short := encoded(t, map[string]any{"private": "Short"})
	put(t, store, short, &digest)
	check(t, store.View(func(tx *groupstore.Tx) error {
		keys, err := tx.Keys(prefix)
		if len(keys) != 1 {
			t.Fatal("old chunks retained")
		}
		return err
	}))
	if !bytes.Equal(read(t, store).Bytes, short) {
		t.Fatal("shrink changed bytes")
	}
}
func TestPrivateStateAndFenceCommitOrRollbackWithCAS(t *testing.T) {
	store, _, _ := fixture(t)
	before := encoded(t, map[string]any{"value": 1})
	after := encoded(t, map[string]any{"value": 2})
	digest := put(t, store, before, nil)
	wrong := "wrong"
	if err := store.Update(func(tx *groupstore.Tx) error { _, err := Write(tx, after, &wrong); return err }); err == nil {
		t.Fatal("stale digest accepted")
	}
	err := store.Update(func(tx *groupstore.Tx) error {
		if _, err := Write(tx, after, &digest); err != nil {
			return err
		}
		if err := tx.Put("fence:group", []byte("left"), groupstore.Checkpoint); err != nil {
			return err
		}
		return errors.New("before commit")
	})
	if err == nil || !bytes.Equal(read(t, store).Bytes, before) {
		t.Fatal("rollback lost state")
	}
	check(t, store.View(func(tx *groupstore.Tx) error {
		_, exists, err := tx.Get("fence:group")
		if exists {
			t.Fatal("rollback kept fence")
		}
		return err
	}))
	check(t, store.Update(func(tx *groupstore.Tx) error {
		if _, err := Write(tx, after, &digest); err != nil {
			return err
		}
		return tx.Put("fence:group", []byte("left"), groupstore.Checkpoint)
	}))
	if !bytes.Equal(read(t, store).Bytes, after) {
		t.Fatal("commit lost state")
	}
}
func TestBrokenAndOrphanChunksFailClosed(t *testing.T) {
	for _, mode := range []string{"missing", "orphan", "hash"} {
		t.Run(mode, func(t *testing.T) {
			store, _, _ := fixture(t)
			put(t, store, encoded(t, map[string]any{"private": "Original"}), nil)
			check(t, store.Update(func(tx *groupstore.Tx) error {
				switch mode {
				case "missing":
					return tx.Delete(partKey(0))
				case "orphan":
					return tx.Delete(manifestKey)
				default:
					return tx.Put(partKey(0), encoded(t, map[string]any{"private": "Modified"}), groupstore.Data)
				}
			}))
			err := store.View(func(tx *groupstore.Tx) error { _, err := Read(tx); return err })
			if !errors.Is(err, groupstore.ErrIntegrity) {
				t.Fatalf("invalid state accepted: %v", err)
			}
			if err = store.View(func(tx *groupstore.Tx) error { return nil }); !errors.Is(err, groupstore.ErrUnavailable) {
				t.Fatal("handle not poisoned")
			}
		})
	}
}
func TestPrivateStateByteBounds(t *testing.T) {
	store, _, _ := fixture(t)
	data := encoded(t, string(bytes.Repeat([]byte("x"), MaxBytes-2)))
	if len(data) != MaxBytes {
		t.Fatal("boundary fixture mismatch")
	}
	digest := put(t, store, data, nil)
	before, err := store.Accounting()
	check(t, err)
	if err = store.Update(func(tx *groupstore.Tx) error { _, err := Write(tx, make([]byte, MaxBytes+1), &digest); return err }); err == nil {
		t.Fatal("oversize state accepted")
	}
	after, err := store.Accounting()
	check(t, err)
	if before.Revision != after.Revision || read(t, store).Digest != digest {
		t.Fatal("overflow mutated state")
	}
}
