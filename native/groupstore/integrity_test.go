package groupstore

import (
	"errors"
	"testing"
)

func TestUnknownSchemaCannotHideBehindSQLitePrefix(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	_, err := s.db.Exec("CREATE TABLE sqliteXconcealed (value TEXT)")
	must(t, err)
	must(t, s.Close())
	loaded, err := Open(path, id, Options{})
	if err == nil {
		_ = loaded.Close()
		t.Fatal("unknown table with SQLite-like prefix was accepted")
	}
	if !errors.Is(err, ErrIntegrity) {
		t.Fatal(err)
	}
}

func TestIntegrityFailureStillPoisonsHandleAfterCallbackPanic(t *testing.T) {
	path, id := fixture(t)
	s := openFor(t, path, id, Options{Create: true})
	must(t, s.Update(func(tx *Tx) error { return tx.Put("left:group", []byte("left"), Checkpoint) }))
	var raw []byte
	must(t, s.db.QueryRow("SELECT payload FROM records").Scan(&raw))
	raw[len(raw)-1] ^= 1
	_, err := s.db.Exec("UPDATE records SET payload=?", raw)
	must(t, err)
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("expected replacement callback panic")
			}
		}()
		_ = s.Update(func(tx *Tx) error { _, _, _ = tx.Get("left:group"); panic("replacement callback panic") })
	}()
	if err = s.View(func(tx *Tx) error { return nil }); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}
