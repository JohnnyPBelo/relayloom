package profilelock

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func directory(t *testing.T) string {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "profile-ownership-go")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}
func TestExclusiveOwnershipIndependentProfilesAndRestart(t *testing.T) {
	first, second := directory(t), directory(t)
	a, err := Acquire(first)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := Acquire(second)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if extra, err := Acquire(first); !errors.Is(err, ErrInUse) {
		if extra != nil {
			_ = extra.Close()
		}
		t.Fatalf("second owner: %v", err)
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := Acquire(first)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.Close(); err != nil {
		t.Fatal(err)
	}
}
func TestEmptyInitializationAndForeignFile(t *testing.T) {
	dir := directory(t)
	path := filepath.Join(dir, "profile-owner.sqlite")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	lease, err := Acquire(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = lease.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("foreign data"), 0600); err != nil {
		t.Fatal(err)
	}
	if other, err := Acquire(dir); err == nil {
		_ = other.Close()
		t.Fatal("foreign data accepted")
	}
}
