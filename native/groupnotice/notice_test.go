package groupnotice

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

type actor struct {
	identity      core.Identity
	path, storeID string
	store         *groupstore.Store
	g             *groupauthority.Registry
}

func person(t *testing.T, name string) *actor {
	t.Helper()
	root := filepath.Join("..", "..", ".cache", "group-notices-go")
	must(t, os.MkdirAll(root, 0700))
	dir, err := os.MkdirTemp(root, "actor-")
	must(t, err)
	id, err := core.CreateIdentity(name)
	must(t, err)
	s, err := groupstore.Open(filepath.Join(dir, "state.sqlite"), id, groupstore.Options{Create: true})
	must(t, err)
	storeID, err := s.ID()
	must(t, err)
	g, err := groupauthority.New(s, id)
	must(t, err)
	a := &actor{id, filepath.Join(dir, "state.sqlite"), storeID, s, g}
	t.Cleanup(func() { a.store.Close(); os.RemoveAll(dir) })
	return a
}
func (a *actor) reopen(t *testing.T) {
	t.Helper()
	must(t, a.store.Close())
	s, err := groupstore.Open(a.path, a.identity, groupstore.Options{ExpectedStoreID: a.storeID})
	must(t, err)
	a.store = s
	a.g, err = groupauthority.New(s, a.identity)
	must(t, err)
}
func encode(t *testing.T, v any) []byte {
	t.Helper()
	b, err := core.Canonical(v)
	must(t, err)
	return b
}
func invited(t *testing.T, a, b *actor, g groups.AnchoredGroup) Notice {
	t.Helper()
	certificate, err := groups.CreateInvitation(a.identity, g.Anchor, g.Epoch, b.identity.Public)
	must(t, err)
	n, err := Parse(map[string]any{"type": "group-notice", "version": 1, "kind": "invitation", "anchor": g.Anchor, "parent": g.Epoch, "member": b.identity.Public, "certificate": certificate})
	must(t, err)
	return n
}
func journal(t *testing.T, a *actor, fn func(*Journal) error) error {
	t.Helper()
	return a.store.Update(func(tx *groupstore.Tx) error {
		j, err := New(tx, a.identity.Public)
		if err != nil {
			return err
		}
		return fn(j)
	})
}

func TestPrivateNoticeCertifiesPartiesWithoutEnrolling(t *testing.T) {
	a, b, c := person(t, "Creator"), person(t, "Invitee"), person(t, "Outside")
	g, err := groups.CreateGroup(a.identity, "Notices")
	must(t, err)
	n := invited(t, a, b, g)
	bundle, err := Seal(a.identity, n)
	must(t, err)
	opened, err := Open(bundle, b.identity)
	must(t, err)
	if !equal(opened.Raw, n.Raw) {
		t.Fatal("notice changed in encryption")
	}
	if _, err = Open(bundle, c.identity); err == nil {
		t.Fatal("outside reader decrypted notice")
	}
	widened, err := core.CreateBundle(a.identity, "group-notice", n.Raw, []core.PublicIdentity{b.identity.Public, c.identity.Public}, false, TTL)
	must(t, err)
	must(t, core.VerifyBundle(widened))
	if _, err = Open(widened, b.identity); err == nil {
		t.Fatal("notice accepted extra recipient")
	}
	if _, err = Seal(b.identity, n); err == nil {
		t.Fatal("recipient signed issuer notice")
	}
	invite, err := groups.DecodeInvitation(encode(t, n.Raw["certificate"]), g.Anchor, g.Epoch, b.identity.Public)
	must(t, err)
	consent, err := groups.AcceptInvitation(b.identity, g.Anchor, g.Epoch, invite)
	must(t, err)
	raw := map[string]any{"type": "group-notice", "version": 1, "kind": "consent", "anchor": g.Anchor, "parent": g.Epoch, "member": b.identity.Public, "certificate": consent, "invitation": invite}
	notice, err := Parse(raw)
	must(t, err)
	answer, err := Seal(b.identity, notice)
	must(t, err)
	_, err = Open(answer, a.identity)
	must(t, err)
	raw["invitation"] = invited(t, a, b, g).Raw["certificate"]
	if _, err = Parse(raw); err == nil {
		t.Fatal("consent accepted a different invitation")
	}
	must(t, journal(t, b, func(j *Journal) error {
		result, err := j.Save(Incoming, n)
		if err == nil && result != "stored" {
			t.Fatal(result)
		}
		return err
	}))
	list, err := b.g.List()
	must(t, err)
	if len(list) != 0 {
		t.Fatal("inbox enrolled a group")
	}
}

