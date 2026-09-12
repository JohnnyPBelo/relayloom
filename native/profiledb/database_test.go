package profiledb

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilebinding"
	"github.com/JohnnyPBelo/relayloom/native/profilelock"
)

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func fixture(t *testing.T) (string, core.Identity, Legacy) {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "profile-db-go")
	check(t, os.MkdirAll(root, 0700))
	dir, err := os.MkdirTemp(root, "case-")
	check(t, err)
	identity, err := core.CreateIdentity("Synthetic profile owner")
	check(t, err)
	lease, err := profilelock.Acquire(dir)
	check(t, err)
	t.Cleanup(func() { lease.Close(); os.RemoveAll(dir) })
	data, err := core.Canonical(map[string]any{"mutations": map[string]any{}})
	check(t, err)
	return dir, identity, Legacy{data, core.Hash([]byte("synthetic legacy ciphertext identifier"))}
}
func TestMigrationBindingAndCommittedNoFallback(t *testing.T) {
	dir, identity, legacy := fixture(t)
	load := func() (Legacy, error) { return legacy, nil }
	db, err := Open(dir, identity, load)
	check(t, err)
	defer db.Close()
	state, err := db.Read()
	check(t, err)
	if !bytes.Equal(state.Bytes, legacy.Bytes) || db.Binding().Body.Phase != "committed" || db.Binding().Body.SourceDigest != legacy.SourceDigest {
		t.Fatal("migration lost source binding")
	}
	next, err := core.Canonical(map[string]any{"private": "Changed after migration"})
	check(t, err)
	_, err = db.Write(next, state.Digest)
	check(t, err)
	check(t, db.Close())
	db, err = Open(dir, identity, func() (Legacy, error) { return Legacy{}, errors.New("must not use legacy fallback") })
	check(t, err)
	defer db.Close()
	state, err = db.Read()
	check(t, err)
	if !bytes.Equal(state.Bytes, next) {
		t.Fatal("new state lost")
	}
}
func TestMissingSwappedOrUnboundDatabaseIsNotReset(t *testing.T) {
	for _, mode := range []string{"missing", "swapped", "unbound"} {
		t.Run(mode, func(t *testing.T) {
			dir, identity, legacy := fixture(t)
			path := filepath.Join(dir, "profile-state.sqlite")
			load := func() (Legacy, error) { return legacy, nil }
			if mode == "unbound" {
				store, err := groupstore.Open(path, identity, groupstore.Options{Create: true})
				check(t, err)
				check(t, store.Close())
				if db, err := Open(dir, identity, load); err == nil {
					db.Close()
					t.Fatal("unbound database reset")
				}
				return
			}
			db, err := Open(dir, identity, load)
			check(t, err)
			check(t, db.Close())
			check(t, os.Rename(path, path+".preserved"))
			if mode == "swapped" {
				store, err := groupstore.Open(path, identity, groupstore.Options{Create: true})
				check(t, err)
				check(t, store.Close())
			}
			if db, err := Open(dir, identity, load); err == nil {
				db.Close()
				t.Fatal("initialized database reset")
			}
			if _, err := os.Stat(path + ".preserved"); err != nil {
				t.Fatal("preserved database removed")
			}
		})
	}
}
func TestPreparedResumeAndChangedSourceRefusal(t *testing.T) {
	for _, emptyDB := range []bool{false, true} {
		t.Run(map[bool]string{false: "no-db", true: "empty-db"}[emptyDB], func(t *testing.T) {
			dir, identity, legacy := fixture(t)
			binding, err := profilebinding.Prepare(identity, core.Hash([]byte("prepared store")), legacy.SourceDigest)
			check(t, err)
			check(t, writeBinding(filepath.Join(dir, "profile-binding.json"), binding))
			if emptyDB {
				store, err := groupstore.Open(filepath.Join(dir, "profile-state.sqlite"), identity, groupstore.Options{Create: true, NewStoreID: binding.Body.StoreID})
				check(t, err)
				check(t, store.Close())
			}
			different := legacy
			different.SourceDigest = core.Hash([]byte("changed legacy"))
			if db, err := Open(dir, identity, func() (Legacy, error) { return different, nil }); err == nil {
				db.Close()
				t.Fatal("changed source accepted")
			}
			db, err := Open(dir, identity, func() (Legacy, error) { return legacy, nil })
			check(t, err)
			defer db.Close()
			state, err := db.Read()
			check(t, err)
			if !bytes.Equal(state.Bytes, legacy.Bytes) || db.Binding().Body.Phase != "committed" {
				t.Fatal("prepared state failed recovery")
			}
		})
	}
}
func TestInitializationMarkerCannotBeDeletedThroughTransaction(t *testing.T) {
	dir, identity, legacy := fixture(t)
	load := func() (Legacy, error) { return legacy, nil }
	db, err := Open(dir, identity, load)
	check(t, err)
	if err = db.Update(func(tx *groupstore.Tx) error { return tx.Delete(initializationKey) }); !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatalf("missing marker accepted: %v", err)
	}
	check(t, db.Close())
	db, err = Open(dir, identity, load)
	check(t, err)
	defer db.Close()
	state, err := db.Read()
	check(t, err)
	if !bytes.Equal(state.Bytes, legacy.Bytes) {
		t.Fatal("rollback lost private state")
	}
}
