package groupauthority

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestVerifiedReadScopeClonesAndLifetime(t *testing.T) {
	a := newActor(t, "Read scope owner", nil)
	id := a.create("Raw title \xed\xa0\x80").GroupID
	var escaped *Registry
	for attempt := 0; attempt < 2; attempt++ {
		check(t, a.store.Update(func(tx *groupstore.Tx) error {
			_, err := InTransaction(tx, a.identity, func(g *Registry) error {
				escaped = g
				started := time.Now()
				for i := 0; i < 25; i++ {
					view, err := g.State(id)
					if err != nil {
						return err
					}
					if view.Status != "active" || view.Creator.Name != a.identity.Public.Name || view.Head.Body.Members[0].ID != a.identity.Public.ID || view.Title == nil || *view.Title != "Raw title \xed\xa0\x80" {
						t.Fatal("caller mutation or string normalization changed the authority view")
					}
					view.Creator.Name = "Caller mutation"
					view.Head.Body.Members[0].ID = "Caller mutation"
					*view.Title = "Caller mutation"
				}
				t.Logf("25 unchanged scoped reads: %s", time.Since(started))
				return nil
			})
			return err
		}))
		if _, err := escaped.State(id); err == nil {
			t.Fatal("expired authority scope remained usable")
		}
		if escaped.verifiedRecords != nil {
			t.Fatal("scope retained checkpoint cache after completion")
		}
	}
}

func TestVerifiedReadScopeInvalidatesReferencedWrites(t *testing.T) {
	for _, part := range []string{"checkpoint", "epoch:", "snapshot:"} {
		t.Run(part, func(t *testing.T) {
			a := newActor(t, "Invalidation owner", nil)
			id := a.create("Invalidation").GroupID
			err := a.store.Update(func(tx *groupstore.Tx) error {
				_, err := InTransaction(tx, a.identity, func(g *Registry) error {
					view, err := g.State(id)
					if err != nil {
						return err
					}
					if view.Status != "active" {
						t.Fatal("positive control was not active")
					}
					if part == "checkpoint" {
						if err := tx.Put(groupKey(id), []byte(`{}`), "checkpoint"); err != nil {
							return err
						}
					} else {
						keys, err := tx.Keys(part)
						if err != nil {
							return err
						}
						if len(keys) != 1 {
							t.Fatal("referenced proof missing before deletion")
						}
						if err := tx.Delete(keys[0]); err != nil {
							return err
						}
					}
					_, err = g.State(id)
					return err
				})
				return err
			})
			if err == nil || !errors.Is(err, groupstore.ErrIntegrity) {
				t.Fatal("cached checkpoint concealed invalid referenced state", err)
			}
			if _, err := a.registry.State(id); err == nil {
				t.Fatal("integrity failure did not poison the current store")
			}
			a.reopen()
			if a.state(id).Status != "active" {
				t.Fatal("invalid transaction did not roll back")
			}
		})
	}
}

func TestVerifiedReadScopeClosureInvalidatesEarlierView(t *testing.T) {
	a := newActor(t, "Closing cached owner", nil)
	id := a.create("Closure").GroupID
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			before, err := g.State(id)
			if err != nil {
				return err
			}
			if _, err := g.Close(uuid(), id, before.Head.ID); err != nil {
				return err
			}
			after, err := g.State(id)
			if err != nil {
				return err
			}
			if after.Status != "closed" || after.Head.Body.State != "closed" {
				t.Fatal("earlier cached state hid closure")
			}
			return nil
		})
		return err
	}))
}

func TestVerifiedReadScopeRetainsAtMostEightCheckpoints(t *testing.T) {
	a := newActor(t, "Bounded cache owner", nil)
	ids := []string{}
	for i := 0; i < 9; i++ {
		ids = append(ids, a.create("Bounded").GroupID)
	}
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		_, err := InTransaction(tx, a.identity, func(g *Registry) error {
			for _, id := range ids {
				if _, err := g.State(id); err != nil {
					return err
				}
			}
			if g.verifiedRecords == nil || len(g.verifiedRecords.values) != 8 || g.verifiedRecords.values[ids[0]] != nil {
				t.Fatal("checkpoint cache exceeded its bounded working set")
			}
			if _, err := g.State(ids[0]); err != nil {
				return err
			}
			if len(g.verifiedRecords.values) != 8 {
				t.Fatal("reloading an evicted checkpoint grew the cache")
			}
			return nil
		})
		return err
	}))
}

func TestAuthorityRecordClonePreservesWireStringsAndReferences(t *testing.T) {
	text := "\xed\xa0\x80"
	epoch := &groups.GroupEpoch{Body: groups.EpochBody{Previous: &text, Members: []groups.MemberCommitment{{ID: "original", CardHash: "card"}}}}
	r := &record{Label: &text, Head: epoch, InvitationParent: epoch, CheckedThrough: new(int), Admitted: &admission{CardHash: "card"}, Invitation: &groups.GroupInvitation{}, Consent: &groups.GroupConsent{}, InvitationCard: &core.PublicIdentity{Name: text}, Left: &leftFence{EpochID: &text, Request: &groups.GroupLeave{}, Card: &core.PublicIdentity{Name: text}}, Frozen: &StopEvidence{First: epoch, Second: epoch, Observed: epoch}}
	before, err := core.Canonical(r)
	check(t, err)
	copy := cloneAuthorityRecord(r)
	encoded, err := core.Canonical(copy)
	check(t, err)
	if !bytes.Equal(before, encoded) {
		t.Fatal("clone changed canonical bytes")
	}
	*copy.Label = "changed"
	copy.Head.Body.Members[0].ID = "changed"
	*copy.InvitationParent.Body.Previous = "changed"
	*copy.CheckedThrough = 9
	copy.Admitted.CardHash = "changed"
	copy.Invitation.ID = "changed"
	copy.Consent.ID = "changed"
	copy.InvitationCard.Name = "changed"
	*copy.Left.EpochID = "changed"
	copy.Left.Request.ID = "changed"
	copy.Left.Card.Name = "changed"
	copy.Frozen.First.Body.Members[0].ID = "changed"
	copy.Frozen.Second.ID = "changed"
	copy.Frozen.Observed.ID = "changed"
	after, err := core.Canonical(r)
	check(t, err)
	if !bytes.Equal(before, after) {
		t.Fatal("clone mutated retained record through an alias")
	}
	for _, members := range [][]groups.MemberCommitment{nil, {}} {
		e := cloneAuthorityEpoch(&groups.GroupEpoch{Body: groups.EpochBody{Members: members}})
		if (e.Body.Members == nil) != (members == nil) {
			t.Fatal("clone changed nil versus empty audience")
		}
	}
}
