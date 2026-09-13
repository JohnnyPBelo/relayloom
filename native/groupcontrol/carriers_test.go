package groupcontrol

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestExpiredEnvelopeCannotReplayAuthority(t *testing.T) {
	a := person(t, "Expiry owner")
	created, err := a.g.Create(operation(), "Durable authority")
	check(t, err)
	view, err := a.g.State(created.GroupID)
	check(t, err)
	payload := map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": created.GroupID, "to": a.id.Public.ID, "from": 0, "headers": []any{*view.Head}, "head": *view.Head}
	bundle, err := core.CreateBundle(a.id, "group-control", payload, nil, false, 1000)
	check(t, err)
	check(t, VerifyEnvelope(bundle))
	_, err = Open(bundle, a.id)
	check(t, err)
	time.Sleep(time.Until(time.UnixMilli(bundle.Manifest.Expires)) + time.Millisecond)
	if VerifyEnvelope(bundle) == nil {
		t.Fatal("expired envelope accepted")
	}
	if _, err = Open(bundle, a.id); err == nil {
		t.Fatal("expired control opened")
	}
	current, err := a.g.State(created.GroupID)
	check(t, err)
	if current.Head.ID != view.Head.ID {
		t.Fatal("transport expiry erased durable authority")
	}
}

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func operation() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type actor struct {
	id    core.Identity
	store *groupstore.Store
	g     *groupauthority.Registry
}

