package sites

import (
	"bytes"
	"fmt"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"testing"
)

func reserve(t *testing.T, owner core.Identity, r Record, text string) Reservation {
	t.Helper()
	s, e := State(r)
	mustPrivate(t, e)
	base, e := BaseHash(r)
	mustPrivate(t, e)
	parents := []string{}
	for _, h := range s.Heads {
		parents = append(parents, h.ID)
	}
	if len(parents) > Predecessors {
		parents = parents[:Predecessors]
	}
	revision, e := CreateRevision(owner, r.Name, *s.NextSequence, parents, digest(t, text))
	mustPrivate(t, e)
	return Reservation{Sequence: *s.NextSequence, OperationID: fmt.Sprintf("00000000-0000-0000-0000-%012d", *s.NextSequence), Fingerprint: core.Hash([]byte(text)), ExpectedBase: base, Revision: revision, BundleID: core.Hash([]byte("bundle:" + text))}
}
func TestRegistryDurablePhaseContract(t *testing.T) {
	owner := identity(t, "Go registry")
	r, e := InitialRecord(owner.Public.ID, "profile")
	mustPrivate(t, e)
	q := reserve(t, owner, r, "first")
	before, _ := core.Canonical(r)
	began, e := Begin(r, q)
	mustPrivate(t, e)
	after, _ := core.Canonical(r)
	if !bytes.Equal(before, after) {
		t.Fatal("input mutated")
	}
	state, e := State(began.Record)
	mustPrivate(t, e)
	if state.Status != "empty" || *state.NextSequence != 2 || began.Operation.Phase != "prepared" {
		t.Fatal("reservation published")
	}
	if _, e = Finish(began.Record, 1, q.OperationID, q.Fingerprint, "markReady"); e == nil {
		t.Fatal("uncommitted publication became ready")
	}
	committed, e := Finish(began.Record, 1, q.OperationID, q.Fingerprint, "commit")
	mustPrivate(t, e)
	if committed.Operation.Phase != "committed" || len(committed.Record.Headers[0].Bundles) != 0 {
		t.Fatal("commit claimed a public copy")
	}
	cancelled, e := Finish(committed.Record, 1, q.OperationID, q.Fingerprint, "cancel")
	mustPrivate(t, e)
	if cancelled.Operation.Phase != "committed" {
		t.Fatal("authorization recalled")
	}
	ready, e := Finish(cancelled.Record, 1, q.OperationID, q.Fingerprint, "markReady")
	mustPrivate(t, e)
	if ready.Operation.Phase != "ready" || ready.Record.Headers[0].Bundles[0] != q.BundleID {
		t.Fatal("copy missing")
	}
	repeated, e := Begin(ready.Record, q)
	mustPrivate(t, e)
	if repeated.Created || repeated.Operation.Phase != "ready" {
		t.Fatal("replay created new operation")
	}
	encoded, e := core.Canonical(ready.Record)
	mustPrivate(t, e)
	decoded, e := DecodeRecord(encoded, owner.Public.ID, "profile")
	mustPrivate(t, e)
	actual, _ := core.Canonical(decoded)
	if !bytes.Equal(encoded, actual) {
		t.Fatal("record changed in decode")
	}
}
func TestRegistryConcurrentBaseAndExpiry(t *testing.T) {
	owner := identity(t, "Go concurrency")
	r, e := InitialRecord(owner.Public.ID, "profile")
	mustPrivate(t, e)
	q := reserve(t, owner, r, "local")
	pending, e := Begin(r, q)
	mustPrivate(t, e)
	remote, e := CreateRevision(owner, "profile", 1, []string{}, digest(t, "remote"))
	mustPrivate(t, e)
	observed, e := Observe(pending.Record, remote, core.Hash([]byte("remote")))
	mustPrivate(t, e)
	stopped, e := Finish(observed, 1, q.OperationID, q.Fingerprint, "commit")
	mustPrivate(t, e)
	if stopped.Operation.Phase != "superseded" || len(stopped.Record.Headers) != 1 {
		t.Fatal("stale publication escaped")
	}
	pending, e = Begin(r, q)
	mustPrivate(t, e)
	committed, e := Finish(pending.Record, 1, q.OperationID, q.Fingerprint, "commit")
	mustPrivate(t, e)
	expired, e := Finish(committed.Record, 1, q.OperationID, q.Fingerprint, "expire")
	mustPrivate(t, e)
	state, e := State(expired.Record)
	mustPrivate(t, e)
	if state.Number != 1 || *state.NextSequence != 2 || expired.Operation.Phase != "expired" {
		t.Fatal("expiry forgot authority")
	}
}
func TestRegistryRetirementCannotReexecuteOldSequence(t *testing.T) {
	owner := identity(t, "Go finite journal")
	r, e := InitialRecord(owner.Public.ID, "profile")
	mustPrivate(t, e)
	first := reserve(t, owner, r, "first")
	for i := 0; i < RegistryOperations+2; i++ {
		q := reserve(t, owner, r, fmt.Sprint(i))
		if i == 0 {
			first = q
		}
		b, e := Begin(r, q)
		mustPrivate(t, e)
		done, e := Finish(b.Record, q.Sequence, q.OperationID, q.Fingerprint, "cancel")
		mustPrivate(t, e)
		r = done.Record
	}
	if len(r.Operations) != RegistryOperations {
		t.Fatal("unbounded journal")
	}
	if _, e = Lookup(r, first.Sequence, first.OperationID, first.Fingerprint); e == nil {
		t.Fatal("old operation can execute again")
	}
}
