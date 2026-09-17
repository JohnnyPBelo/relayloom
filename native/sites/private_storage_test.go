package sites

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func privateFixture(t *testing.T, limits *groupstore.Limits) (string, core.Identity, *groupstore.Store) {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "site-private-go")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	owner := identity(t, "Go private site owner")
	path := filepath.Join(dir, "profile.sqlite")
	store, err := groupstore.Open(path, owner, groupstore.Options{Create: true, Limits: limits})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return path, owner, store
}
func mustPrivate(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func TestPrivateRecordsRestartReadingKeyAndHandle(t *testing.T) {
	path, owner, store := privateFixture(t, nil)
	key := "site:" + core.Hash([]byte("private")) + ":stage"
	value := map[string]any{"signature": "PRIVATE_SIGNATURE_CANARY", "text": strings.Repeat("x", 2*1024*1024)}
	var escaped *PrivateRecords
	mustPrivate(t, store.Update(func(tx *groupstore.Tx) error {
		return RunPrivate(tx, owner, func(r *PrivateRecords) error { escaped = r; return r.Write(key, value) })
	}))
	if escaped.Write(key, value) == nil {
		t.Fatal("expired handle wrote")
	}
	id, err := store.ID()
	mustPrivate(t, err)
	mustPrivate(t, store.Close())
	store, err = groupstore.Open(path, owner, groupstore.Options{ExpectedStoreID: id})
	mustPrivate(t, err)
	defer store.Close()
	mustPrivate(t, store.View(func(tx *groupstore.Tx) error {
		return RunPrivate(tx, owner, func(r *PrivateRecords) error {
			got, found, err := r.Read(key)
			if err != nil {
				return err
			}
			a, _ := core.Canonical(value)
			b, _ := core.Canonical(got)
			if !found || !bytes.Equal(a, b) {
				t.Fatal("restart changed private value")
			}
			keys, err := tx.Keys(key + ":")
			if err != nil {
				return err
			}
			ciphertext := []byte{}
			for _, k := range keys {
				part, _, err := tx.Get(k)
				if err != nil {
					return err
				}
				ciphertext = append(ciphertext, part...)
			}
			if bytes.Contains(ciphertext, []byte("PRIVATE_SIGNATURE_CANARY")) {
				t.Fatal("plaintext leaked")
			}
			reading, err := base64.StdEncoding.DecodeString(owner.BoxSecret)
			if err != nil {
				return err
			}
			wrong := *r
			wrong.secret = reading
			defer clear(reading)
			if _, err = wrong.decrypt(key, ciphertext); err == nil {
				t.Fatal("reading secret decrypted prepared signatures")
			}
			if _, err = r.decrypt(key, ciphertext); err != nil {
				return err
			}
			return nil
		})
	}))
}
func TestPrivateRecordsCapacityFailureCannotCommitPartialValues(t *testing.T) {
	_, owner, store := privateFixture(t, &groupstore.Limits{TotalBytes: 128 * 1024, ReserveBytes: 8192})
	first := "site:" + core.Hash([]byte("first")) + ":stage"
	other := "site:" + core.Hash([]byte("other")) + ":stage"
	mustPrivate(t, store.Update(func(tx *groupstore.Tx) error {
		return RunPrivate(tx, owner, func(r *PrivateRecords) error { return r.Write(first, "original") })
	}))
	err := store.Update(func(tx *groupstore.Tx) error {
		_ = RunPrivate(tx, owner, func(r *PrivateRecords) error {
			if err := r.Write(other, "partial"); err != nil {
				return err
			}
			_ = r.Write(first, strings.Repeat("x", 150*1024))
			return nil
		})
		return nil
	})
	if !errors.Is(err, groupstore.ErrCapacity) {
		t.Fatalf("capacity was not latched: %v", err)
	}
	mustPrivate(t, store.View(func(tx *groupstore.Tx) error {
		return RunPrivate(tx, owner, func(r *PrivateRecords) error {
			v, found, e := r.Read(first)
			if e != nil {
				return e
			}
			if !found || v != "original" {
				t.Fatal("old value lost")
			}
			_, found, e = r.Read(other)
			if found {
				t.Fatal("partial value escaped")
			}
			return e
		})
	}))
}
func TestPrivateRecordsSwapAndMissingFail(t *testing.T) {
	for _, mode := range []string{"swap", "missing"} {
		t.Run(mode, func(t *testing.T) {
			_, owner, store := privateFixture(t, nil)
			a := "site:" + core.Hash([]byte("a")) + ":stage"
			b := "site:" + core.Hash([]byte("b")) + ":stage"
			mustPrivate(t, store.Update(func(tx *groupstore.Tx) error {
				return RunPrivate(tx, owner, func(r *PrivateRecords) error {
					if err := r.Write(a, "first"); err != nil {
						return err
					}
					return r.Write(b, "other")
				})
			}))
			mustPrivate(t, store.Update(func(tx *groupstore.Tx) error {
				if mode == "missing" {
					return tx.Delete(privatePart(a, 0))
				}
				am, _, _ := tx.Get(a)
				bm, _, _ := tx.Get(b)
				av, _, _ := tx.Get(privatePart(a, 0))
				bv, _, _ := tx.Get(privatePart(b, 0))
				for k, v := range map[string][]byte{a: bm, b: am, privatePart(a, 0): bv, privatePart(b, 0): av} {
					if err := tx.Put(k, v, groupstore.Data); err != nil {
						return err
					}
				}
				return nil
			}))
			err := store.View(func(tx *groupstore.Tx) error {
				return RunPrivate(tx, owner, func(r *PrivateRecords) error { _, _, err := r.Read(a); return err })
			})
			if !errors.Is(err, groupstore.ErrIntegrity) {
				t.Fatalf("tampering accepted: %v", err)
			}
		})
	}
}
