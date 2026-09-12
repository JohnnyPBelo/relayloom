package groupauthority

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func uuid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type actor struct {
	t        *testing.T
	identity core.Identity
	store    *groupstore.Store
	registry *Registry
	path     string
	storeID  string
}

func newActor(t *testing.T, name string, limits *groupstore.Limits) *actor {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "group-authority-go")
	check(t, os.MkdirAll(root, 0700))
	directory, err := os.MkdirTemp(root, "case-")
	check(t, err)
	identity, err := core.CreateIdentity(name)
	check(t, err)
	a := &actor{t: t, identity: identity, path: filepath.Join(directory, "authority.sqlite")}
	a.store, err = groupstore.Open(a.path, identity, groupstore.Options{Create: true, Limits: limits})
	check(t, err)
	a.storeID, err = a.store.ID()
	check(t, err)
	a.registry, err = New(a.store, identity)
	check(t, err)
	t.Cleanup(func() { _ = a.store.Close(); _ = os.RemoveAll(directory) })
	return a
}
func (a *actor) reopen() {
	check(a.t, a.store.Close())
	var err error
	a.store, err = groupstore.Open(a.path, a.identity, groupstore.Options{ExpectedStoreID: a.storeID})
	check(a.t, err)
	a.registry, err = New(a.store, a.identity)
	check(a.t, err)
}
func (a *actor) create(title string) Result {
	r, err := a.registry.Create(uuid(), title)
	check(a.t, err)
	return r
}
func (a *actor) state(id string) View             { v, err := a.registry.State(id); check(a.t, err); return v }
func (a *actor) head(id string) groups.GroupEpoch { return *a.state(id).Head }
func (a *actor) snapshot(id, epoch string) groups.GroupSnapshot {
	s, err := a.registry.PrivateState(id, epoch)
	check(a.t, err)
	if s == nil {
		a.t.Fatal("missing snapshot")
	}
	return *s
}
func (a *actor) anchor(id string) groups.GroupAnchor {
	r, err := a.registry.Anchor(id)
	check(a.t, err)
	return r
}
func (a *actor) revision() int64 { r, err := a.store.Accounting(); check(a.t, err); return r.Revision }
func consentFrom(t *testing.T, r Result, anchor groups.GroupAnchor, parent groups.GroupEpoch, card core.PublicIdentity) groups.GroupConsent {
	data, err := core.Canonical(r.Certificate)
	check(t, err)
	c, err := groups.DecodeConsent(data, anchor, parent, card)
	check(t, err)
	return c
}
func prepare(t *testing.T, a, b *actor, id string) (groups.GroupEpoch, groups.GroupConsent, string) {
	t.Helper()
	parent := a.head(id)
	anchor := a.anchor(id)
	invited, err := a.registry.Invite(uuid(), id, parent.ID, b.identity.Public)
	check(t, err)
	data, err := core.Canonical(invited.Certificate)
	check(t, err)
	invite, err := groups.DecodeInvitation(data, anchor, parent, b.identity.Public)
	check(t, err)
	_, err = b.registry.RememberInvitation(uuid(), anchor, parent, invite)
	check(t, err)
	for from := 0; from <= parent.Body.Number; from += PageLimit {
		page, err := a.registry.Proofs(id, from, PageLimit)
		check(t, err)
		_, err = b.registry.ObserveHeaders(id, page)
		check(t, err)
	}
	op := uuid()
	accepted, err := b.registry.Accept(op, id, parent.ID)
	check(t, err)
	return parent, consentFrom(t, accepted, anchor, parent, b.identity.Public), op
}
func joinMember(t *testing.T, a, b *actor, id string) (groups.GroupEpoch, groups.GroupConsent, string) {
	parent, consent, op := prepare(t, a, b, id)
	before := a.snapshot(id, parent.ID)
	result, err := a.registry.Commit(uuid(), id, parent.ID, groups.Update{Title: before.Title, Members: append(before.Members, b.identity.Public), Joins: []groups.GroupConsent{consent}})
	check(t, err)
	next := a.head(id)
	_, err = b.registry.ObserveHeaders(id, []groups.GroupEpoch{next})
	check(t, err)
	_, err = b.registry.ObserveSnapshot(id, *result.EpochID, a.snapshot(id, *result.EpochID))
	check(t, err)
	return next, consent, op
}
func mutate(t *testing.T, a *actor, id, title string, members []core.PublicIdentity, joins []groups.GroupConsent) groups.GroupEpoch {
	t.Helper()
	_, err := a.registry.Commit(uuid(), id, a.head(id).ID, groups.Update{Title: title, Members: members, Joins: joins})
	check(t, err)
	return a.head(id)
}
func TestCreationPersistenceAndFiniteIdempotence(t *testing.T) {
	a := newActor(t, "Alice", nil)
	op := uuid()
	created, err := a.registry.Create(op, "Private neighbourhood")
	check(t, err)
	revision := a.revision()
	repeated, err := a.registry.Create(op, "Private neighbourhood")
	check(t, err)
	if !same(created, repeated) || a.revision() != revision {
		t.Fatal("duplicate changed authority")
	}
	a.reopen()
	if a.state(created.GroupID).Status != "active" {
		t.Fatal("lost active state")
	}
	if _, err = a.registry.Create(op, "different"); err == nil {
		t.Fatal("operation reuse accepted")
	}
	bytes, err := os.ReadFile(a.path)
	check(t, err)
	if contains(bytes, []byte("Private neighbourhood")) {
		t.Fatal("plaintext title")
	}
}
func contains(b, sub []byte) bool {
	for i := 0; i+len(sub) <= len(b); i++ {
		if string(b[i:i+len(sub)]) == string(sub) {
			return true
		}
	}
	return false
}
func TestInvitationFreshConsentAndLeaveReentry(t *testing.T) {
	a := newActor(t, "Alice", nil)
	b := newActor(t, "Bruno", nil)
	created := a.create("River")
	id := created.GroupID
	joined, oldConsent, oldOp := joinMember(t, a, b, id)
	oldSnapshot := a.snapshot(id, joined.ID)
	leaveOp := uuid()
	left, err := b.registry.Leave(leaveOp, id)
	check(t, err)
	b.reopen()
	if b.state(id).Status != "left" {
		t.Fatal("lost local leave")
	}
	repeated, err := b.registry.OperationStatus(oldOp)
	check(t, err)
	if repeated == nil {
		t.Fatal("lost retained consent")
	}
	if _, err = b.registry.ObserveSnapshot(id, joined.ID, oldSnapshot); err == nil {
		t.Fatal("old consent restored membership")
	}
	removed := mutate(t, a, id, "Removed", []core.PublicIdentity{a.identity.Public}, []groups.GroupConsent{})
	_, err = b.registry.ObserveHeaders(id, []groups.GroupEpoch{removed})
	check(t, err)
	parent, consent, _ := prepare(t, a, b, id)
	if consent.Body.JoinNonce == oldConsent.Body.JoinNonce {
		t.Fatal("nonce reused")
	}
	next := mutate(t, a, id, "Reentered", []core.PublicIdentity{a.identity.Public, b.identity.Public}, []groups.GroupConsent{consent})
	if next.Body.Previous == nil || *next.Body.Previous != parent.ID {
		t.Fatal("wrong parent")
	}
	_, err = b.registry.ObserveHeaders(id, []groups.GroupEpoch{next})
	check(t, err)
	_, err = b.registry.ObserveSnapshot(id, joined.ID, oldSnapshot)
	check(t, err)
	if b.state(id).Status != "left" {
		t.Fatal("old snapshot cleared fence")
	}
	_, err = b.registry.ObserveSnapshot(id, next.ID, a.snapshot(id, next.ID))
	check(t, err)
	if b.state(id).Status != "active" {
		t.Fatal("fresh join not active")
	}
	// Retrying the old retained leave returns its old certificate without leaving again.
	retried, err := b.registry.Leave(leaveOp, id)
	check(t, err)
	if !same(left, retried) || b.state(id).Status != "active" {
		t.Fatal("retained operation was reapplied")
	}
}
func TestCursorWaitsForIntermediateSnapshot(t *testing.T) {
	a := newActor(t, "Alice", nil)
	b := newActor(t, "Bruno", nil)
	id := a.create("First").GroupID
	joined, _, _ := joinMember(t, a, b, id)
	members := a.snapshot(id, joined.ID).Members
	second := mutate(t, a, id, "Second", members, []groups.GroupConsent{})
	s2 := a.snapshot(id, second.ID)
	third := mutate(t, a, id, "Third", members, []groups.GroupConsent{})
	_, err := b.registry.ObserveHeaders(id, []groups.GroupEpoch{second, third})
	check(t, err)
	_, err = b.registry.ObserveSnapshot(id, third.ID, a.snapshot(id, third.ID))
	check(t, err)
	b.reopen()
	if b.state(id).Status != "awaiting-snapshot" {
		t.Fatal("skipped intermediate state")
	}
	_, err = b.registry.ObserveSnapshot(id, second.ID, s2)
	check(t, err)
	if v := b.state(id); v.Status != "active" || *v.Title != "Third" {
		t.Fatal("verified chain did not activate")
	}
	revision := b.revision()
	_, err = b.registry.ObserveSnapshot(id, second.ID, s2)
	check(t, err)
	if b.revision() != revision {
		t.Fatal("duplicate rewrote state")
	}
}
func pressure(t *testing.T, a *actor) {
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		v, err := tx.Accounting()
		if err != nil {
			return err
		}
		return tx.Put("capacity-fill", make([]byte, 65536-v.OrdinaryBytes-400), groupstore.Data)
	}))
}
func TestCapacityRecoveryAndDurableStops(t *testing.T) {
	limits := &groupstore.Limits{TotalBytes: 4*1024*1024 + 65536, ReserveBytes: 4 * 1024 * 1024}
	a := newActor(t, "Alice", limits)
	b := newActor(t, "Bruno", limits)
	id := a.create("First").GroupID
	joined, _, _ := joinMember(t, a, b, id)
	before := a.snapshot(id, joined.ID)
	next, err := groups.CreateSuccessor(a.identity, a.anchor(id), joined, before, groups.Update{Title: "Next", Members: before.Members, Joins: []groups.GroupConsent{}})
	check(t, err)
	pressure(t, b)
	v, err := b.registry.ObserveHeaders(id, []groups.GroupEpoch{next.Epoch})
	check(t, err)
	if v.Status.Status != "capacity" {
		t.Fatal("missing header stop")
	}
	revision := b.revision()
	_, err = b.registry.ResumeCapacity(id)
	check(t, err)
	if b.revision() != revision {
		t.Fatal("failed resume rewrote metadata")
	}
	b.reopen()
	check(t, b.store.Update(func(tx *groupstore.Tx) error { return tx.Delete("capacity-fill") }))
	v2, err := b.registry.ResumeCapacity(id)
	check(t, err)
	if v2.Status != "awaiting-snapshot" {
		t.Fatal("resume skipped private state")
	}
	pressure(t, b)
	v2, err = b.registry.ObserveSnapshot(id, next.Epoch.ID, next.Snapshot)
	check(t, err)
	if v2.Status != "capacity" {
		t.Fatal("missing snapshot stop")
	}
	b.reopen()
	check(t, b.store.Update(func(tx *groupstore.Tx) error { return tx.Delete("capacity-fill") }))
	v2, err = b.registry.ResumeCapacity(id)
	check(t, err)
	if v2.Status != "capacity" {
		t.Fatal("freed bytes reactivated state")
	}
	_, err = b.registry.ObserveSnapshot(id, next.Epoch.ID, next.Snapshot)
	check(t, err)
	if b.state(id).Status != "active" {
		t.Fatal("exact snapshot not recovered")
	}
	pressure(t, b)
	pressure(t, a)
	leaveOp := uuid()
	closeOp := uuid()
	expected := a.head(id).ID
	left, err := b.registry.Leave(leaveOp, id)
	check(t, err)
	closed, err := a.registry.Close(closeOp, id, expected)
	check(t, err)
	a.reopen()
	b.reopen()
	if a.state(id).Status != "closed" || b.state(id).Status != "left" {
		t.Fatal("stop was not durable")
	}
	lr, err := b.registry.Leave(leaveOp, id)
	check(t, err)
	cr, err := a.registry.Close(closeOp, id, expected)
	check(t, err)
	if !same(left, lr) || !same(closed, cr) {
		t.Fatal("stop idempotence lost")
	}
}
func TestConcurrentHandlesCommitOnlyOneSuccessor(t *testing.T) {
	a := newActor(t, "Alice", nil)
	id := a.create("First").GroupID
	expected := a.head(id).ID
	storeID, err := a.store.ID()
	check(t, err)
	other, err := groupstore.Open(a.path, a.identity, groupstore.Options{ExpectedStoreID: storeID})
	check(t, err)
	defer other.Close()
	second, err := New(other, a.identity)
	check(t, err)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for i, registry := range []*Registry{a.registry, second} {
		wait.Add(1)
		go func(i int, r *Registry) {
			defer wait.Done()
			<-start
			_, err := r.Commit(uuid(), id, expected, groups.Update{Title: fmt.Sprint(i), Members: []core.PublicIdentity{a.identity.Public}, Joins: []groups.GroupConsent{}})
			results <- err
		}(i, registry)
	}
	close(start)
	wait.Wait()
	close(results)
	passed := 0
	for err := range results {
		if err == nil {
			passed++
		}
	}
	if passed != 1 || a.head(id).Body.Number != 1 {
		t.Fatal("CAS admitted siblings")
	}
}
func TestMalformedCheckpointPoisonsHandle(t *testing.T) {
	a := newActor(t, "Alice", nil)
	id := a.create("First").GroupID
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		data, _, err := tx.Get(groupKey(id))
		if err != nil {
			return err
		}
		value, err := core.DecodeJSON(data, CheckpointBytes)
		if err != nil {
			return err
		}
		m := value.(map[string]any)
		m["admitted"] = false
		m["checkedThrough"] = nil
		data, err = core.Canonical(m)
		if err != nil {
			return err
		}
		return tx.Put(groupKey(id), data, groupstore.Checkpoint)
	}))
	if _, err := a.registry.State(id); !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatalf("wanted integrity failure, got %v", err)
	}
	if _, err := a.registry.List(); !errors.Is(err, groupstore.ErrUnavailable) {
		t.Fatalf("handle not poisoned: %v", err)
	}
}
func signEpoch(t *testing.T, identity core.Identity, body groups.EpochBody) groups.GroupEpoch {
	raw, err := base64.StdEncoding.DecodeString(identity.SignSecret)
	check(t, err)
	key, err := x509.ParsePKCS8PrivateKey(raw)
	check(t, err)
	data, err := core.Canonical(body)
	check(t, err)
	return groups.GroupEpoch{Body: body, ID: core.Hash(data), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key.(ed25519.PrivateKey), data))}
}
func TestValidRemovalSurvivesInvalidTrailingProof(t *testing.T) {
	a := newActor(t, "Alice", nil)
	b := newActor(t, "Bruno", nil)
	id := a.create("First").GroupID
	joinMember(t, a, b, id)
	removal := mutate(t, a, id, "Removed", []core.PublicIdentity{a.identity.Public}, []groups.GroupConsent{})
	invalid := removal
	invalid.Signature = base64.StdEncoding.EncodeToString(make([]byte, 64))
	if _, err := b.registry.ObserveHeaders(id, []groups.GroupEpoch{removal, invalid}); err == nil {
		t.Fatal("invalid proof accepted")
	}
	b.reopen()
	if b.state(id).Status != "removed" || b.head(id).ID != removal.ID {
		t.Fatal("invalid trailing input undid removal")
	}
}
func TestInvalidIntermediateConsentCannotBeSkipped(t *testing.T) {
	a := newActor(t, "Alice", nil)
	b := newActor(t, "Bruno", nil)
	id := a.create("First").GroupID
	parent, consent, _ := prepare(t, a, b, id)
	anchor := a.anchor(id)
	before := a.snapshot(id, parent.ID)
	joined, err := groups.CreateSuccessor(a.identity, anchor, parent, before, groups.Update{Title: "Invalid", Members: []core.PublicIdentity{a.identity.Public, b.identity.Public}, Joins: []groups.GroupConsent{consent}})
	check(t, err)
	missing := joined.Snapshot
	missing.Joins = []groups.GroupConsent{}
	bytes, err := core.Canonical(missing)
	check(t, err)
	body := joined.Epoch.Body
	body.SnapshotHash = core.Hash(bytes)
	bad := signEpoch(t, a.identity, body)
	later, err := groups.CreateSuccessor(a.identity, anchor, bad, missing, groups.Update{Title: "Apparently valid", Members: missing.Members, Joins: []groups.GroupConsent{}})
	check(t, err)
	_, err = a.registry.ObserveHeaders(id, []groups.GroupEpoch{bad, later.Epoch})
	check(t, err)
	if _, err = a.registry.ObserveSnapshot(id, bad.ID, missing); err == nil {
		t.Fatal("missing join consent accepted")
	}
	_, err = a.registry.ObserveSnapshot(id, later.Epoch.ID, later.Snapshot)
	check(t, err)
	if a.state(id).Status != "awaiting-snapshot" {
		t.Fatal("skipped invalid intermediate")
	}
}

