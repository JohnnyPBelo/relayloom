package groups

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func newIdentity(t *testing.T, name string) core.Identity {
	t.Helper()
	identity, err := core.CreateIdentity(name)
	if err != nil {
		t.Fatal(err)
	}
	return identity
}
func newGroup(t *testing.T, a core.Identity) AnchoredGroup {
	t.Helper()
	g, err := CreateGroup(a, "Vizinhança da ribeira")
	if err != nil {
		t.Fatal(err)
	}
	return g
}
func encoded(t *testing.T, value any) []byte {
	t.Helper()
	data, err := core.Canonical(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func signedFor[T any](t *testing.T, a core.Identity, body T) Certificate[T] {
	t.Helper()
	cert, err := signCertificate(body, a, SnapshotBytes)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}
func consentFor(t *testing.T, a core.Identity, g AnchoredGroup, member core.Identity) GroupConsent {
	t.Helper()
	invite, err := CreateInvitation(a, g.Anchor, g.Epoch, member.Public)
	if err != nil {
		t.Fatal(err)
	}
	consent, err := AcceptInvitation(member, g.Anchor, g.Epoch, invite)
	if err != nil {
		t.Fatal(err)
	}
	return consent
}
func updateFor(t *testing.T, a core.Identity, g AnchoredGroup, update Update) AnchoredGroup {
	t.Helper()
	next, err := CreateSuccessor(a, g.Anchor, g.Epoch, g.Snapshot, update)
	if err != nil {
		t.Fatal(err)
	}
	return AnchoredGroup{g.Anchor, next.Epoch, next.Snapshot}
}
func joinFor(t *testing.T, a core.Identity, g AnchoredGroup, member core.Identity) AnchoredGroup {
	t.Helper()
	return updateFor(t, a, g, Update{Title: g.Snapshot.Title, Members: append(append([]core.PublicIdentity{}, g.Snapshot.Members...), member.Public), Joins: []GroupConsent{consentFor(t, a, g, member)}})
}
func rekeyFor(t *testing.T, identity core.Identity) core.Identity {
	t.Helper()
	fresh := newIdentity(t, identity.Public.Name)
	public := identity.Public
	public.BoxKey = fresh.Public.BoxKey
	keyBytes, err := base64.StdEncoding.DecodeString(identity.SignSecret)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(keyBytes)
	if err != nil {
		t.Fatal(err)
	}
	data := encoded(t, map[string]any{"id": public.ID, "name": public.Name, "signKey": public.SignKey, "boxKey": public.BoxKey})
	public.Proof = base64.StdEncoding.EncodeToString(ed25519.Sign(parsed.(ed25519.PrivateKey), data))
	if err = core.ValidateIdentity(public); err != nil {
		t.Fatal(err)
	}
	return core.Identity{Public: public, SignSecret: identity.SignSecret, BoxSecret: fresh.BoxSecret}
}

func TestAnchorSignatureAndPermanentAuthority(t *testing.T) {
	a, b := newIdentity(t, "Alice"), newIdentity(t, "Bruno")
	g := newGroup(t, a)
	if err := VerifyAnchor(g.Anchor); err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeAnchor(encoded(t, g.Anchor))
	if err != nil || decoded.ID != g.Anchor.ID {
		t.Fatal("anchor round trip", err)
	}
	if err := VerifyAnchor(signedFor(t, b, g.Anchor.Body)); err == nil {
		t.Fatal("reader forged creator authority")
	}
	wrong := g.Anchor.Body
	wrong.MembershipAuthority = "reader"
	if err := VerifyAnchor(signedFor(t, a, wrong)); err == nil {
		t.Fatal("alternate authority accepted")
	}
	carrier, err := core.CreateBundleAt(b, "group-control", map[string]any{"anchor": g.Anchor}, nil, true, 1000, 100000)
	if err != nil {
		t.Fatal(err)
	}
	if err = core.VerifyManifestAt(carrier.Manifest, 100000); err != nil {
		t.Fatal(err)
	}
	if err = core.VerifyManifestAt(carrier.Manifest, 101001); err == nil {
		t.Fatal("expired carrier accepted")
	}
	if err = VerifyAnchor(g.Anchor); err != nil {
		t.Fatal("authority wrongly depends on carrier expiry", err)
	}
	if newGroup(t, a).Anchor.ID == g.Anchor.ID {
		t.Fatal("fresh anchor reused nonce")
	}
}

func TestInvitationConsentAndExactParent(t *testing.T) {
	a, b, c := newIdentity(t, "Alice"), newIdentity(t, "Bruno"), newIdentity(t, "Clara")
	g := newGroup(t, a)
	invite, err := CreateInvitation(a, g.Anchor, g.Epoch, b.Public)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodeInvitation(encoded(t, invite), g.Anchor, g.Epoch, b.Public); err != nil {
		t.Fatal(err)
	}
	if _, err = AcceptInvitation(c, g.Anchor, g.Epoch, invite); err == nil {
		t.Fatal("wrong invitee accepted")
	}
	consent, err := AcceptInvitation(b, g.Anchor, g.Epoch, invite)
	if err != nil {
		t.Fatal(err)
	}
	if consent.Body.InvitationHash != invite.ID || len(g.Epoch.Body.Members) != 1 {
		t.Fatal("consent changed roster or lost invitation binding")
	}
	if _, err = DecodeConsent(encoded(t, consent), g.Anchor, g.Epoch, b.Public); err != nil {
		t.Fatal(err)
	}
	if err = VerifyConsent(signedFor(t, c, consent.Body), g.Anchor, g.Epoch, b.Public); err == nil {
		t.Fatal("foreign consent signature accepted")
	}
	update := Update{Title: "Juntos", Members: []core.PublicIdentity{a.Public, b.Public}, Joins: []GroupConsent{consent}}
	if _, err = CreateSuccessor(b, g.Anchor, g.Epoch, g.Snapshot, update); err == nil {
		t.Fatal("ordinary member changed roster")
	}
	joined := updateFor(t, a, g, update)
	if kind, err := VerifyTransition(g.Anchor, g.Epoch, g.Snapshot, joined.Epoch, joined.Snapshot); err != nil || kind != Nonrestrictive {
		t.Fatal("join transition", kind, err)
	}
	if err = VerifyConsent(consent, g.Anchor, joined.Epoch, b.Public); err == nil {
		t.Fatal("stale consent accepted")
	}
	update.Joins = nil
	if _, err = CreateSuccessor(a, g.Anchor, g.Epoch, g.Snapshot, update); err == nil {
		t.Fatal("join without consent accepted")
	}
}

func TestRealReaderEnvelopesRemovalAndRejoinPath(t *testing.T) {
	a, b, c := newIdentity(t, "Alice"), newIdentity(t, "Bruno"), newIdentity(t, "Clara")
	old := joinFor(t, a, newGroup(t, a), b)
	message, err := core.CreateBundle(a, "message", map[string]any{"groupEpoch": old.Epoch.ID, "text": "histórico original"}, old.Snapshot.Members, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(message, &b); err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(message, &c); err == nil {
		t.Fatal("newcomer read original history")
	}
	joined := joinFor(t, a, old, c)
	removed := updateFor(t, a, joined, Update{Title: "Depois da saída", Members: []core.PublicIdentity{a.Public, c.Public}})
	future, err := core.CreateBundle(c, "message", map[string]any{"groupEpoch": removed.Epoch.ID, "text": "conteúdo futuro"}, removed.Snapshot.Members, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(future, &a); err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(future, &b); err == nil {
		t.Fatal("removed member read new envelope")
	}
	if _, err = core.DecryptBundle(message, &b); err != nil {
		t.Fatal("removal pretended to revoke an old key", err)
	}
	rejoined := joinFor(t, a, removed, b)
	if !equalCanonical(joined.Epoch.Body.Members, rejoined.Epoch.Body.Members) {
		t.Fatal("fixture must finish with the same cards")
	}
	if kind, err := ClassifyEpochPath(old.Anchor, []GroupEpoch{joined.Epoch, removed.Epoch, rejoined.Epoch}); err != nil || kind != Restrictive {
		t.Fatal("removal/rejoin cutoff lost", kind, err)
	}
	if _, err = ClassifyEpochPath(old.Anchor, []GroupEpoch{joined.Epoch, rejoined.Epoch}); err == nil {
		t.Fatal("missing restrictive epoch ignored")
	}
}

func TestCreatorRekeyKeepsSigningAuthority(t *testing.T) {
	a, b := newIdentity(t, "Alice"), newIdentity(t, "Bruno")
	g := joinFor(t, a, newGroup(t, a), b)
	renewed := rekeyFor(t, a)
	invite, err := CreateInvitation(a, g.Anchor, g.Epoch, renewed.Public)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = AcceptInvitation(a, g.Anchor, g.Epoch, invite); err == nil {
		t.Fatal("old reading card accepted a new-card invitation")
	}
	consent, err := AcceptInvitation(renewed, g.Anchor, g.Epoch, invite)
	if err != nil {
		t.Fatal(err)
	}
	next := updateFor(t, renewed, g, Update{Title: "Nova chave de leitura", Members: []core.PublicIdentity{renewed.Public, b.Public}, Joins: []GroupConsent{consent}})
	if kind, err := VerifyEpochLink(g.Anchor, g.Epoch, next.Epoch); err != nil || kind != Restrictive {
		t.Fatal("rekey cutoff lost", kind, err)
	}
	message, err := core.CreateBundle(b, "message", map[string]any{"text": "chave nova"}, next.Snapshot.Members, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(message, &renewed); err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(message, &a); err == nil {
		t.Fatal("old reading key still opens new content")
	}
	if renewed.Public.ID != g.Anchor.Body.Creator.ID || renewed.Public.SignKey != g.Anchor.Body.Creator.SignKey {
		t.Fatal("rekey transferred signing authority")
	}
}

func TestExactSchemaAndSignedMalformedInputs(t *testing.T) {
	a, b := newIdentity(t, "Alice"), newIdentity(t, "Bruno")
	g := joinFor(t, a, newGroup(t, a), b)
	if _, err := DecodeEpoch(encoded(t, g.Epoch), g.Anchor); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeSnapshot(encoded(t, g.Snapshot), g.Anchor, g.Epoch); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeAnchor(encoded(t, map[string]any{"body": g.Anchor.Body, "id": g.Anchor.ID, "signature": g.Anchor.Signature, "extra": true})); err == nil {
		t.Fatal("unknown certificate field accepted")
	}
	bad := g.Epoch.Body
	bad.Members = append([]MemberCommitment{}, bad.Members...)
	bad.Members[0], bad.Members[1] = bad.Members[1], bad.Members[0]
	if err := VerifyEpoch(signedFor(t, a, bad), g.Anchor); err == nil {
		t.Fatal("signed unsorted roster accepted")
	}
	bad = g.Epoch.Body
	bad.Members = []MemberCommitment{bad.Members[0], bad.Members[0]}
	if err := VerifyEpoch(signedFor(t, a, bad), g.Anchor); err == nil {
		t.Fatal("duplicate member accepted")
	}
	bad = g.Epoch.Body
	bad.Domain = "relayloom/group-anchor/1"
	if err := VerifyEpoch(signedFor(t, a, bad), g.Anchor); err == nil {
		t.Fatal("wrong signing domain accepted")
	}
	changed := g.Snapshot
	changed.Title = "alterado pelo seeder"
	if err := VerifySnapshot(changed, g.Anchor, g.Epoch); err == nil {
		t.Fatal("snapshot substitution accepted")
	}
	badAnchor := g.Anchor
	badAnchor.Signature = strings.TrimSuffix(badAnchor.Signature, "=")
	if err := VerifyAnchor(badAnchor); err == nil {
		t.Fatal("noncanonical signature accepted")
	}
}

func TestClosureLeaveAndForkBoundaries(t *testing.T) {
	a, b := newIdentity(t, "Alice"), newIdentity(t, "Bruno")
	g := joinFor(t, a, newGroup(t, a), b)
	leave, err := CreateLeave(b, g.Anchor, g.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodeLeave(encoded(t, leave), g.Anchor, g.Epoch, b.Public); err != nil {
		t.Fatal(err)
	}
	if len(g.Epoch.Body.Members) != 2 {
		t.Fatal("leave request directly changed the roster")
	}
	if _, err = CreateLeave(a, g.Anchor, g.Epoch); err == nil {
		t.Fatal("creator left authority behind")
	}
	left := updateFor(t, a, g, Update{Title: "Ramo A", Members: g.Snapshot.Members})
	right := updateFor(t, a, g, Update{Title: "Ramo B", Members: g.Snapshot.Members})
	if left.Epoch.ID == right.Epoch.ID {
		t.Fatal("fork fixture is not conflicting")
	}
	if _, err = VerifyEpochLink(g.Anchor, left.Epoch, right.Epoch); err == nil {
		t.Fatal("fork accepted as successor")
	}
	if err = VerifyLeave(leave, g.Anchor, left.Epoch, b.Public); err == nil {
		t.Fatal("stale leave accepted")
	}
	closed, err := CloseGroup(a, g.Anchor, g.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	if err = VerifySnapshot(g.Snapshot, g.Anchor, closed); err != nil {
		t.Fatal("closure altered historical state", err)
	}
	if _, err = CloseGroup(a, g.Anchor, closed); err == nil {
		t.Fatal("closed group extended")
	}
	if _, err = CreateInvitation(a, g.Anchor, closed, b.Public); err == nil {
		t.Fatal("closed group invited a member")
	}
	// This is only a signed high-number header; it does not prove complete ancestry.
	body := g.Epoch.Body
	body.Number = 1022
	lastOpen := signedFor(t, a, body)
	last, err := CloseGroup(a, g.Anchor, lastOpen)
	if err != nil || last.Body.Number != 1023 {
		t.Fatal("reserved closure slot", err)
	}
	body.Number = 1023
	if err = VerifyEpoch(signedFor(t, a, body), g.Anchor); err == nil {
		t.Fatal("final epoch allowed to stay open")
	}
}

func TestRosterBoundsAndUTF16Titles(t *testing.T) {
	a := newIdentity(t, "Alice")
	g := newGroup(t, a)
	members := []core.PublicIdentity{a.Public}
	joins := []GroupConsent{}
	for i := 0; i < 63; i++ {
		member := newIdentity(t, "Membro")
		members = append(members, member.Public)
		joins = append(joins, consentFor(t, a, g, member))
	}
	update := Update{Title: strings.Repeat("😀", 128), Members: members, Joins: joins}
	full := updateFor(t, a, g, update)
	if len(full.Epoch.Body.Members) != 64 || len(full.Snapshot.Joins) != 63 {
		t.Fatal("full-roster positive control failed")
	}
	if _, err := DecodeSnapshot(encoded(t, full.Snapshot), full.Anchor, full.Epoch); err != nil {
		t.Fatal(err)
	}
	update.Title += "x"
	if _, err := CreateSuccessor(a, g.Anchor, g.Epoch, g.Snapshot, update); err == nil {
		t.Fatal("UTF-16 title limit ignored")
	}
	update.Title = "Limite"
	update.Members = append(append([]core.PublicIdentity{}, members...), newIdentity(t, "Excedente").Public)
	if _, err := CreateSuccessor(a, g.Anchor, g.Epoch, g.Snapshot, update); err == nil {
		t.Fatal("65th member accepted")
	}
	if len(g.Snapshot.Members) != 1 {
		t.Fatal("capacity failure mutated original group")
	}
	// The core parser preserves an escaped lone UTF-16 surrogate as WTF-8.
	lone := strings.Repeat("\xed\xa0\x80", 256)
	unicodeGroup, err := CreateGroup(a, lone)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeSnapshot(encoded(t, unicodeGroup.Snapshot), unicodeGroup.Anchor, unicodeGroup.Epoch)
	if err != nil || decoded.Title != lone {
		t.Fatal("lone-surrogate canonical round trip changed bytes", err)
	}
	if _, err = CreateGroup(a, lone+"x"); err == nil {
		t.Fatal("lone-surrogate UTF-16 limit ignored")
	}
}

func TestSnapshotNeedsExactConsentSetAndPinnedCards(t *testing.T) {
	a, b, c := newIdentity(t, "Alice"), newIdentity(t, "Bruno"), newIdentity(t, "Clara")
	g := newGroup(t, a)
	consent := consentFor(t, a, g, b)
	update := Update{Title: "Com Bruno", Members: []core.PublicIdentity{a.Public, b.Public}, Joins: []GroupConsent{consent, consent}}
	if _, err := CreateSuccessor(a, g.Anchor, g.Epoch, g.Snapshot, update); err == nil {
		t.Fatal("duplicate consent accepted")
	}
	update.Joins = []GroupConsent{consentFor(t, a, g, c)}
	if _, err := CreateSuccessor(a, g.Anchor, g.Epoch, g.Snapshot, update); err == nil {
		t.Fatal("unrelated member consent accepted")
	}
	joined := joinFor(t, a, g, b)
	renewed := rekeyFor(t, b)
	if err := VerifyConsent(consent, g.Anchor, g.Epoch, renewed.Public); err == nil {
		t.Fatal("reading-card substitution accepted")
	}
	if _, err := CreateSuccessor(a, joined.Anchor, joined.Epoch, joined.Snapshot, Update{Title: "Rekey sem consentimento", Members: []core.PublicIdentity{a.Public, renewed.Public}}); err == nil {
		t.Fatal("implicit contact-card rekey accepted")
	}
}
