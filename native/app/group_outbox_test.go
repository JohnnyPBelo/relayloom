package app

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

// Fixtures install a valid signed/admitted message and intent. The scope here
// is runtime stop/recovery, not dynamic sending or P2P control-carrier delivery.
func groupOutboxFixture(t *testing.T) (*Node, groupauthority.View, OutboxRecord) {
	t.Helper()
	n, identity, group, _ := groupContentFixture(t)
	reader, err := core.CreateIdentity("Reader")
	if err != nil {
		t.Fatal(err)
	}
	var snapshot *groups.GroupSnapshot
	err = n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		_, err := groupledger.Run(tx, identity, func(l *groupledger.Ledger, g *groupauthority.Registry) error {
			anchor, err := g.Anchor(group.ID)
			if err != nil {
				return err
			}
			invitation, err := groups.CreateInvitation(identity, anchor, *group.Head, reader.Public)
			if err != nil {
				return err
			}
			consent, err := groups.AcceptInvitation(reader, anchor, *group.Head, invitation)
			if err != nil {
				return err
			}
			_, err = g.Commit(operationFor(501), group.ID, group.Head.ID, groups.Update{Title: "Outbox", Members: []core.PublicIdentity{identity.Public, reader.Public}, Joins: []groups.GroupConsent{consent}})
			if err != nil {
				return err
			}
			group, err = g.State(group.ID)
			if err != nil {
				return err
			}
			snapshot, err = g.PrivateState(group.ID, group.Head.ID)
			return err
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	b := contentMessage(t, identity, group, snapshot, group.Head.ID)
	if _, err := n.Store.PutReserved(b, false); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	encoded, _ := core.Canonical(b)
	stopped := false
	entry := OutboxRecord{OperationID: operationFor(502), Fingerprint: core.Hash([]byte("fixture intent")), ID: b.Manifest.ID,
		Author: identity.Public.ID, Conversation: group.ID, Preview: "Commit before display", Created: b.Manifest.Created,
		Expires: b.Manifest.Expires, Priority: "normal", Bytes: int64(len(encoded)), Phase: "ready", Confirmations: map[string]Confirmation{reader.Public.ID: {}}, GroupEpoch: group.Head.ID, GroupStopped: &stopped}
	next, err := copyPrivate(n.private, identity.Public.ID)
	if err != nil {
		t.Fatal(err)
	}
	next.Outbox[entry.OperationID] = entry
	if err := n.persistPrivateLocked(next); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	return n, group, entry
}

func closeOutboxGroup(n *Node, group groupauthority.View) (any, error) {
	return n.Handle("group-command", map[string]any{"action": "close", "operationId": operationFor(503), "groupId": group.ID, "expected": group.Head.ID})
}

func TestGroupOutboxMissingSnapshotPausesWithoutLosingAvailability(t *testing.T) {
	n, group, entry := groupOutboxFixture(t)
	snapshot := apply(t, n, "group-command", map[string]any{"action": "private-state", "groupId": group.ID, "epochId": group.Head.ID}).(map[string]any)["snapshot"].(*groups.GroupSnapshot)
	anchor := apply(t, n, "group-command", map[string]any{"action": "proofs", "groupId": group.ID, "from": 0}).(map[string]any)["anchor"].(groups.GroupAnchor)
	successor, err := groups.CreateSuccessor(*n.identity, anchor, *group.Head, *snapshot, groups.Update{Title: "Awaiting proof", Members: snapshot.Members, Joins: []groups.GroupConsent{}})
	if err != nil {
		t.Fatal(err)
	}
	apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": group.ID, "headers": []groups.GroupEpoch{successor.Epoch}})
	item := outboxFor(t, n, entry.OperationID)
	if item["status"] != "pending" || item["retained"] != true || n.private.Outbox[entry.OperationID].Phase != "ready" || n.groupRetries[entry.OperationID].Allowed || n.groupRetries[entry.OperationID].Stop != nil {
		t.Fatal("missing proof became lost content or retry permission")
	}
	apply(t, n, "group-command", map[string]any{"action": "snapshot", "groupId": group.ID, "epochId": successor.Epoch.ID, "snapshot": successor.Snapshot})
	outboxFor(t, n, entry.OperationID)
	if !n.groupRetries[entry.OperationID].Allowed {
		t.Fatal("valid successor did not restore retry permission")
	}
	if err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		return tx.Delete("snapshot:" + group.ID + ":" + group.Head.Body.SnapshotHash)
	}); err != nil {
		t.Fatal(err)
	}
	outboxFor(t, n, entry.OperationID)
	if len(n.groupHolds) != 1 || n.private.Outbox[entry.OperationID].Phase != "ready" {
		t.Fatal("missing historical proof lost availability or quarantine")
	}
	apply(t, n, "group-command", map[string]any{"action": "snapshot", "groupId": group.ID, "epochId": group.Head.ID, "snapshot": snapshot})
	outboxFor(t, n, entry.OperationID)
	if !n.groupRetries[entry.OperationID].Allowed || len(n.groupHolds) != 0 || len(n.Store.Reservations()) != 1 {
		t.Fatal("proof recovery retained obsolete hold or lost pending reserve")
	}
}

