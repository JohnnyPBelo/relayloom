package groupstore

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func fixture(t *testing.T) (string, core.Identity) {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "group-storage-go")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(dir); err != nil {
			t.Error(err)
		}
	})
	identity, err := core.CreateIdentity("Synthetic Go storage owner")
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "registry.sqlite"), identity
}
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func openFor(t *testing.T, path string, id core.Identity, options Options) *Store {
	t.Helper()
	s, err := Open(path, id, options)
	must(t, err)
	t.Cleanup(func() { must(t, s.Close()) })
	return s
}
func readFor(t *testing.T, s *Store, key string) []byte {
	t.Helper()
	var value []byte
	must(t, s.View(func(tx *Tx) error {
		var err error
		var ok bool
		value, ok, err = tx.Get(key)
		if !ok && err == nil {
			return errors.New("expected value missing")
		}
		return err
	}))
	return value
}
func TestPersistentEncryptedRecordsAndRollback(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	private := []byte("Private membership title — saída local")
	var escaped *Tx
	must(t, s.Update(func(tx *Tx) error { escaped = tx; return tx.Put("head:a", private, Checkpoint) }))
	if _, _, err := escaped.Get("head:a"); !errors.Is(err, ErrTransaction) {
		t.Fatal(err)
	}
	if err := s.View(func(tx *Tx) error { return tx.Put("bad", nil, Data) }); !errors.Is(err, ErrTransaction) {
		t.Fatal(err)
	}
	stop := errors.New("abort")
	if err := s.Update(func(tx *Tx) error {
		if err := tx.Put("head:a", []byte("uncommitted"), Data); err != nil {
			return err
		}
		return stop
	}); !errors.Is(err, stop) {
		t.Fatal(err)
	}
	if err := s.Update(func(tx *Tx) error { return s.View(func(tx *Tx) error { return nil }) }); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	storeID, err := s.ID()
	must(t, err)
	must(t, s.Close())
	raw, err := os.ReadFile(path)
	must(t, err)
	if bytes.Contains(raw, private) || bytes.Contains(raw, []byte("head:a")) {
		t.Fatal("plaintext stored")
	}
	again := openFor(t, path, id, Options{ExpectedStoreID: storeID})
	if !bytes.Equal(readFor(t, again, "head:a"), private) {
		t.Fatal("reopen differs")
	}
	account, err := again.Accounting()
	must(t, err)
	if account.Revision != 1 {
		t.Fatal(account)
	}
	if _, err = Open(path, id, Options{ExpectedStoreID: core.Hash([]byte("different"))}); !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
}
func TestMissingDamagedStateAndWrongIdentityFailClosed(t *testing.T) {
	path, id := fixture(t)
	if _, err := Open(path, id, Options{}); !os.IsNotExist(err) {
		t.Fatal(err)
	}
	s := openFor(t, path, id, Options{Create: true})
	must(t, s.Close())
	original, err := os.ReadFile(path)
	must(t, err)
	other, err := core.CreateIdentity("Other owner")
	must(t, err)
	if _, err = Open(path, other, Options{}); !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
	bad := id
	bad.SignSecret = other.SignSecret
	if _, err = Open(path, bad, Options{}); !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
	if _, err = Open(path, id, Options{Create: true}); !os.IsExist(err) {
		t.Fatal(err)
	}
	current, err := os.ReadFile(path)
	must(t, err)
	if !bytes.Equal(current, original) {
		t.Fatal("failed open changed state")
	}
	must(t, os.WriteFile(path, nil, 0600))
	if _, err = Open(path, id, Options{}); !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
	current, err = os.ReadFile(path)
	must(t, err)
	if len(current) != 0 {
		t.Fatal("empty state was initialized")
	}
}
func TestReadingKeyCannotForgeLocalSigningFence(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	must(t, s.Update(func(tx *Tx) error { return tx.Put("left:a", []byte("left"), Checkpoint) }))
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	must(t, err)
	b, err := s.loadIndex(conn)
	must(t, err)
	b.Entries = make([]entry, 0)
	b.Revision++
	attacker, err := core.CreateIdentity("Unauthorized signer")
	must(t, err)
	attackerKeys, err := identityKeys(attacker)
	must(t, err)
	encoded, err := core.Canonical(b)
	must(t, err)
	signature := ed25519.Sign(attackerKeys.signer, encoded)
	if !ed25519.Verify(attackerKeys.verifier, encoded, signature) {
		t.Fatal("negative control signature is not genuine")
	}
	plain, err := core.Canonical(signedIndex{b, base64.StdEncoding.EncodeToString(signature)})
	must(t, err)
	envelope, err := s.keys.seal(plain, s.keys.aad(b.StoreID, "@index", 0))
	must(t, err)
	decrypted, err := s.keys.unseal(envelope, s.keys.aad(b.StoreID, "@index", 0))
	must(t, err)
	if !bytes.Equal(decrypted, plain) {
		t.Fatal("AEAD control failed")
	}
	_, err = conn.ExecContext(ctx, "UPDATE checkpoint SET payload=?", envelope)
	must(t, err)
	_, err = conn.ExecContext(ctx, "DELETE FROM records")
	must(t, err)
	must(t, conn.Close())
	must(t, s.Close())
	if _, err = Open(path, id, Options{}); !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
}
func TestSwallowedRowTamperingStillAbortsAndPoisonsHandle(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	must(t, s.Update(func(tx *Tx) error { return tx.Put("head:a", []byte("original"), Checkpoint) }))
	var raw []byte
	must(t, s.db.QueryRow("SELECT payload FROM records").Scan(&raw))
	raw[len(raw)-1] ^= 1
	_, err := s.db.Exec("UPDATE records SET payload=?", raw)
	must(t, err)
	err = s.Update(func(tx *Tx) error { _, _, _ = tx.Get("head:a"); return nil })
	if !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
	if err = s.Update(func(tx *Tx) error { return nil }); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}