func TestInvitationAndCardShareAuthorityCommitAndReopen(t *testing.T) {
	a, b := person(t, "Private notice creator"), person(t, "Private recipient card")
	created, err := a.g.Create("10000000-0000-4000-8000-000000000001", "Durable invite")
	must(t, err)
	operation := "10000000-0000-4000-8000-000000000002"
	var notice Notice
	issue := func(fail bool) error {
		return a.store.Update(func(tx *groupstore.Tx) error {
			_, err := groupauthority.InTransaction(tx, a.identity, func(g *groupauthority.Registry) error {
				view, err := g.State(created.GroupID)
				if err != nil {
					return err
				}
				anchor, err := g.Anchor(created.GroupID)
				if err != nil {
					return err
				}
				result, err := g.Invite(operation, created.GroupID, view.Head.ID, b.identity.Public)
				if err != nil {
					return err
				}
				notice, err = Parse(map[string]any{"type": "group-notice", "version": 1, "kind": "invitation", "anchor": anchor, "parent": *view.Head, "member": b.identity.Public, "certificate": result.Certificate})
				if err != nil {
					return err
				}
				j, err := New(tx, a.identity.Public)
				if err != nil {
					return err
				}
				if _, err = j.Save(Outgoing, notice); err != nil {
					return err
				}
				if fail {
					return errors.New("fixture failure before outer commit")
				}
				return nil
			})
			return err
		})
	}
	if issue(true) == nil {
		t.Fatal("injected failure did not abort")
	}
	status, err := a.g.OperationStatus(operation)
	must(t, err)
	if status != nil {
		t.Fatal("authority result survived rollback")
	}
	must(t, issue(false))
	must(t, issue(false))
	a.reopen(t)
	must(t, journal(t, a, func(j *Journal) error {
		entries, err := j.List(Outgoing)
		if err != nil {
			return err
		}
		if len(entries) != 1 {
			t.Fatal("duplicate or missing delivery material")
		}
		loaded, err := Parse(entries[0].Notice)
		if err != nil {
			return err
		}
		if !equal(loaded.Member, b.identity.Public) {
			t.Fatal("recipient card changed")
		}
		bundle, err := Seal(a.identity, loaded)
		if err != nil {
			return err
		}
		opened, err := Open(bundle, b.identity)
		if err == nil && !equal(opened.Raw, notice.Raw) {
			t.Fatal("reopened notice changed")
		}
		return err
	}))
}