func TestGroupOutboxMinimalStopAndManualPinSurviveReopen(t *testing.T) {
	n, group, entry := groupOutboxFixture(t)
	if outboxFor(t, n, entry.OperationID)["status"] != "pending" || !equalIDs(n.Store.Reservations(), []string{entry.ID}) {
		t.Fatal("fixture has no pending reserved message")
	}
	if err := n.pinOutboxLocked(entry.ID, true); err != nil {
		t.Fatal(err)
	}
	before, err := n.privateDatabase.Read()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := closeOutboxGroup(n, group); err != nil {
		t.Fatal(err)
	}
	after, err := n.privateDatabase.Read()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before.Bytes, after.Bytes) || before.Digest != after.Digest {
		t.Fatal("minimal stop rewrote private document")
	}
	if outboxFor(t, n, entry.OperationID)["status"] != "superseded" || len(n.Store.Reservations()) != 0 || !n.Store.IsPinned(entry.ID) {
		t.Fatal("stop lost its projection or manual pin")
	}
	stop := n.groupRetries[entry.OperationID].Stop
	apply(t, n, "lock", nil)
	apply(t, n, "unlock", map[string]any{"password": password})
	if outboxFor(t, n, entry.OperationID)["status"] != "superseded" || n.groupRetries[entry.OperationID].Stop.Observed != stop.Observed {
		t.Fatal("reopen lost immutable stop")
	}
	apply(t, n, "outbox-retry", map[string]any{"operationId": entry.OperationID})
	if n.private.Outbox[entry.OperationID].Attempts != 0 {
		t.Fatal("stopped retry attempted transmission")
	}
}

func TestGroupOutboxStopAndAuthorityShareFailureBoundary(t *testing.T) {
	for _, committed := range []bool{false, true} {
		name := "rollback"
		if committed {
			name = "lost-commit-response"
		}
		t.Run(name, func(t *testing.T) {
			n, group, entry := groupOutboxFixture(t)
			db := n.privateDatabase
			injected := errors.New("fixture commit failure")
			n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
				if committed {
					if err := db.Update(callback); err != nil {
						return err
					}
					return injected
				}
				return db.Update(func(tx *groupstore.Tx) error {
					if err := callback(tx); err != nil {
						return err
					}
					return injected
				})
			}
			if _, err := closeOutboxGroup(n, group); !errors.Is(err, injected) {
				t.Fatalf("wrong failure: %v", err)
			}
			n.updateGroupState = nil
			status := "pending"
			groupStatus := "active"
			if committed {
				status = "superseded"
				groupStatus = "closed"
			}
			if outboxFor(t, n, entry.OperationID)["status"] != status {
				t.Fatal("outbox ignored actual commit")
			}
			state := apply(t, n, "group-command", map[string]any{"action": "state", "groupId": group.ID}).(map[string]any)["group"].(groupauthority.View)
			if state.Status != groupStatus {
				t.Fatal("authority and stop split")
			}
			if (len(n.Store.Reservations()) == 0) != committed {
				t.Fatal("reservation did not follow the actual commit")
			}
		})
	}
}