func TestAADBindsStoreRecordAndRevision(t *testing.T) {
	_, id := fixture(t)
	k, err := identityKeys(id)
	must(t, err)
	storeID, err := randomID()
	must(t, err)
	envelope, err := k.seal([]byte("private bytes"), k.aad(storeID, "head:a", 1))
	must(t, err)
	for _, aad := range [][]byte{k.aad(storeID, "head:b", 1), k.aad(storeID, "head:a", 2), k.aad(core.Hash([]byte("other store")), "head:a", 1)} {
		if _, err = k.unseal(envelope, aad); !errors.Is(err, ErrIntegrity) {
			t.Fatal(err)
		}
	}
	plain, err := k.unseal(envelope, k.aad(storeID, "head:a", 1))
	must(t, err)
	if string(plain) != "private bytes" {
		t.Fatal("positive control failed")
	}
}
func TestQuotaRefusalCanAtomicallySaveCheckpointReserve(t *testing.T) {
	path, id := fixture(t)
	l := Limits{32768, 8192}
	s := openFor(t, path, id, Options{Create: true, Limits: &l})
	must(t, s.Update(func(tx *Tx) error { return tx.Put("ordinary", bytes.Repeat([]byte{7}, 22500), Data) }))
	before, err := s.Accounting()
	must(t, err)
	if err = s.Update(func(tx *Tx) error { return tx.Put("overflow", make([]byte, 2200), Data) }); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	after, err := s.Accounting()
	must(t, err)
	if after.Revision != before.Revision {
		t.Fatal("failed quota committed")
	}
	must(t, s.Update(func(tx *Tx) error {
		if err := tx.Put("ordinary", make([]byte, 25000), Data); !errors.Is(err, ErrCapacity) {
			return errors.New("ordinary reserve was consumed")
		}
		old, ok, err := tx.Get("ordinary")
		if err != nil {
			return err
		}
		if !ok || len(old) != 22500 || old[0] != 7 {
			return errors.New("refused write changed SQL")
		}
		return tx.Put("frozen:group", make([]byte, 4000), Checkpoint)
	}))
	after, err = s.Accounting()
	must(t, err)
	if after.OrdinaryBytes != before.OrdinaryBytes || after.SerializedBytes >= after.TotalBytes {
		t.Fatal(after)
	}
	if err = s.Update(func(tx *Tx) error { return tx.Put("too-large-stop", make([]byte, 8000), Checkpoint) }); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	must(t, s.Close())
	again := openFor(t, path, id, Options{})
	if len(readFor(t, again, "frozen:group")) != 4000 {
		t.Fatal("checkpoint lost")
	}
}
func TestPartialIndexReplayFailsWhileFullValidBackupRemainsLimitation(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	must(t, s.Update(func(tx *Tx) error { return tx.Put("head:a", []byte("old"), Checkpoint) }))
	backup, err := os.ReadFile(path)
	must(t, err)
	var oldIndex []byte
	must(t, s.db.QueryRow("SELECT payload FROM checkpoint").Scan(&oldIndex))
	must(t, s.Update(func(tx *Tx) error { return tx.Put("head:a", []byte("new"), Checkpoint) }))
	_, err = s.db.Exec("UPDATE checkpoint SET payload=?", oldIndex)
	must(t, err)
	if err = s.View(func(tx *Tx) error { _, _, e := tx.Get("head:a"); return e }); !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
	must(t, s.Close())
	must(t, os.WriteFile(path, backup, 0600))
	again := openFor(t, path, id, Options{})
	if string(readFor(t, again, "head:a")) != "old" {
		t.Fatal("test must expose full authenticated rollback limitation")
	}
}
func TestPanicRollsBackAndReleasesTransaction(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("expected callback panic")
			}
		}()
		_ = s.Update(func(tx *Tx) error {
			if err := tx.Put("uncommitted", []byte("private"), Data); err != nil {
				t.Fatal(err)
			}
			panic("test crash")
		})
	}()
	must(t, s.View(func(tx *Tx) error {
		_, found, err := tx.Get("uncommitted")
		if found {
			return errors.New("panic committed")
		}
		return err
	}))
}
