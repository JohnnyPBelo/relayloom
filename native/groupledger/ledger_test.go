package groupledger

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func testStore(t *testing.T) (*groupstore.Store, core.Identity) {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "group-ledger-go")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := core.CreateIdentity("Ledger owner")
	if err != nil {
		t.Fatal(err)
	}
	store, err := groupstore.Open(filepath.Join(dir, "state.sqlite"), identity, groupstore.Options{Create: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close(); os.RemoveAll(dir) })
	return store, identity
}
func checked(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestStopSnapshotInvalidatesOnMutationAndScopeExit(t *testing.T) {
	root := filepath.Join("..", "..", ".cache", "group-ledger-go")
	checked(t, os.MkdirAll(root, 0700))
	dir, err := os.MkdirTemp(root, "stop-snapshot-")
	checked(t, err)
	identity, err := core.CreateIdentity("Stop snapshot")
	checked(t, err)
	path := filepath.Join(dir, "state.sqlite")
	store, err := groupstore.Open(path, identity, groupstore.Options{Create: true})
	checked(t, err)
	t.Cleanup(func() { store.Close(); os.RemoveAll(dir) })
	storeID, err := store.ID()
	checked(t, err)
	g, err := groupauthority.New(store, identity)
	checked(t, err)
	group, err := g.Create("01111111-1111-4111-8111-111111111111", "Snapshot")
	checked(t, err)
	_, err = g.Close("02222222-2222-4222-8222-222222222222", group.GroupID, *group.EpochID)
	checked(t, err)
	entry := RetryEntry{"03333333-3333-4333-8333-333333333333", core.Hash([]byte("intent")), group.GroupID, *group.EpochID}
	var original StopRecord
	var escaped *Ledger
	checked(t, store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, _ *groupauthority.Registry) error {
			escaped = l
			result, err := l.ReconcileRetry(entry, true)
			if err != nil {
				return err
			}
			original = *result.Stop
			result.Stop.Reason = "caller mutation"
			for i := 0; i < 256; i++ {
				record, err := l.Stop(entry.OperationID)
				if err != nil {
					return err
				}
				if *record != original {
					t.Fatal("returned stop aliases cache")
				}
				record.Reason = "caller mutation"
			}
			if !l.stopCached {
				t.Fatal("no validated stop snapshot")
			}
			return nil
		})
		return err
	}))
	if _, err := escaped.Stop(entry.OperationID); err == nil {
		t.Fatal("stop cache escaped its transaction")
	}
	err = store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, _ *groupauthority.Registry) error {
			if _, err := l.Stop(entry.OperationID); err != nil {
				return err
			}
			changed := original
			changed.Reason = "forged"
			data, err := core.Canonical(stopRecordSet{1, []StopRecord{changed}})
			if err != nil {
				return err
			}
			if err := tx.Put(stopKey, data, groupstore.Checkpoint); err != nil {
				return err
			}
			_, err = l.Stop(entry.OperationID)
			return err
		})
		return err
	})
	if !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatalf("stale cache hid a changed record: %v", err)
	}
	checked(t, store.Close())
	store, err = groupstore.Open(path, identity, groupstore.Options{ExpectedStoreID: storeID})
	checked(t, err)
	checked(t, store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, _ *groupauthority.Registry) error {
			record, err := l.Stop(entry.OperationID)
			if err != nil {
				return err
			}
			if *record != original {
				t.Fatal("rollback lost authentic stop")
			}
			return nil
		})
		return err
	}))
}

func TestClosureStopsAndRetirementStayAtomic(t *testing.T) {
	store, identity := testStore(t)
	g, err := groupauthority.New(store, identity)
	checked(t, err)
	created, err := g.Create("11111111-1111-4111-8111-111111111111", "Group")
	checked(t, err)
	entry := RetryEntry{"22222222-2222-4222-8222-222222222222", core.Hash([]byte("retained bytes")), created.GroupID, *created.EpochID}
	var escaped *Ledger
	err = store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, g *groupauthority.Registry) error {
			if _, err := g.Close("33333333-3333-4333-8333-333333333333", created.GroupID, *created.EpochID); err != nil {
				return err
			}
			if _, err := l.ReconcileRetry(entry, true); err != nil {
				return err
			}
			return errors.New("rollback control")
		})
		return err
	})
	if err == nil {
		t.Fatal("callback failure committed")
	}
	state, err := g.State(created.GroupID)
	checked(t, err)
	if state.Status != "active" {
		t.Fatal("partial closure")
	}
	checked(t, store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, g *groupauthority.Registry) error {
			escaped = l
			before, err := l.Stop(entry.OperationID)
			if err != nil {
				return err
			}
			if before != nil {
				t.Fatal("partial stop")
			}
			if _, err := g.Close("33333333-3333-4333-8333-333333333333", created.GroupID, *created.EpochID); err != nil {
				return err
			}
			stopped, err := l.ReconcileRetry(entry, true)
			if err != nil {
				return err
			}
			if stopped.Stop == nil || stopped.Reason != "group-closed" {
				t.Fatal("closure did not stop intent")
			}
			late, err := l.ReconcileRetry(entry, false)
			if err != nil {
				return err
			}
			if late.Stop == nil || late.Stop.Observed != stopped.Stop.Observed {
				t.Fatal("late completion erased stop")
			}
			return nil
		})
		return err
	}))
	if _, err := escaped.Held(); err == nil {
		t.Fatal("expired ledger usable")
	}
	checked(t, store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, g *groupauthority.Registry) error {
			if err := l.RetireStops(map[string]bool{}); err != nil {
				return err
			}
			if err := l.RetireStops(map[string]bool{}); err != nil {
				return err
			}
			counts, err := l.Losses()
			if err != nil {
				return err
			}
			if counts.StopRetired != 1 {
				t.Fatal("incorrect retirement counter")
			}
			return nil
		})
		return err
	}))
}

func TestMalformedCountersFailClosedAndUTF16Bounds(t *testing.T) {
	if utf16Length("á🌊") != 3 || utf16Length(string([]byte{0xed, 0xa0, 0x80})) != 1 {
		t.Fatal("UTF16 length differs")
	}
	store, identity := testStore(t)
	checked(t, store.Update(func(tx *groupstore.Tx) error {
		data, err := core.Canonical(map[string]any{"version": 1, "historyRetired": 0, "historyRefused": 0, "holdRefused": -1, "holdExpired": 0, "stopRetired": 0})
		if err != nil {
			return err
		}
		return tx.Put(lossKey, data, groupstore.Checkpoint)
	}))
	err := store.View(func(tx *groupstore.Tx) error {
		_, err := Run(tx, identity, func(l *Ledger, g *groupauthority.Registry) error { return nil })
		return err
	})
	if !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatalf("counter corruption accepted: %v", err)
	}
}