func person(t *testing.T, name string) *actor {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "group-control-go")
	check(t, os.MkdirAll(root, 0700))
	dir, err := os.MkdirTemp(root, "actor-")
	check(t, err)
	id, err := core.CreateIdentity(name)
	check(t, err)
	store, err := groupstore.Open(filepath.Join(dir, "state.sqlite"), id, groupstore.Options{Create: true})
	check(t, err)
	g, err := groupauthority.New(store, id)
	check(t, err)
	t.Cleanup(func() { store.Close(); os.RemoveAll(dir) })
	return &actor{id, store, g}
}
func scope(t *testing.T, a *actor, fn func(*groupauthority.Registry) error) error {
	t.Helper()
	return a.store.Update(func(tx *groupstore.Tx) error { _, err := groupauthority.InTransaction(tx, a.id, fn); return err })
}
func add(t *testing.T, a, b *actor, id string) {
	t.Helper()
	state, err := a.g.State(id)
	check(t, err)
	anchor, err := a.g.Anchor(id)
	check(t, err)
	invite, err := a.g.Invite(operation(), id, state.Head.ID, b.id.Public)
	check(t, err)
	raw, err := core.Canonical(invite.Certificate)
	check(t, err)
	certificate, err := groups.DecodeInvitation(raw, anchor, *state.Head, b.id.Public)
	check(t, err)
	_, err = b.g.RememberInvitation(operation(), anchor, *state.Head, certificate)
	check(t, err)
	for n := 0; n <= state.Head.Body.Number; n += 16 {
		headers, err := a.g.Proofs(id, n, 16)
		check(t, err)
		_, err = b.g.ObserveHeaders(id, headers)
		check(t, err)
	}
	accepted, err := b.g.Accept(operation(), id, state.Head.ID)
	check(t, err)
	raw, err = core.Canonical(accepted.Certificate)
	check(t, err)
	consent, err := groups.DecodeConsent(raw, anchor, *state.Head, b.id.Public)
	check(t, err)
	old, err := a.g.PrivateState(id, state.Head.ID)
	check(t, err)
	joined, err := a.g.Commit(operation(), id, state.Head.ID, groups.Update{Title: old.Title, Members: append(old.Members, b.id.Public), Joins: []groups.GroupConsent{consent}})
	check(t, err)
	latest, err := a.g.State(id)
	check(t, err)
	_, err = b.g.ObserveHeaders(id, []groups.GroupEpoch{*latest.Head})
	check(t, err)
	snapshot, err := a.g.PrivateState(id, *joined.EpochID)
	check(t, err)
	_, err = b.g.ObserveSnapshot(id, *joined.EpochID, *snapshot)
	check(t, err)
}
func TestPrivateCarrierKeepsCreatorProofAndRestrictsRecipient(t *testing.T) {
	a, b, c := person(t, "Alice"), person(t, "Bruno"), person(t, "Carla")
	created, err := a.g.Create(operation(), "Private group")
	check(t, err)
	add(t, a, b, created.GroupID)
	add(t, a, c, created.GroupID)
	view, err := a.g.State(created.GroupID)
	check(t, err)
	snapshot, err := a.g.PrivateState(created.GroupID, view.Head.ID)
	check(t, err)
	var material Material
	check(t, scope(t, a, func(g *groupauthority.Registry) error {
		var err error
		material, err = SnapshotMaterial(g, a.id.Public, *view.Head, *snapshot, b.id.Public)
		return err
	}))
	bundle, err := Seal(a.id, material.Payload, material.Readers)
	check(t, err)
	opened, err := Open(bundle, b.id)
	check(t, err)
	if opened.To != b.id.Public.ID {
		t.Fatal("missing addressed snapshot")
	}
	if _, err = core.DecryptBundle(bundle, &c.id); err == nil {
		t.Fatal("non-recipient decrypted directed response")
	}
	check(t, scope(t, a, func(g *groupauthority.Registry) error {
		value, err := CheckedSnapshot(g, bundle, opened)
		if err == nil && value.Epoch.Signature != view.Head.Signature {
			t.Fatal("carrier changed creator signature")
		}
		return err
	}))
	public, err := core.CreateBundle(a.id, "group-control", material.Payload, nil, true, TTL)
	check(t, err)
	if _, err = Open(public, b.id); err == nil {
		t.Fatal("public control accepted")
	}
	widened, err := core.CreateBundle(a.id, "group-control", material.Payload, []core.PublicIdentity{b.id.Public, c.id.Public}, false, TTL)
	check(t, err)
	if _, err = Open(widened, b.id); err == nil {
		t.Fatal("extra control reader accepted")
	}
}
func TestOldMembershipStopsAtRemovalAndCannotReadFutureSnapshot(t *testing.T) {
	a, b, c := person(t, "Alice"), person(t, "Bruno"), person(t, "Carla")
	created, err := a.g.Create(operation(), "Group")
	check(t, err)
	id := created.GroupID
	add(t, a, b, id)
	old, err := a.g.State(id)
	check(t, err)
	_, err = a.g.Commit(operation(), id, old.Head.ID, groups.Update{Title: "Removed", Members: []core.PublicIdentity{a.id.Public}, Joins: []groups.GroupConsent{}})
	check(t, err)
	boundary, err := a.g.State(id)
	check(t, err)
	add(t, a, c, id)
	future, err := a.g.State(id)
	check(t, err)
	request, err := Parse(map[string]any{"type": "group-control", "version": 1, "action": "headers-request", "groupId": id, "to": a.id.Public.ID, "from": 0, "count": 16, "authorization": map[string]any{"number": old.Head.Body.Number, "id": old.Head.ID}})
	check(t, err)
	check(t, scope(t, a, func(g *groupauthority.Registry) error {
		result, err := RequestedHeaders(g, request, b.id.Public)
		if err == nil {
			if result.Head.ID != boundary.Head.ID {
				t.Fatal("removed reader learned future head")
			}
			for _, header := range result.Headers {
				if header.Body.Number > boundary.Head.Body.Number {
					t.Fatal("future membership leaked")
				}
			}
		}
		return err
	}))
	snapshot, err := Parse(map[string]any{"type": "group-control", "version": 1, "action": "snapshot-request", "groupId": id, "to": a.id.Public.ID, "number": future.Head.Body.Number, "epochId": future.Head.ID})
	check(t, err)
	if scope(t, a, func(g *groupauthority.Registry) error {
		_, err := RequestedSnapshot(g, snapshot, b.id.Public, a.id.Public)
		return err
	}) == nil {
		t.Fatal("removed member fetched new snapshot")
	}
	snapshot.Raw["number"], snapshot.Raw["epochId"] = old.Head.Body.Number, old.Head.ID
	snapshot, err = Parse(snapshot.Raw)
	check(t, err)
	if scope(t, a, func(g *groupauthority.Registry) error {
		_, err := RequestedSnapshot(g, snapshot, c.id.Public, a.id.Public)
		return err
	}) == nil {
		t.Fatal("new member fetched old snapshot")
	}
	check(t, scope(t, a, func(g *groupauthority.Registry) error {
		_, err := RequestedSnapshot(g, snapshot, b.id.Public, a.id.Public)
		return err
	}))
}
func TestShapePreservesBadCertificateTailForAuthorityBoundary(t *testing.T) {
	a := person(t, "Alice")
	created, err := a.g.Create(operation(), "Group")
	check(t, err)
	view, err := a.g.State(created.GroupID)
	check(t, err)
	payload := map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": created.GroupID, "to": a.id.Public.ID, "from": 0, "headers": []any{*view.Head, map[string]any{"bad": "tail"}}, "head": *view.Head}
	c, err := Parse(payload)
	check(t, err)
	if len(c.Headers) != 2 {
		t.Fatal("parser discarded proof tail")
	}
	payload["headers"] = make([]any, 17)
	if _, err = Parse(payload); err == nil {
		t.Fatal("oversized page accepted")
	}
	if _, err = RequestedHeaders(a.g, Control{Action: "headers-request"}, a.id.Public); err == nil {
		t.Fatal("unchecked request structure accepted")
	}
}
