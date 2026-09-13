package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func groupContentFixture(t *testing.T) (*Node, core.Identity, groupauthority.View, *groups.GroupSnapshot) {
	t.Helper()
	n, _ := nodeFor(t, "Admission")
	// Explicit request/failure controls; live TCP/sync is covered by the CLI
	// journey. Stop only this fixture's background application workers.
	n.cancel()
	n.wg.Wait()
	created := apply(t, n, "group-command", map[string]any{"action": "create", "operationId": "9ef1a20d-a945-47e9-b21d-65cb56fcfe68", "title": "Boundary"}).(map[string]any)["group"].(groupauthority.View)
	snapshot := apply(t, n, "group-command", map[string]any{"action": "private-state", "groupId": created.ID, "epochId": created.Head.ID}).(map[string]any)["snapshot"].(*groups.GroupSnapshot)
	return n, *n.identity, created, snapshot
}
func contentMessage(t *testing.T, identity core.Identity, group groupauthority.View, snapshot *groups.GroupSnapshot, epoch string) core.Bundle {
	t.Helper()
	b, err := core.CreateBundle(identity, "message", Content{"type": "message", "text": "Commit before display", "conversation": group.ID, "groupAudience": "epoch", "groupEpoch": epoch, "members": snapshot.Members}, snapshot.Members, false, 60000)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func acceptedContent(t *testing.T, n *Node, identity core.Identity, id string) *groupledger.HistoryRecord {
	t.Helper()
	var value *groupledger.HistoryRecord
	err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		_, err := groupledger.Run(tx, identity, func(l *groupledger.Ledger, _ *groupauthority.Registry) error {
			var err error
			value, err = l.Accepted(id)
			return err
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestGroupAdmissionOuterRollbackCannotDisplay(t *testing.T) {
	n, identity, group, snapshot := groupContentFixture(t)
	b := contentMessage(t, identity, group, snapshot, group.Head.ID)
	if _, err := n.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
	database := n.privateDatabase
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		return database.Update(func(tx *groupstore.Tx) error {
			if err := callback(tx); err != nil {
				return err
			}
			return errors.New("synthetic before-commit failure")
		})
	}
	if _, err := n.Handle("state", nil); err == nil {
		t.Fatal("uncommitted admission returned success")
	}
	n.updateGroupState = nil
	if acceptedContent(t, n, identity, b.Manifest.ID) != nil {
		t.Fatal("rollback left accepted history")
	}
	state := apply(t, n, "state", nil).(map[string]any)
	if len(state["objects"].([]DisplayObject)) != 1 {
		t.Fatal("verified retry did not admit")
	}
}

func TestGroupHistoricalDeleteAndAdmissionRecoverAfterLostResponse(t *testing.T) {
	n, identity, group, snapshot := groupContentFixture(t)
	b := contentMessage(t, identity, group, snapshot, group.Head.ID)
	if _, err := n.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	if err := n.Store.Remove(b.Manifest.ID); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "group-command", map[string]any{"action": "close", "operationId": "c5a11f8a-d89c-41d4-87b7-b30d05c0b3f6", "groupId": group.ID, "expected": group.Head.ID})
	event, err := core.CreateBundle(identity, "delete", Content{"type": "delete", "conversation": group.ID, "groupAudience": "historical", "targetEpoch": group.Head.ID, "target": b.Manifest.ID}, snapshot.Members, false, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = n.Store.Put(event, false); err != nil {
		t.Fatal(err)
	}
	database := n.privateDatabase
	committed := false
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		if err := database.Update(callback); err != nil {
			return err
		}
		committed = true
		return errors.New("synthetic after-commit loss")
	}
	if _, err = n.Handle("state", nil); err == nil || !committed {
		t.Fatal("lost response did not fail after commit")
	}
	n.updateGroupState = nil
	if acceptedContent(t, n, identity, event.Manifest.ID) == nil || !n.private.Mutations[b.Manifest.ID].Deleted {
		t.Fatal("accepted delete and private mutation did not recover together")
	}
	if _, err = n.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
	view := apply(t, n, "view", map[string]any{"id": b.Manifest.ID}).(DisplayObject)
	if !view.Deleted {
		t.Fatal("restored ciphertext resurrected content")
	}
}

func TestGroupQuarantineReservationFailureRollsBackAndLocks(t *testing.T) {
	n, identity, group, snapshot := groupContentFixture(t)
	b := contentMessage(t, identity, group, snapshot, strings.Repeat("f", 64))
	if _, err := n.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(n.Dir, "store", "index.json")
	backup := path + ".backup"
	if err := os.Rename(path, backup); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := n.Handle("state", nil); err == nil {
		t.Fatal("failed reservation allowed success")
	}
	if n.identity != nil || len(n.Store.Reservations()) != 1 {
		t.Fatal("failed recovery did not lock/protect")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, path); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "unlock", map[string]any{"password": password})
	if len(n.Store.Reservations()) != 0 {
		t.Fatal("orphan reservation was not reconciled")
	}
	if acceptedContent(t, n, identity, b.Manifest.ID) != nil {
		t.Fatal("failed quarantine became accepted")
	}
	state := apply(t, n, "state", nil).(map[string]any)
	held := state["groupContent"].(map[string]any)["held"].([]groupHeldView)
	if len(held) != 1 || !held[0].Available || held[0].ID != b.Manifest.ID || len(state["objects"].([]DisplayObject)) != 0 {
		t.Fatal("recovered quarantine is not physically retained and hidden")
	}
}

func TestGroupCorruptQuarantineDoesNotBlockHealthyAdmission(t *testing.T) {
	n, identity, group, snapshot := groupContentFixture(t)
	held := contentMessage(t, identity, group, snapshot, strings.Repeat("f", 64))
	if _, err := n.Store.Put(held, false); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	for key, value := range held.Chunks {
		prefix := "A"
		if value[0] == 'A' {
			prefix = "B"
		}
		held.Chunks[key] = prefix + value[1:]
		break
	}
	raw, err := core.Canonical(held)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(n.Dir, "store", "objects", held.Manifest.ID+".json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	good := contentMessage(t, identity, group, snapshot, group.Head.ID)
	if _, err = n.Store.Put(good, false); err != nil {
		t.Fatal(err)
	}
	state := apply(t, n, "state", nil).(map[string]any)
	objects := state["objects"].([]DisplayObject)
	if len(objects) != 1 || objects[0].ID != good.Manifest.ID {
		t.Fatal("corrupt hold blocked valid admission")
	}
	views := state["groupContent"].(map[string]any)["held"].([]groupHeldView)
	if len(views) != 1 || views[0].Available || n.Store.Stats().Reserved != 0 {
		t.Fatal("corrupt quarantine advertised available/reserved bytes")
	}
}

func TestGroupHistoryExpiryMustMatchSignedBundle(t *testing.T) {
	n, identity, group, snapshot := groupContentFixture(t)
	b := contentMessage(t, identity, group, snapshot, group.Head.ID)
	if _, err := n.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	original := acceptedContent(t, n, identity, b.Manifest.ID)
	if original == nil {
		t.Fatal("missing accepted context")
	}
	replace := func(value groupledger.HistoryRecord) {
		raw, err := core.Canonical(value)
		if err != nil {
			t.Fatal(err)
		}
		err = n.privateDatabase.Update(func(tx *groupstore.Tx) error { return tx.Put("group-history:"+b.Manifest.ID, raw, groupstore.Data) })
		if err != nil {
			t.Fatal(err)
		}
	}
	changed := *original
	changed.Expires++
	replace(changed)
	if _, err := n.Handle("state", nil); err == nil {
		t.Fatal("inconsistent authenticated expiry accepted")
	}
	replace(*original)
	state := apply(t, n, "state", nil).(map[string]any)
	if len(state["objects"].([]DisplayObject)) != 1 {
		t.Fatal("exact restoration did not recover")
	}
}
