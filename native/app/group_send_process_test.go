package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

// Only the cross-engine driver invokes this helper. Intentional os.Exit leaves
// real ownership and SQLite handles for OS recovery; no graceful close is run.
func TestGroupSendProcessExitFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_GROUP_SEND_FIXTURE")
	if path == "" {
		t.Skip("requires cross-engine group send driver")
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > 16384 {
		t.Fatal("invalid fixture file")
	}
	var request struct {
		Directory, Marker, Mode, Phase, Witness string
		Port                                    int
		Body                                    map[string]any
	}
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs(filepath.Join(os.Getenv("RELAYLOOM_GROUP_SEND_ROOT"), ".cache"))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{request.Directory, request.Marker} {
		path, err := filepath.Abs(value)
		if err != nil || !strings.HasPrefix(path, root+string(filepath.Separator)) {
			t.Fatal("invalid fixture scope")
		}
	}
	if (request.Mode != "before" && request.Mode != "after") || (request.Phase != "preparing" && request.Phase != "ready") {
		t.Fatal("invalid boundary")
	}
	n, err := NewNode(request.Directory)
	if err != nil {
		t.Fatal(err)
	}
	defer n.Close()
	apply(t, n, "unlock", map[string]any{"password": "relayloom integration passphrase"})
	n.cancel()
	n.wg.Wait()
	disconnect, err := n.Router.ConnectTCP(net.JoinHostPort("127.0.0.1", fmt.Sprint(request.Port)))
	if err != nil {
		t.Fatal(err)
	}
	defer disconnect()
	deadline := time.Now().Add(5 * time.Second)
	for len(n.Router.Peers()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := n.Router.Broadcast(map[string]any{"witness": request.Witness}, transport.Normal, 10*time.Second, false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ack, err := n.Router.Next(ctx)
	if err != nil {
		t.Fatal("TCP witness acknowledgement absent", err)
	}
	var acknowledgement struct {
		Type string
		IDs  []string
	}
	if err := json.Unmarshal(ack.Payload, &acknowledgement); err != nil || acknowledgement.Type != "request" || len(acknowledgement.IDs) != 1 || acknowledgement.IDs[0] != core.Hash([]byte(request.Witness)) {
		t.Fatal("wrong TCP witness acknowledgement", err)
	}
	exit := func(entry OutboxRecord) {
		marker := map[string]any{"mode": request.Mode, "phase": request.Phase, "id": entry.ID, "bundleHash": nil}
		if request.Phase == "ready" {
			bundle, err := n.Store.GetWithTouch(entry.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := core.Canonical(bundle)
			if err != nil {
				t.Fatal(err)
			}
			marker["bundleHash"] = core.Hash(encoded)
		}
		data, err := json.Marshal(marker)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(request.Marker, data, 0600); err != nil {
			t.Fatal(err)
		}
		if request.Mode == "before" {
			os.Exit(83)
		}
		os.Exit(84)
	}
	db, operation := n.privateDatabase, text(request.Body["operationId"])
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		var boundary *OutboxRecord
		err := db.Update(func(tx *groupstore.Tx) error {
			before, err := sendPhaseInTx(tx, n.identity.Public.ID, operation)
			if err != nil {
				return err
			}
			if err := callback(tx); err != nil {
				return err
			}
			after, err := sendPhaseInTx(tx, n.identity.Public.ID, operation)
			if err != nil {
				return err
			}
			if after.Phase == request.Phase && before.Phase != request.Phase {
				boundary = &after
				if request.Mode == "before" {
					exit(after)
				}
			}
			return nil
		})
		if err == nil && boundary != nil {
			exit(*boundary)
		}
		return err
	}
	apply(t, n, "send", request.Body)
	t.Fatal("process exit fixture missed its send boundary")
}