func TestGroupOutboxStopCommitsWithFullNormalQuota(t *testing.T) {
	n, group, entry := groupOutboxFixture(t)
	err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		for index := 0; ; index++ {
			a, err := tx.Accounting()
			if err != nil {
				return err
			}
			remaining := a.TotalBytes - a.ReserveBytes - a.OrdinaryBytes
			if remaining <= 400 {
				return nil
			}
			if err := tx.Put("test-fill:"+operationFor(index), make([]byte, min(500000, remaining-400)), groupstore.Data); err != nil {
				return err
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	before, err := n.privateDatabase.Read()
	if err != nil {
		t.Fatal(err)
	}
	err = n.privateDatabase.Update(func(tx *groupstore.Tx) error { return tx.Put("test-overflow", make([]byte, 4096), groupstore.Data) })
	if !errors.Is(err, groupstore.ErrCapacity) {
		t.Fatalf("normal growth control did not fail: %v", err)
	}
	if _, err := closeOutboxGroup(n, group); err != nil {
		t.Fatal(err)
	}
	after, err := n.privateDatabase.Read()
	if err != nil {
		t.Fatal(err)
	}
	if before.Digest != after.Digest || !bytes.Equal(before.Bytes, after.Bytes) {
		t.Fatal("stop depended on a private rewrite")
	}
	apply(t, n, "lock", nil)
	apply(t, n, "unlock", map[string]any{"password": password})
	if outboxFor(t, n, entry.OperationID)["status"] != "superseded" {
		t.Fatal("quota reopened a stopped send")
	}
}

func TestGroupOutboxRejectsForgedMirrorBindingAndOrphan(t *testing.T) {
	for _, mode := range []string{"mirror", "binding", "orphan"} {
		t.Run(mode, func(t *testing.T) {
			n, group, entry := groupOutboxFixture(t)
			if mode != "mirror" {
				if _, err := closeOutboxGroup(n, group); err != nil {
					t.Fatal(err)
				}
			}
			next, err := copyPrivate(n.private, n.identity.Public.ID)
			if err != nil {
				t.Fatal(err)
			}
			current := next.Outbox[entry.OperationID]
			switch mode {
			case "mirror":
				v := true
				current.GroupStopped = &v
				next.Outbox[entry.OperationID] = current
			case "binding":
				current.GroupEpoch = core.Hash([]byte("wrong epoch"))
				next.Outbox[entry.OperationID] = current
			case "orphan":
				delete(next.Outbox, entry.OperationID)
			}
			data, err := core.Canonical(next)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = n.privateDatabase.Write(data, n.privateDigest); err != nil {
				t.Fatal(err)
			}
			apply(t, n, "lock", nil)
			if _, err := n.Handle("unlock", map[string]any{"password": password}); err == nil || n.identity != nil {
				t.Fatal("corrupt stop relation opened")
			}
		})
	}
}

func TestGroupOutboxBoundedMirrorSchema(t *testing.T) {
	n, _, entry := groupOutboxFixture(t)
	records := map[string]OutboxRecord{}
	for index := 0; index < 256; index++ {
		current := entry
		current.OperationID = operationFor(index)
		current.ID = core.Hash([]byte(current.OperationID))
		stopped := index < 128
		current.GroupStopped = &stopped
		records[current.OperationID] = current
	}
	value, err := cloneValue(records)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = parseOutbox(value, n.identity.Public.ID, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	record := entry
	stopped := true
	record.GroupStopped = &stopped
	for id := range record.Confirmations {
		record.Confirmations[id] = Confirmation{ReceivedAt: 10, ReadAt: 20}
	}
	if n.outboxItemLocked(record, record.Expires+1, false)["status"] != "read" {
		t.Fatal("stop erased historical delivery facts")
	}
}

func TestGroupOutboxRestrictivePrefixWithInvalidTail(t *testing.T) {
	n, group, entry := groupOutboxFixture(t)
	var anchor groups.GroupAnchor
	err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		_, err := groupledger.Run(tx, *n.identity, func(_ *groupledger.Ledger, g *groupauthority.Registry) error {
			var err error
			anchor, err = g.Anchor(group.ID)
			return err
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	closed, err := groups.CloseGroup(*n.identity, anchor, *group.Head)
	if err != nil {
		t.Fatal(err)
	}
	invalid := closed
	invalid.Signature = "invalid"
	result := apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": group.ID, "headers": []groups.GroupEpoch{closed, invalid}}).(map[string]any)
	raw, err := cloneValue(result)
	if err != nil {
		t.Fatal(err)
	}
	value, _ := object(raw)
	observation, _ := object(value["observation"])
	if observation["rejected"] == nil {
		t.Fatal("invalid suffix was not reported")
	}
	if outboxFor(t, n, entry.OperationID)["status"] != "superseded" || len(n.Store.Reservations()) != 0 {
		t.Fatal("restrictive prefix failed to stop intent")
	}
}

func TestGroupOutboxStopCancelsActualLocalTransportQueue(t *testing.T) {
	for _, stop := range []bool{true, false} {
		name := "stop"
		if !stop {
			name = "negative-control-delivers"
		}
		t.Run(name, func(t *testing.T) {
			n, group, entry := groupOutboxFixture(t)
			bundle, err := n.Store.GetWithTouch(entry.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			// The fixture has already stopped its sync worker. Queue an actual packet
			// before either route exists, then exercise the production group command.
			if _, err := n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Bulk, 10*time.Second, false); err != nil {
				t.Fatal(err)
			}
			if stop {
				if _, err := closeOutboxGroup(n, group); err != nil {
					t.Fatal(err)
				}
			}
			sink, err := transport.New(transport.Options{DisableRelay: true})
			if err != nil {
				t.Fatal(err)
			}
			defer sink.Close()
			address, err := sink.ListenTCP("127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			disconnect, err := n.Router.ConnectTCP(address.String())
			if err != nil {
				t.Fatal(err)
			}
			defer disconnect()
			if _, err := n.Router.Broadcast(map[string]any{"witness": "reachable"}, transport.Normal, 10*time.Second, false); err != nil {
				t.Fatal(err)
			}
			count := 1
			if !stop {
				count = 2
			}
			witness, original := false, false
			for i := 0; i < count; i++ {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				got, err := sink.Next(ctx)
				cancel()
				if err != nil {
					t.Fatal(err)
				}
				witness = witness || strings.Contains(string(got.Payload), "reachable")
				original = original || strings.Contains(string(got.Payload), entry.ID)
			}
			if !witness || original == stop {
				t.Fatal("runtime stop did not control its queued packet")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			if _, err := sink.Next(ctx); err == nil {
				t.Fatal("stopped packet arrived later")
			}
		})
	}
}

func TestGroupOutboxServeChecksCompletedAuthorAuthority(t *testing.T) {
	for _, mode := range []string{"active", "closed", "locked"} {
		t.Run(mode, func(t *testing.T) {
			n, group, entry := groupOutboxFixture(t)
			next, err := copyPrivate(n.private, n.identity.Public.ID)
			if err != nil {
				t.Fatal(err)
			}
			record := next.Outbox[entry.OperationID]
			for id := range record.Confirmations {
				record.Confirmations[id] = Confirmation{ReceivedAt: time.Now().UnixMilli()}
			}
			next.Outbox[entry.OperationID] = record
			if err := n.persistPrivateLocked(next); err != nil {
				t.Fatal(err)
			}
			if mode == "closed" {
				if _, err := closeOutboxGroup(n, group); err != nil {
					t.Fatal(err)
				}
			}
			witness, err := core.CreateBundle(*n.identity, "post", Content{"type": "post", "text": "request witness"}, nil, true, 60000)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := n.Store.Put(witness, false); err != nil {
				t.Fatal(err)
			}
			// Reopening provides actual application receive/sync workers; the original
			// transaction-failure fixture intentionally kept those workers stopped.
			current := restartFor(t, n)
			if mode != "locked" {
				apply(t, current, "unlock", map[string]any{"password": password})
			}
			if err := current.Start(0, "127.0.0.1"); err != nil {
				t.Fatal(err)
			}
			sink, err := transport.New(transport.Options{DisableRelay: true})
			if err != nil {
				t.Fatal(err)
			}
			defer sink.Close()
			address, err := sink.ListenTCP("127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			disconnect, err := current.Router.ConnectTCP(address.String())
			if err != nil {
				t.Fatal(err)
			}
			defer disconnect()
			if _, err := sink.Broadcast(map[string]any{"type": "request", "ids": []string{entry.ID, witness.Manifest.ID}}, transport.Normal, 10*time.Second, false); err != nil {
				t.Fatal(err)
			}
			gotWitness, gotPrivate, inventoryPrivate := false, false, false
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
				got, err := sink.Next(ctx)
				cancel()
				if err == nil {
					value, decodeErr := core.DecodeJSON(got.Payload, core.MaxBundleBytes+65536)
					if decodeErr != nil {
						t.Fatal(decodeErr)
					}
					m, _ := object(value)
					if m["type"] == "bundle" {
						bundle, _ := object(m["bundle"])
						manifest, _ := object(bundle["manifest"])
						gotWitness = gotWitness || text(manifest["id"]) == witness.Manifest.ID
						gotPrivate = gotPrivate || text(manifest["id"]) == entry.ID
					}
					if m["type"] == "inventory" {
						ids, _ := stringsList(m["ids"], 64, true)
						inventoryPrivate = inventoryPrivate || contains(ids, entry.ID)
					}
				}
				if gotWitness && (mode != "active" || (gotPrivate && inventoryPrivate)) {
					break
				}
			}
			if !gotWitness {
				t.Fatal("positive request witness did not arrive")
			}
			// Force one fresh inventory observation under the same application mutex.
			current.mu.Lock()
			current.syncLocked()
			current.mu.Unlock()
			deadline = time.Now().Add(400 * time.Millisecond)
			for time.Now().Before(deadline) {
				ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
				got, err := sink.Next(ctx)
				cancel()
				if err != nil {
					continue
				}
				value, _ := core.DecodeJSON(got.Payload, core.MaxBundleBytes+65536)
				m, _ := object(value)
				if m["type"] == "bundle" {
					bundle, _ := object(m["bundle"])
					manifest, _ := object(bundle["manifest"])
					gotPrivate = gotPrivate || text(manifest["id"]) == entry.ID
				}
				if m["type"] == "inventory" {
					ids, _ := stringsList(m["ids"], 64, true)
					inventoryPrivate = inventoryPrivate || contains(ids, entry.ID)
				}
			}
			if gotPrivate != (mode == "active") || inventoryPrivate != (mode == "active") {
				t.Fatal("cache serving bypassed current authority or lost positive control")
			}
			if mode != "locked" && outboxFor(t, current, entry.OperationID)["status"] != "received" {
				t.Fatal("closure erased delivery fact")
			}
		})
	}
}
