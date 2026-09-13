package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

// Invoked only by the bounded cross-runtime driver. Exit is intentional: it
// must leave real SQLite/profile ownership handles for the OS to recover.
func TestGroupOutboxProcessExitFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_GROUP_OUTBOX_FIXTURE")
	if path == "" {
		t.Skip("requires the cross-runtime process fixture")
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > 4096 {
		t.Fatal("invalid fixture file")
	}
	var request struct{ Directory, Mode, OperationID, GroupID, EpochID, Marker string }
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs(filepath.Join(os.Getenv("RELAYLOOM_GROUP_OUTBOX_ROOT"), ".cache"))
	if err != nil {
		t.Fatal(err)
	}
	directory, err := filepath.Abs(request.Directory)
	if err != nil || !strings.HasPrefix(directory, root+string(filepath.Separator)) || (request.Mode != "before" && request.Mode != "after") {
		t.Fatal("invalid fixture scope")
	}
	n, err := NewNode(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer n.Close()
	apply(t, n, "unlock", map[string]any{"password": "relayloom integration passphrase"})
	database := n.privateDatabase
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		if request.Mode == "before" {
			return database.Update(func(tx *groupstore.Tx) error {
				if err := callback(tx); err != nil {
					return err
				}
				if err := os.WriteFile(request.Marker, []byte("before"), 0600); err != nil {
					return err
				}
				os.Exit(81)
				return nil
			})
		}
		if err := database.Update(callback); err != nil {
			return err
		}
		if err := os.WriteFile(request.Marker, []byte("after"), 0600); err != nil {
			return err
		}
		os.Exit(82)
		return nil
	}
	apply(t, n, "group-command", map[string]any{"action": "close", "operationId": request.OperationID, "groupId": request.GroupID, "expected": request.EpochID})
	t.Fatal("process exit fixture did not reach its commit boundary")
}