func TestSignedOrphansCannotFreezeAndAnchoredForkCannotRecover(t *testing.T) {
	a := newActor(t, "Alice", nil)
	outsider := newActor(t, "Outsider", nil)
	id := a.create("Before").GroupID
	parent := a.head(id)
	before := a.snapshot(id, parent.ID)
	anchor := a.anchor(id)
	if _, err := outsider.registry.ObserveHeaders(id, []groups.GroupEpoch{parent}); err == nil {
		t.Fatal("unknown group allocated")
	}
	all, err := outsider.registry.List()
	check(t, err)
	if len(all) != 0 {
		t.Fatal("unknown hint enrolled group")
	}
	next, err := groups.CreateSuccessor(a.identity, anchor, parent, before, groups.Update{Title: "Other copy", Members: before.Members, Joins: []groups.GroupConsent{}})
	check(t, err)
	forged := signEpoch(t, outsider.identity, next.Epoch.Body)
	revision := a.revision()
	if _, err = a.registry.ObserveHeaders(id, []groups.GroupEpoch{forged}); err == nil {
		t.Fatal("outsider signature accepted")
	}
	body := next.Epoch.Body
	body.Number = 9
	body.Previous = ptr(core.Hash([]byte("missing parent")))
	orphan := signEpoch(t, a.identity, body)
	observed, err := a.registry.ObserveHeaders(id, []groups.GroupEpoch{orphan})
	check(t, err)
	if !observed.MissingProof || a.revision() != revision || a.state(id).Status != "active" {
		t.Fatal("signed orphan modified authority")
	}
	adopted := mutate(t, a, id, "Local copy", before.Members, []groups.GroupConsent{})
	observed, err = a.registry.ObserveHeaders(id, []groups.GroupEpoch{next.Epoch})
	check(t, err)
	if observed.Status.Status != "forked" {
		t.Fatal("anchored fork did not freeze")
	}
	a.reopen()
	proof, err := a.registry.StopEvidence(id)
	check(t, err)
	if proof.First.ID != adopted.ID || proof.Second.ID != next.Epoch.ID {
		t.Fatal("fork evidence lost")
	}
	if _, err = a.registry.ResumeCapacity(id); err == nil {
		t.Fatal("resumed a fork")
	}
	if _, err = a.registry.Close(uuid(), id, adopted.ID); err == nil {
		t.Fatal("chose one fork branch")
	}
	revision = a.revision()
	_, err = a.registry.ObserveHeaders(id, []groups.GroupEpoch{parent})
	check(t, err)
	if a.revision() != revision {
		t.Fatal("stale proof rewrote frozen checkpoint")
	}
}
func TestFiniteRetentionAndRememberedGroupLimit(t *testing.T) {
	a := newActor(t, "Alice", nil)
	b := newActor(t, "Bruno", nil)
	op := uuid()
	created, err := a.registry.Create(op, "Retained")
	check(t, err)
	invites := make([]string, OperationLimit)
	for n := range invites {
		invites[n] = uuid()
		_, err = a.registry.Invite(invites[n], created.GroupID, *created.EpochID, b.identity.Public)
		check(t, err)
	}
	expired, err := a.registry.OperationStatus(op)
	check(t, err)
	if expired != nil {
		t.Fatal("operation retained without bound")
	}
	old, err := a.registry.OperationStatus(invites[0])
	check(t, err)
	if old == nil {
		t.Fatal("wrong operation evicted")
	}
	a.reopen()
	revision := a.revision()
	repeated, err := a.registry.Invite(invites[0], created.GroupID, *created.EpochID, b.identity.Public)
	check(t, err)
	if !same(old, &repeated) || a.revision() != revision {
		t.Fatal("duplicate renewed operation")
	}
	_, err = a.registry.Invite(uuid(), created.GroupID, *created.EpochID, b.identity.Public)
	check(t, err)
	expired, err = a.registry.OperationStatus(invites[0])
	check(t, err)
	if expired != nil {
		t.Fatal("retention did not use original revision")
	}
	for n := 1; n < GroupLimit; n++ {
		a.create(fmt.Sprint("Group ", n))
	}
	_, err = a.registry.Close(uuid(), created.GroupID, *created.EpochID)
	check(t, err)
	if _, err = a.registry.Create(uuid(), "Overflow"); err == nil {
		t.Fatal("closing erased group bound")
	}
	a.reopen()
	all, err := a.registry.List()
	check(t, err)
	if len(all) != GroupLimit || a.state(created.GroupID).Status != "closed" {
		t.Fatal("forgotten permanent group")
	}
}
func TestMalformedRetainedResultCannotClaimSuccess(t *testing.T) {
	a := newActor(t, "Alice", nil)
	op := uuid()
	_, err := a.registry.Create(op, "Before")
	check(t, err)
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		key := "operation:" + op
		data, _, err := tx.Get(key)
		if err != nil {
			return err
		}
		value, err := core.DecodeJSON(data, OperationBytes)
		if err != nil {
			return err
		}
		m := value.(map[string]any)
		m["result"].(map[string]any)["epochId"] = "fabricated"
		accounting, err := tx.Accounting()
		if err != nil {
			return err
		}
		m["sequence"] = accounting.Revision + 1
		data, err = core.Canonical(m)
		if err != nil {
			return err
		}
		return tx.Put(key, data, groupstore.Data)
	}))
	if _, err = a.registry.Create(op, "Before"); !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatalf("fabricated result returned: %v", err)
	}
}

