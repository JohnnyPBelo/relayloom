package profilebinding

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func TestBindingOwnerStoreSourceAndPhases(t *testing.T) {
	owner, err := core.CreateIdentity("Owner")
	check(t, err)
	other, err := core.CreateIdentity("Other")
	check(t, err)
	prepared, err := Prepare(owner, core.Hash([]byte("store ID")), core.Hash([]byte("legacy ciphertext")))
	check(t, err)
	committed, err := Commit(owner, prepared)
	check(t, err)
	if prepared.Body.Phase != "prepared" || committed.Body.Phase != "committed" || committed.Body.Nonce != prepared.Body.Nonce || committed.Body.StoreID != prepared.Body.StoreID || committed.Body.SourceDigest != prepared.Body.SourceDigest || committed.ID == prepared.ID {
		t.Fatal("binding phase lost context")
	}
	data, err := core.Canonical(committed)
	check(t, err)
	_, err = Decode(data, owner.Public)
	check(t, err)
	if _, err = Decode(data, other.Public); err == nil {
		t.Fatal("wrong owner accepted")
	}
	if _, err = Commit(owner, committed); err == nil {
		t.Fatal("committed binding prepared again")
	}
	for _, change := range []string{"phase", "store", "source"} {
		bad := prepared
		switch change {
		case "phase":
			bad.Body.Phase = "committed"
		case "store":
			bad.Body.StoreID = core.Hash([]byte("swapped"))
		case "source":
			bad.Body.SourceDigest = core.Hash([]byte("other ciphertext"))
		}
		data, err = core.Canonical(bad)
		check(t, err)
		if _, err = Decode(data, owner.Public); err == nil {
			t.Fatal("modified binding accepted")
		}
	}
	wrong := owner
	wrong.SignSecret = other.SignSecret
	if _, err = Prepare(wrong, prepared.Body.StoreID, prepared.Body.SourceDigest); err == nil {
		t.Fatal("wrong signing key accepted")
	}
}
func TestPreassignedStoreIDDoesNotPermitReset(t *testing.T) {
	root := filepath.Join("..", "..", ".cache", "profile-binding-go")
	check(t, os.MkdirAll(root, 0700))
	dir, err := os.MkdirTemp(root, "case-")
	check(t, err)
	defer os.RemoveAll(dir)
	owner, err := core.CreateIdentity("Owner")
	check(t, err)
	path := filepath.Join(dir, "state.sqlite")
	id := core.Hash([]byte("preassigned ID"))
	store, err := groupstore.Open(path, owner, groupstore.Options{Create: true, NewStoreID: id})
	check(t, err)
	defer store.Close()
	actual, err := store.ID()
	check(t, err)
	if actual != id {
		t.Fatal("store changed signed intent ID")
	}
	if other, err := groupstore.Open(path, owner, groupstore.Options{Create: true, NewStoreID: id}); err == nil {
		other.Close()
		t.Fatal("reset accepted")
	}
	if other, err := groupstore.Open(path, owner, groupstore.Options{NewStoreID: id}); err == nil {
		other.Close()
		t.Fatal("new ID supplied during open")
	}
	check(t, store.Close())
	store, err = groupstore.Open(path, owner, groupstore.Options{ExpectedStoreID: id})
	check(t, err)
	check(t, store.Close())
}
