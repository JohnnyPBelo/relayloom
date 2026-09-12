package app

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestProfileOwnershipAndStaleNodeAfterClose(t *testing.T) {
	node, _ := nodeFor(t, "Alice")
	dir := node.Dir
	if second, err := NewNode(dir); err == nil {
		second.Close()
		t.Fatal("concurrent owner accepted")
	}
	var wait sync.WaitGroup
	failures := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func() { defer wait.Done(); failures <- node.Close() }()
	}
	wait.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	restored, err := NewNode(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	apply(t, restored, "unlock", map[string]any{"password": password})
	if _, err = node.State(); err == nil {
		t.Fatal("closed node returned mutable state")
	}
	if _, err = node.Handle("unlock", map[string]any{"password": password}); err == nil {
		t.Fatal("stale node unlocked")
	}
	if err = node.Start(0, "127.0.0.1"); err == nil {
		t.Fatal("stale node listened")
	}
}
func TestProfileConstructorFailureReleasesOwnership(t *testing.T) {
	dir := tempDir(t)
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte("invalid-json"), 0600); err != nil {
		t.Fatal(err)
	}
	if node, err := NewNode(dir); err == nil {
		node.Close()
		t.Fatal("invalid config accepted")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "invalid-json" {
		t.Fatal("constructor reset config")
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	node, err := NewNode(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = node.Close(); err != nil {
		t.Fatal(err)
	}
}
