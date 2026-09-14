// Package groupnotice verifies explicit invitation/consent/leave notices. A
// notice alone cannot enrol a profile or change the authoritative membership.
package groupnotice

import (
	"bytes"
	"errors"
	"sort"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
)

const PlainLimit = 32 * 1024
const BundleLimit = 64 * 1024
const TTL = int64(3600000)
const InboxLimit = 64
const OutboxLimit = 64
const IssuerLimit = 8
const RetiredLimit = 256

type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }
func bad(message string) error      { return &InputError{message} }
func str(value any) string          { text, _ := value.(string); return text }
func exact(value map[string]any, fields ...string) bool {
	if len(value) != len(fields) {
		return false
	}
	for _, key := range fields {
		if _, ok := value[key]; !ok {
			return false
		}
	}
	return true
}
func equal(a, b any) bool {
	x, e := core.Canonical(a)
	y, f := core.Canonical(b)
	return e == nil && f == nil && bytes.Equal(x, y)
}

type Notice struct {
	Raw      map[string]any
	Kind, ID string
	Anchor   groups.GroupAnchor
	Parent   groups.GroupEpoch
	Member   core.PublicIdentity
}

func Parse(value any) (Notice, error) {
	var n Notice
	data, err := core.Canonical(value)
	if err != nil {
		return n, bad(err.Error())
	}
	decoded, err := core.DecodeJSON(data, PlainLimit)
	if err != nil {
		return n, bad(err.Error())
	}
	v, ok := decoded.(map[string]any)
	if !ok {
		return n, bad("aviso inválido")
	}
	fields := []string{"type", "version", "kind", "anchor", "parent", "member", "certificate"}
	if v["kind"] == "consent" {
		fields = append(fields, "invitation")
	}
	if !exact(v, fields...) || v["type"] != "group-notice" || !equal(v["version"], 1) {
		return n, bad("campos de aviso inválidos")
	}
	encode := func(key string) []byte { b, _ := core.Canonical(v[key]); return b }
	n.Raw, n.Kind = v, str(v["kind"])
	n.Anchor, err = groups.DecodeAnchor(encode("anchor"))
	if err != nil {
		return n, bad(err.Error())
	}
	n.Parent, err = groups.DecodeEpoch(encode("parent"), n.Anchor)
	if err != nil {
		return n, bad(err.Error())
	}
	n.Member, err = core.DecodePublicIdentity(encode("member"))
	if err != nil {
		return n, bad(err.Error())
	}
	if n.Member.ID == n.Anchor.Body.Creator.ID {
		return n, bad("aviso exige membro distinto do criador")
	}
	switch n.Kind {
	case "invitation":
		var c groups.GroupInvitation
		c, err = groups.DecodeInvitation(encode("certificate"), n.Anchor, n.Parent, n.Member)
		n.ID = c.ID
	case "consent":
		var invitation groups.GroupInvitation
		invitation, err = groups.DecodeInvitation(encode("invitation"), n.Anchor, n.Parent, n.Member)
		if err == nil {
			var c groups.GroupConsent
			c, err = groups.DecodeConsent(encode("certificate"), n.Anchor, n.Parent, n.Member)
			n.ID = c.ID
			if err == nil && c.Body.InvitationHash != invitation.ID {
				err = errors.New("consentimento não corresponde ao convite")
			}
		}
	case "leave":
		var c groups.GroupLeave
		c, err = groups.DecodeLeave(encode("certificate"), n.Anchor, n.Parent, n.Member)
		n.ID = c.ID
	default:
		err = errors.New("tipo de aviso desconhecido")
	}
	if err != nil {
		return n, bad(err.Error())
	}
	return n, nil
}
func (n Notice) Parties() (issuer, recipient core.PublicIdentity) {
	if n.Kind == "invitation" {
		return n.Anchor.Body.Creator, n.Member
	}
	return n.Member, n.Anchor.Body.Creator
}
func VerifyEnvelope(b core.Bundle) error {
	data, err := core.Canonical(b)
	if err != nil {
		return bad(err.Error())
	}
	if len(data) > BundleLimit {
		return bad("envelope de aviso excede limite")
	}
	if err = core.VerifyBundle(b); err != nil {
		return bad(err.Error())
	}
	if !ManifestPolicy(b.Manifest) {
		return bad("aviso exige envelope privado limitado")
	}
	return nil
}
func ManifestPolicy(m core.Manifest) bool {
	size := 0
	for _, c := range m.Chunks {
		size += c.Size
	}
	return m.Kind == "group-notice" && m.PublicKey == nil && m.Expires-m.Created <= TTL+10 && size <= PlainLimit
}
func Open(b core.Bundle, id core.Identity) (Notice, error) {
	var n Notice
	if err := VerifyEnvelope(b); err != nil {
		return n, err
	}
	value, err := core.DecryptBundle(b, &id)
	if err != nil {
		return n, bad(err.Error())
	}
	n, err = Parse(value)
	if err != nil {
		return n, err
	}
	issuer, recipient := n.Parties()
	if !equal(b.Manifest.Author, issuer) {
		return n, bad("assinante exterior não é o emissor")
	}
	expected := []string{issuer.ID, recipient.ID}
	sort.Strings(expected)
	readers := []string{}
	for _, k := range b.Manifest.Keys {
		readers = append(readers, k.Reader)
	}
	sort.Strings(readers)
	if !equal(readers, expected) {
		return n, bad("aviso alarga os destinatários")
	}
	return n, nil
}
func Seal(id core.Identity, value Notice) (core.Bundle, error) {
	var b core.Bundle
	n, err := Parse(value.Raw)
	if err != nil {
		return b, err
	}
	issuer, recipient := n.Parties()
	if !equal(id.Public, issuer) {
		return b, bad("só o emissor pode assinar o aviso")
	}
	b, err = core.CreateBundle(id, "group-notice", n.Raw, []core.PublicIdentity{recipient}, false, TTL)
	if err != nil {
		return b, err
	}
	_, err = Open(b, id)
	return b, err
}