func TestRetirementStillChecksEachSignatureAfterCachingAGroup(t *testing.T) {
	a := newActor(t, "Alice", nil)
	b := newActor(t, "Bruno", nil)
	createOp := uuid()
	created, err := a.registry.Create(createOp, "Before")
	check(t, err)
	invalidOp := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	for n := 0; n < OperationLimit-1; n++ {
		id := uuid()
		if n == OperationLimit-2 {
			id = invalidOp
		}
		_, err = a.registry.Invite(id, created.GroupID, *created.EpochID, b.identity.Public)
		check(t, err)
	}
	check(t, a.store.Update(func(tx *groupstore.Tx) error {
		key := "operation:" + invalidOp
		data, _, err := tx.Get(key)
		if err != nil {
			return err
		}
		value, err := core.DecodeJSON(data, OperationBytes)
		if err != nil {
			return err
		}
		m := value.(map[string]any)
		accounting, err := tx.Accounting()
		if err != nil {
			return err
		}
		m["sequence"] = accounting.Revision + 1
		m["result"].(map[string]any)["certificate"].(map[string]any)["signature"] = base64.StdEncoding.EncodeToString(make([]byte, 64))
		data, err = core.Canonical(m)
		if err != nil {
			return err
		}
		return tx.Put(key, data, groupstore.Data)
	}))
	nextOp := uuid()
	if _, err = a.registry.Invite(nextOp, created.GroupID, *created.EpochID, b.identity.Public); !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatalf("unchecked operation signature: %v", err)
	}
	a.reopen()
	old, err := a.registry.OperationStatus(createOp)
	check(t, err)
	if old == nil {
		t.Fatal("failed scan retired a good operation")
	}
	next, err := a.registry.OperationStatus(nextOp)
	check(t, err)
	if next != nil {
		t.Fatal("failed scan committed new operation")
	}
}
