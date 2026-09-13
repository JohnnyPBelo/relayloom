package app

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func sendPhaseInTx(tx *groupstore.Tx, owner, operation string) (OutboxRecord, error) {
	state, err := profilestate.Read(tx)
	if err != nil || state == nil {
		return OutboxRecord{}, errors.New("fixture profile missing")
	}
	value, err := core.DecodeJSON(state.Bytes, privateLimit)
	if err != nil {
		return OutboxRecord{}, err
	}
	parsed, err := parsePrivate(value, owner)
	return parsed.Outbox[operation], err
}

func TestGroupSendLegacyPreviewRecovery(t *testing.T) {
	n, group, old := groupOutboxFixture(t)
	value := strings.Repeat("x", 159) + "🧶 surviving exact signed bytes"
	body := sendBody(7600, Content{"type": "message", "text": value, "conversation": group.ID, "groupEpoch": group.Head.ID, "groupAudience": "epoch"}, outboxReaders(old))
	result := apply(t, n, "send", body).(map[string]any)
	id := result["id"].(string)
	legacy, err := core.DecodeJSON([]byte(`"`+strings.Repeat("x", 159)+`\ud83e"`), 4096)
	if err != nil {
		t.Fatal(err)
	}
	if !outboxPreviewMatches(value, legacy.(string)) || outboxPreviewMatches(value, strings.Repeat("x", 158)) || outboxPreviewMatches(value, strings.Repeat("x", 159)+"?") {
		t.Fatal("legacy compatibility accepts incorrect prefixes")
	}
	// Only the authenticated preview projection is converted to the old Node
	// encoding. The actual API-created bundle and its signed bytes stay intact.
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		t.Fatal(err)
	}
	record := next.Outbox[operationFor(7600)]
	record.Preview = legacy.(string)
	next.Outbox[record.OperationID] = record
	if err := n.persistPrivateLocked(next); err != nil {
		t.Fatal(err)
	}
	n = restartFor(t, n)
	apply(t, n, "unlock", map[string]any{"password": password})
	item := outboxFor(t, n, record.OperationID)
	if item["id"] != id || item["status"] != "pending" {
		t.Fatal("legacy preview invalidated signed content", item)
	}
	if apply(t, n, "send", body).(map[string]any)["id"] != id {
		t.Fatal("legacy recovery replaced message")
	}
}

func groupSendFailureFixture(t *testing.T) (*Node, map[string]any, *transport.Router) {
	t.Helper()
	n, group, old := groupOutboxFixture(t)
	reader := outboxReaders(old)
	body := sendBody(7500, Content{"type": "message", "text": "Exact group send boundary", "conversation": group.ID, "groupEpoch": group.Head.ID, "groupAudience": "epoch"}, reader)
	body["ttlMs"] = 600000
	sink, err := transport.New(transport.Options{DisableRelay: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sink.Close() })
	address, err := sink.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	disconnect, err := n.Router.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(disconnect)
	if _, err := n.Router.Broadcast(map[string]any{"witness": "send-boundary-reachable"}, transport.Normal, 10*time.Second, false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := sink.Next(ctx)
	if err != nil || !strings.Contains(string(got.Payload), "send-boundary-reachable") {
		t.Fatal("TCP positive control failed", err)
	}
	return n, body, sink
}

func noGroupSendPacket(t *testing.T, sink *transport.Router) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	if got, err := sink.Next(ctx); err == nil {
		t.Fatalf("uncommitted/failed send reached socket: %s", got.Payload)
	}
}