func TestNoticeIssuerQuotaAndRetirement(t *testing.T) {
	a, b := person(t, "Quota issuer"), person(t, "Quota reader")
	g, err := groups.CreateGroup(a.identity, "Bounded inbox")
	must(t, err)
	values := []Notice{}
	for i := 0; i < IssuerLimit+1; i++ {
		values = append(values, invited(t, a, b, g))
	}
	for _, n := range values[:IssuerLimit] {
		must(t, journal(t, b, func(j *Journal) error { _, err := j.Save(Incoming, n); return err }))
	}
	if journal(t, b, func(j *Journal) error { _, err := j.Save(Incoming, values[IssuerLimit]); return err }) == nil {
		t.Fatal("issuer exceeded inbox quota")
	}
	before, err := b.store.Accounting()
	must(t, err)
	must(t, journal(t, b, func(j *Journal) error {
		result, err := j.Save(Incoming, values[0])
		if err == nil && result != "duplicate" {
			t.Fatal(result)
		}
		return err
	}))
	after, err := b.store.Accounting()
	must(t, err)
	if before.Revision != after.Revision {
		t.Fatal("duplicate modified revision")
	}
	must(t, journal(t, b, func(j *Journal) error {
		removed, err := j.Retire(Incoming, values[0].ID)
		if err != nil {
			return err
		}
		if !removed {
			t.Fatal("missing retired notice")
		}
		result, err := j.Save(Incoming, values[0])
		if err != nil {
			return err
		}
		if result != "retired" {
			t.Fatal(result)
		}
		_, err = j.Save(Incoming, values[IssuerLimit])
		return err
	}))
	var escaped *Journal
	must(t, journal(t, b, func(j *Journal) error { escaped = j; return nil }))
	if _, err = escaped.List(Incoming); err == nil {
		t.Fatal("journal escaped transaction")
	}
}

func TestRetirementIsFiniteAndDoesNotBecomeConsent(t *testing.T) {
	a, b := person(t, "History issuer"), person(t, "History reader")
	g, err := groups.CreateGroup(a.identity, "History")
	must(t, err)
	values := []Notice{}
	for i := 0; i < RetiredLimit+1; i++ {
		values = append(values, invited(t, a, b, g))
	}
	must(t, journal(t, b, func(j *Journal) error {
		for _, n := range values {
			if _, err := j.Save(Incoming, n); err != nil {
				return err
			}
			if _, err := j.Retire(Incoming, n.ID); err != nil {
				return err
			}
		}
		history, err := j.retired()
		if err != nil {
			return err
		}
		if len(history.Items) != RetiredLimit {
			t.Fatal("unbounded history")
		}
		last, err := j.Save(Incoming, values[len(values)-1])
		if err != nil {
			return err
		}
		if last != "retired" {
			t.Fatal(last)
		}
		first, err := j.Save(Incoming, values[0])
		if err != nil {
			return err
		}
		if first != "stored" {
			t.Fatal("history retention is finite")
		}
		return nil
	}))
	list, err := b.g.List()
	must(t, err)
	if len(list) != 0 {
		t.Fatal("replayed invitation enrolled group")
	}
}

func TestMalformedNoticeAbortsSwallowedOuterTransaction(t *testing.T) {
	a, b := person(t, "Integrity issuer"), person(t, "Integrity reader")
	g, err := groups.CreateGroup(a.identity, "Integrity")
	must(t, err)
	n := invited(t, a, b, g)
	must(t, journal(t, b, func(j *Journal) error { _, err := j.Save(Incoming, n); return err }))
	err = b.store.Update(func(tx *groupstore.Tx) error {
		key := prefix(Incoming) + n.ID
		data, _, err := tx.Get(key)
		if err != nil {
			return err
		}
		m, err := decode(data, PlainLimit+256)
		if err != nil {
			return err
		}
		m["direction"] = "out"
		if err = tx.Put(key, encode(t, m), groupstore.Data); err != nil {
			return err
		}
		j, err := New(tx, b.identity.Public)
		if err != nil {
			return err
		}
		_, _ = j.List(Incoming)
		return tx.Put("must-not-commit", []byte("unsafe"), groupstore.Data)
	})
	if !errors.Is(err, groupstore.ErrIntegrity) {
		t.Fatal(fmt.Sprint("integrity error did not abort: ", err))
	}
	b.reopen(t)
	must(t, b.store.View(func(tx *groupstore.Tx) error {
		_, exists, err := tx.Get("must-not-commit")
		if err != nil {
			return err
		}
		if exists {
			t.Fatal("swallowed corruption committed")
		}
		j, err := New(tx, b.identity.Public)
		if err != nil {
			return err
		}
		entries, err := j.List(Incoming)
		if err == nil && len(entries) != 1 {
			t.Fatal("valid notice rolled back incorrectly")
		}
		return err
	}))
}
