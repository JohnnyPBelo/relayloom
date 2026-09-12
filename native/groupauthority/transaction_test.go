package groupauthority

import (
	"bytes"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

func TestScopedGroupAndPrivateCommitRollbackAndExpiry(t *testing.T) {
	a := newActor(t, "Scope", nil)
	before := []byte(`{"mutations":{}}`)
	after := []byte(`{"mutations":{},"siteDraft":{"blocks":[],"savedAt":1,"theme":"forest"}}`)
	var digest string
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		var err error
		digest, err = profilestate.Write(tx, before, nil)
		return err
	}))
	accounting, err := a.store.Accounting()
	check(t, err)
	operation := uuid()
	err = a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			if _, err := g.Create(operation, "Rollback"); err != nil {
				return err
			}
			if _, err := profilestate.Write(tx, after, &digest); err != nil {
				return err
			}
			return errors.New("pre-commit failure")
		})
		return err
	})
	if err == nil {
		t.Fatal("callback failure committed")
	}
	var escaped *Registry
	var committed Result
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			escaped = g
			var err error
			committed, err = g.Create(operation, "Committed")
			if err != nil {
				return err
			}
			_, err = profilestate.Write(tx, after, &digest)
			return err
		})
		return err
	}))
	if a.state(committed.GroupID).Status != "active" {
		t.Fatal("group did not commit")
	}
	check(t, a.store.View(func(tx *groupstore.Tx) error {
		state, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if !bytes.Equal(state.Bytes, after) {
			t.Fatal("private state did not commit")
		}
		return nil
	}))
	next, err := a.store.Accounting()
	check(t, err)
	if next.Revision != accounting.Revision+1 {
		t.Fatal("more than one commit")
	}
	if _, err := escaped.List(); err == nil {
		t.Fatal("escaped scope usable")
	}
}

func TestScopedSwallowedOperationFailureRollsBackEverything(t *testing.T) {
	a := newActor(t, "Swallowed", nil)
	err := a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			created, err := g.Create(uuid(), "Must rollback")
			if err != nil {
				return err
			}
			_, _ = g.Close(uuid(), created.GroupID, core.Hash([]byte("wrong parent")))
			_, err = profilestate.Write(tx, []byte(`{"mutations":{}}`), nil)
			return err
		})
		return err
	})
	if err == nil {
		t.Fatal("swallowed operation error committed")
	}
	list, err := a.registry.List()
	check(t, err)
	if len(list) != 0 {
		t.Fatal("partial group survived")
	}
	check(t, a.store.View(func(tx *groupstore.Tx) error {
		state, err := profilestate.Read(tx)
		if state != nil {
			t.Fatal("partial private write survived")
		}
		return err
	}))
}

func TestScopedRestrictivePrefixAndPrivateDecisionCommitBeforeRejection(t *testing.T) {
	a := newActor(t, "Restrictive", nil)
	id := a.create("Before").GroupID
	anchor, err := a.registry.Anchor(id)
	check(t, err)
	closed, err := groups.CloseGroup(a.identity, anchor, a.head(id))
	check(t, err)
	invalid := closed
	invalid.Signature = base64.StdEncoding.EncodeToString(make([]byte, 64))
	var rejected []ProofRejection
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		var err error
		rejected, err = InTransaction(tx, a.identity, func(g *Registry) error {
			observed, err := g.ObserveHeaders(id, []groups.GroupEpoch{closed, invalid})
			if err != nil {
				return err
			}
			if observed.Status.Status != "closed" || observed.Accepted != 1 || observed.Rejected == "" {
				t.Fatal("restriction/rejection not visible within transaction")
			}
			_, err = profilestate.Write(tx, []byte(`{"mutations":{}}`), nil)
			return err
		})
		return err
	}))
	if len(rejected) != 1 || rejected[0].Accepted != 1 || a.state(id).Status != "closed" {
		t.Fatal("restrictive prefix was lost")
	}
	check(t, a.store.View(func(tx *groupstore.Tx) error {
		state, err := profilestate.Read(tx)
		if state == nil {
			t.Fatal("private decision missing")
		}
		return err
	}))
}

func TestSwallowedEntireScopeErrorStillAbortsOuterTransaction(t *testing.T) {
	a := newActor(t, "Outer swallowed", nil)
	err := a.store.Update(func(tx *groupstore.Tx) error {
		_, _ = InTransaction(tx, a.identity, func(g *Registry) error {
			if _, err := g.Create(uuid(), "Must rollback"); err != nil {
				return err
			}
			if _, err := profilestate.Write(tx, []byte(`{"mutations":{}}`), nil); err != nil {
				return err
			}
			return errors.New("cancel scope")
		})
		return nil
	})
	if err == nil {
		t.Fatal("outer coordinator swallowed scope failure")
	}
	list, err := a.registry.List()
	check(t, err)
	if len(list) != 0 {
		t.Fatal("group partially committed")
	}
	check(t, a.store.View(func(tx *groupstore.Tx) error {
		state, err := profilestate.Read(tx)
		if state != nil {
			t.Fatal("private state partially committed")
		}
		return err
	}))
}

func TestScopedFenceSurvivesFullOrdinaryQuotaWithoutPrivateGrowth(t *testing.T) {
	a := newActor(t, "Scope quota", &groupstore.Limits{TotalBytes: 4*1024*1024 + 65536, ReserveBytes: 4 * 1024 * 1024})
	created := a.create("Quota")
	initial := []byte(`{"mutations":{}}`)
	var digest string
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		var err error
		digest, err = profilestate.Write(tx, initial, nil)
		return err
	}))
	pressure(t, a)
	operation := uuid()
	growth, err := core.Canonical(map[string]any{"mutations": map[string]any{}, "private": string(bytes.Repeat([]byte("X"), 4096))})
	check(t, err)
	err = a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			if _, err := g.Close(operation, created.GroupID, *created.EpochID); err != nil {
				return err
			}
			_, err := profilestate.Write(tx, growth, &digest)
			return err
		})
		return err
	})
	if !errors.Is(err, groupstore.ErrCapacity) {
		t.Fatalf("expected capacity failure: %v", err)
	}
	if a.state(created.GroupID).Status != "active" {
		t.Fatal("failed private growth partially committed group")
	}
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			if _, err := g.Close(operation, created.GroupID, *created.EpochID); err != nil {
				return err
			}
			state, err := profilestate.Read(tx)
			if err != nil {
				return err
			}
			if state.Digest != digest {
				t.Fatal("private document changed")
			}
			return nil
		})
		return err
	}))
	if a.state(created.GroupID).Status != "closed" {
		t.Fatal("minimal fence did not commit")
	}
}