func TestGroupSendCommitFailures(t *testing.T) {
	for _, phase := range []string{"preparing", "ready"} {
		for _, committed := range []bool{false, true} {
			name := phase + "-rollback"
			if committed {
				name = phase + "-lost-response"
			}
			t.Run(name, func(t *testing.T) {
				n, body, sink := groupSendFailureFixture(t)
				operation := text(body["operationId"])
				db, owner := n.privateDatabase, n.identity.Public.ID
				injected := errors.New("fixture send commit failure")
				var captured OutboxRecord
				hit := false
				n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
					boundary := false
					err := db.Update(func(tx *groupstore.Tx) error {
						before, err := sendPhaseInTx(tx, owner, operation)
						if err != nil {
							return err
						}
						if err := callback(tx); err != nil {
							return err
						}
						after, err := sendPhaseInTx(tx, owner, operation)
						if err != nil {
							return err
						}
						boundary = !hit && after.Phase == phase && before.Phase != phase
						if boundary {
							hit, captured = true, after
							if !committed {
								return injected
							}
						}
						return nil
					})
					if err == nil && boundary && committed {
						return injected
					}
					return err
				}
				if _, err := n.Handle("send", body); !errors.Is(err, injected) || !hit {
					t.Fatalf("boundary not exercised: %v", err)
				}
				n.updateGroupState = nil
				noGroupSendPacket(t, sink)
				if phase == "preparing" && !committed {
					if _, exists := n.private.Outbox[operation]; exists {
						t.Fatal("rolled-back intent survived")
					}
					if acceptedContent(t, n, *n.identity, captured.ID) != nil {
						t.Fatal("admission survived intent rollback")
					}
					// The same reachable socket must receive the subsequent committed send.
					result := apply(t, n, "send", body).(map[string]any)
					if result["id"] == captured.ID {
						t.Fatal("rolled-back bytes were reused")
					}
				} else {
					item := outboxFor(t, n, operation)
					if item["id"] != captured.ID || numberFor(t, item["attempts"]) != 0 {
						t.Fatal("recovery replaced intent or transmitted")
					}
					if phase == "preparing" {
						if item["status"] != "unavailable" {
							t.Fatal("missing payload was reconstructed")
						}
						if apply(t, n, "send", body).(map[string]any)["id"] != captured.ID {
							t.Fatal("repeat changed ID")
						}
						apply(t, n, "outbox-retry", map[string]any{"operationId": operation})
						noGroupSendPacket(t, sink)
						return
					}
					if item["status"] != "pending" {
						t.Fatal("stored exact payload did not recover")
					}
					apply(t, n, "outbox-retry", map[string]any{"operationId": operation})
				}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				got, err := sink.Next(ctx)
				if err != nil {
					t.Fatal("authorized retry did not reach TCP", err)
				}
				value, err := core.DecodeJSON(got.Payload, core.MaxBundleBytes+65536)
				if err != nil {
					t.Fatal(err)
				}
				payload, _ := object(value)
				wire, _ := core.Canonical(payload["bundle"])
				record := n.private.Outbox[operation]
				bundle, err := n.Store.GetWithTouch(record.ID, false)
				if err != nil {
					t.Fatal(err)
				}
				stored, _ := core.Canonical(bundle)
				if !bytes.Equal(wire, stored) {
					t.Fatal("transmission changed stored signed bytes")
				}
				if apply(t, n, "send", body).(map[string]any)["id"] != record.ID {
					t.Fatal("repeat changed ID")
				}
			})
		}
	}
}

func TestGroupSendContentIndexFailure(t *testing.T) {
	n, body, sink := groupSendFailureFixture(t)
	operation, db := text(body["operationId"]), n.privateDatabase
	index := filepath.Join(n.Dir, "store", "index.json")
	backup := index + ".fixture-backup"
	blocked := false
	var captured OutboxRecord
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		if err := db.Update(callback); err != nil {
			return err
		}
		if blocked {
			return nil
		}
		if err := db.Update(func(tx *groupstore.Tx) error {
			var err error
			captured, err = sendPhaseInTx(tx, n.identity.Public.ID, operation)
			return err
		}); err != nil {
			return err
		}
		if captured.Phase != "preparing" {
			return nil
		}
		if err := os.Rename(index, backup); err != nil {
			return err
		}
		if err := os.Mkdir(index, 0700); err != nil {
			return err
		}
		blocked = true
		return nil
	}
	_, sendErr := n.Handle("send", body)
	n.updateGroupState = nil
	if !blocked || sendErr == nil {
		t.Fatal("content index failure was not exercised", sendErr)
	}
	if err := os.Remove(index); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, index); err != nil {
		t.Fatal(err)
	}
	if n.identity == nil {
		apply(t, n, "unlock", map[string]any{"password": password})
	}
	item := outboxFor(t, n, operation)
	if item["id"] != captured.ID || item["status"] != "unavailable" || numberFor(t, item["attempts"]) != 0 {
		t.Fatal("store failure reopened send", item)
	}
	if _, err := n.Store.GetWithTouch(captured.ID, false); err != nil {
		t.Fatal("fixture must fail after actual payload write", err)
	}
	if apply(t, n, "send", body).(map[string]any)["id"] != captured.ID {
		t.Fatal("store failure repeat created new ID")
	}
	apply(t, n, "outbox-retry", map[string]any{"operationId": operation})
	noGroupSendPacket(t, sink)
}
