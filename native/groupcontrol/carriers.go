// Package groupcontrol encodes private proof carriers. Outer signatures do not
// confer membership authority; creator certificates are verified by the registry.
package groupcontrol

import (
	"bytes"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groups"
)

const PlainLimit = 1024 * 1024
const BundleLimit = 2 * 1024 * 1024
const TTL = int64(3600000)

type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }
func bad(message string) error      { return &InputError{message} }

type Authorization struct {
	Number     int
	ID         string
	Invitation any
}
type Control struct {
	Raw                          map[string]any
	Action, GroupID, To, EpochID string
	From, Count, Number          int
	Authorization                Authorization
	Headers                      []any
	Head, Epoch, Snapshot        any
}

func str(v any) string { s, _ := v.(string); return s }
func integer(v any) (int, bool) {
	var n int64
	switch v := v.(type) {
	case int:
		n = int64(v)
	case int64:
		n = v
	case float64:
		n = int64(v)
		if float64(n) != v {
			return 0, false
		}
	case json.Number:
		var e error
		n, e = strconv.ParseInt(string(v), 10, 64)
		if e != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	return int(n), n >= 0 && n < 1024
}
func exact(v map[string]any, fields ...string) bool {
	if len(v) != len(fields) {
		return false
	}
	for _, key := range fields {
		if _, ok := v[key]; !ok {
			return false
		}
	}
	return true
}
func bounded(value any, limit int) error {
	data, err := core.Canonical(value)
	if err != nil {
		return bad(err.Error())
	}
	if len(data) > limit {
		return bad("carrier excede limite")
	}
	return nil
}
func equal(a, b any) bool {
	x, e := core.Canonical(a)
	y, f := core.Canonical(b)
	return e == nil && f == nil && bytes.Equal(x, y)
}
func ids(cards []core.PublicIdentity) []string {
	out := []string{}
	for _, card := range cards {
		out = append(out, card.ID)
	}
	sort.Strings(out)
	return out
}
func readers(bundle core.Bundle) []string {
	out := []string{}
	for _, key := range bundle.Manifest.Keys {
		out = append(out, key.Reader)
	}
	sort.Strings(out)
	return out
}

// Parse checks structure/resources, not every certificate in a page. Valid
// restrictive prefixes must reach the registry even if a later proof is bad.
func Parse(value any) (Control, error) {
	var c Control
	if err := bounded(value, PlainLimit); err != nil {
		return c, err
	}
	data, err := core.Canonical(value)
	if err != nil {
		return c, err
	}
	decoded, err := core.DecodeJSON(data, PlainLimit)
	if err != nil {
		return c, bad(err.Error())
	}
	v, ok := decoded.(map[string]any)
	if !ok {
		return c, bad("carrier inválido")
	}
	version, ok := integer(v["version"])
	if !ok || version != 1 || str(v["type"]) != "group-control" || !core.ValidAddress(str(v["groupId"])) {
		return c, bad("carrier inválido")
	}
	c.Raw, c.Action, c.GroupID = v, str(v["action"]), str(v["groupId"])
	common := []string{"type", "version", "groupId", "action"}
	switch c.Action {
	case "headers-request":
		if !exact(v, append(common, "to", "from", "count", "authorization")...) {
			return c, bad("campos de pedido inválidos")
		}
		c.To = str(v["to"])
		c.From, ok = integer(v["from"])
		count, countOK := integer(v["count"])
		c.Count = count
		auth, authOK := v["authorization"].(map[string]any)
		if !core.ValidAddress(c.To) || !ok || !countOK || count < 1 || count > groupauthority.PageLimit || !authOK {
			return c, bad("pedido de headers inválido")
		}
		fields := []string{"number", "id"}
		if _, has := auth["invitation"]; has {
			fields = append(fields, "invitation")
		}
		if !exact(auth, fields...) {
			return c, bad("autorização inválida")
		}
		c.Authorization.Number, ok = integer(auth["number"])
		c.Authorization.ID = str(auth["id"])
		c.Authorization.Invitation = auth["invitation"]
		if !ok || !core.ValidAddress(c.Authorization.ID) {
			return c, bad("autorização inválida")
		}
		if _, has := auth["invitation"]; has {
			if err = bounded(auth["invitation"], groups.CertificateBytes); err != nil {
				return c, err
			}
		}
	case "snapshot-request":
		if !exact(v, append(common, "to", "number", "epochId")...) {
			return c, bad("campos de pedido inválidos")
		}
		c.To, c.EpochID = str(v["to"]), str(v["epochId"])
		c.Number, ok = integer(v["number"])
		if !ok || !core.ValidAddress(c.To) || !core.ValidAddress(c.EpochID) {
			return c, bad("pedido de snapshot inválido")
		}
	case "headers":
		if !exact(v, append(common, "to", "from", "headers", "head")...) {
			return c, bad("campos de headers inválidos")
		}
		c.To = str(v["to"])
		c.From, ok = integer(v["from"])
		var headersOK bool
		c.Headers, headersOK = v["headers"].([]any)
		c.Head = v["head"]
		if !core.ValidAddress(c.To) || !ok || !headersOK || len(c.Headers) > groupauthority.PageLimit {
			return c, bad("página inválida")
		}
		if err = bounded(c.Headers, groupauthority.PageBytes); err != nil {
			return c, err
		}
		if err = bounded(c.Head, groups.HeaderBytes); err != nil {
			return c, err
		}
		for _, header := range c.Headers {
			if err = bounded(header, groups.HeaderBytes); err != nil {
				return c, err
			}
		}
	case "snapshot":
		fields := append(common, "epoch", "snapshot")
		if _, present := v["to"]; present {
			fields = append(fields, "to")
			c.To = str(v["to"])
			if !core.ValidAddress(c.To) {
				return c, bad("destinatário inválido")
			}
		}
		if !exact(v, fields...) {
			return c, bad("campos de snapshot inválidos")
		}
		c.Epoch, c.Snapshot = v["epoch"], v["snapshot"]
		if err = bounded(c.Epoch, groups.HeaderBytes); err != nil {
			return c, err
		}
		if err = bounded(c.Snapshot, groups.SnapshotBytes); err != nil {
			return c, err
		}
	default:
		return c, bad("acção de controlo desconhecida")
	}
	return c, nil
}

// ManifestPolicy is for already verified manifests. Ciphertext has the same
// length as plaintext (the GCM tag is separate), even for an opaque seeder.
func ManifestPolicy(m core.Manifest) bool {
	bytes := 0
	for _, c := range m.Chunks {
		bytes += c.Size
	}
	return m.Kind == "group-control" && m.PublicKey == nil && m.Expires-m.Created <= TTL+10 && bytes <= PlainLimit
}

func VerifyEnvelope(bundle core.Bundle) error {
	if err := bounded(bundle, BundleLimit); err != nil {
		return err
	}
	if err := core.VerifyBundle(bundle); err != nil {
		return bad(err.Error())
	}
	if !ManifestPolicy(bundle.Manifest) || bundle.Manifest.Expires <= time.Now().UnixMilli() {
		return bad("controlo exige envelope privado limitado e não expirado")
	}
	return nil
}

func Open(bundle core.Bundle, identity core.Identity) (Control, error) {
	var c Control
	if err := VerifyEnvelope(bundle); err != nil {
		return c, err
	}
	value, err := core.DecryptBundle(bundle, &identity)
	if err != nil {
		return c, bad(err.Error())
	}
	c, err = Parse(value)
	if err != nil {
		return c, err
	}
	if c.To != "" {
		if c.To != identity.Public.ID && bundle.Manifest.Author.ID != identity.Public.ID {
			return c, bad("carrier dirigido a outra identidade")
		}
		expected := []string{c.To}
		if c.To != bundle.Manifest.Author.ID {
			expected = append(expected, bundle.Manifest.Author.ID)
		}
		sort.Strings(expected)
		if !equal(readers(bundle), expected) {
			return c, bad("envelope de controlo alarga audiência")
		}
	}
	return c, nil
}
func Seal(identity core.Identity, payload map[string]any, recipients []core.PublicIdentity) (core.Bundle, error) {
	var bundle core.Bundle
	c, err := Parse(payload)
	if err != nil {
		return bundle, err
	}
	bundle, err = core.CreateBundle(identity, "group-control", c.Raw, recipients, false, TTL)
	if err != nil {
		return bundle, err
	}
	verified, err := Open(bundle, identity)
	if err != nil {
		return bundle, err
	}
	if !equal(c.Raw, verified.Raw) {
		return bundle, errors.New("controlo assinado incoerente")
	}
	return bundle, nil
}
func HasCard(epoch groups.GroupEpoch, card core.PublicIdentity) bool {
	hash, err := groups.MemberCardHash(card)
	if err != nil {
		return false
	}
	for _, member := range epoch.Body.Members {
		if member.ID == card.ID && member.CardHash == hash {
			return true
		}
	}
	return false
}
func retained(g *groupauthority.Registry, id string, number int, epochID string, allowFork bool) (groups.GroupEpoch, error) {
	var result groups.GroupEpoch
	if _, err := g.ScopeGeneration(); err != nil {
		return result, err
	}
	headers, err := g.Proofs(id, number, 1)
	if err != nil {
		return result, err
	}
	if len(headers) > 0 && headers[0].ID == epochID {
		return headers[0], nil
	}
	if allowFork {
		stop, err := g.StopEvidence(id)
		if err != nil {
			return result, err
		}
		if stop != nil && stop.Reason == "forked" {
			for _, epoch := range []*groups.GroupEpoch{stop.First, stop.Second} {
				if epoch != nil && epoch.Body.Number == number && epoch.ID == epochID {
					return *epoch, nil
				}
			}
		}
	}
	return result, bad("época de autorização indisponível")
}
func privateEpoch(g *groupauthority.Registry, epoch groups.GroupEpoch) error {
	stop, err := g.StopEvidence(epoch.Body.GroupID)
	if err != nil {
		return err
	}
	if stop != nil && stop.Reason == "forked" && epoch.Body.Number >= stop.First.Body.Number {
		return bad("snapshot de época em conflito não pode ser redistribuído")
	}
	return nil
}

type HeaderResult struct {
	Headers []groups.GroupEpoch
	Head    groups.GroupEpoch
}

func RequestedHeaders(g *groupauthority.Registry, c Control, requester core.PublicIdentity) (HeaderResult, error) {
	var result HeaderResult
	parsed, parseErr := Parse(c.Raw)
	if parseErr != nil {
		return result, parseErr
	}
	c = parsed
	if c.Action != "headers-request" {
		return result, bad("pedido inválido")
	}
	anchor, err := g.Anchor(c.GroupID)
	if err != nil {
		return result, err
	}
	auth, err := retained(g, c.GroupID, c.Authorization.Number, c.Authorization.ID, true)
	if err != nil {
		return result, err
	}
	end := auth
	if _, present := c.Raw["authorization"].(map[string]any)["invitation"]; present {
		raw, err := core.Canonical(c.Authorization.Invitation)
		if err != nil {
			return result, bad(err.Error())
		}
		if _, err = groups.DecodeInvitation(raw, anchor, auth, requester); err != nil {
			return result, bad(err.Error())
		}
		next, err := g.Proofs(c.GroupID, min(1023, auth.Body.Number+1), 1)
		if err != nil {
			return result, err
		}
		if len(next) > 0 {
			end = next[0]
		}
	} else {
		if !HasCard(auth, requester) {
			return result, bad("solicitante não pertence à época")
		}
		cursor, stopped := auth.Body.Number+1, auth.Body.State == "closed"
		for !stopped && cursor < 1024 {
			page, err := g.Proofs(c.GroupID, cursor, groupauthority.PageLimit)
			if err != nil {
				return result, err
			}
			if len(page) == 0 {
				break
			}
			for _, header := range page {
				end = header
				cursor = header.Body.Number + 1
				if header.Body.State == "closed" || !HasCard(header, requester) {
					stopped = true
					break
				}
			}
		}
	}
	result.Head = end
	result.Headers = []groups.GroupEpoch{}
	if c.From <= end.Body.Number {
		result.Headers, err = g.Proofs(c.GroupID, c.From, min(c.Count, end.Body.Number-c.From+1))
		if err != nil {
			return result, err
		}
	}
	conflict, err := g.StopEvidence(c.GroupID)
	if err != nil {
		return result, err
	}
	if conflict != nil && conflict.Reason == "forked" && conflict.First.Body.Number <= end.Body.Number {
		extra := []groups.GroupEpoch{*conflict.First, *conflict.Second}
		if extra[0].ID == auth.ID {
			extra[0], extra[1] = extra[1], extra[0]
		}
		for _, header := range extra {
			found := false
			for _, item := range result.Headers {
				found = found || item.ID == header.ID
			}
			if found {
				continue
			}
			candidate := append(append([]groups.GroupEpoch{}, result.Headers...), header)
			if len(candidate) > c.Count || bounded(candidate, groupauthority.PageBytes) != nil {
				break
			}
			result.Headers = candidate
		}
	}
	return result, nil
}

type SnapshotResult struct {
	Epoch    groups.GroupEpoch
	Snapshot groups.GroupSnapshot
}

func RequestedSnapshot(g *groupauthority.Registry, c Control, requester, producer core.PublicIdentity) (SnapshotResult, error) {
	var result SnapshotResult
	parsed, parseErr := Parse(c.Raw)
	if parseErr != nil {
		return result, parseErr
	}
	c = parsed
	if c.Action != "snapshot-request" {
		return result, bad("pedido inválido")
	}
	epoch, err := retained(g, c.GroupID, c.Number, c.EpochID, false)
	if err != nil {
		return result, err
	}
	if !HasCard(epoch, requester) || !HasCard(epoch, producer) {
		return result, bad("snapshot não autoriza estes cartões")
	}
	if err = privateEpoch(g, epoch); err != nil {
		return result, err
	}
	snapshot, err := g.PrivateState(c.GroupID, epoch.ID)
	if err != nil {
		return result, err
	}
	if snapshot == nil {
		return result, bad("snapshot privado indisponível")
	}
	result = SnapshotResult{epoch, *snapshot}
	return result, nil
}

type Material struct {
	Payload map[string]any
	Readers []core.PublicIdentity
}

func SnapshotMaterial(g *groupauthority.Registry, producer core.PublicIdentity, epoch groups.GroupEpoch, snapshot groups.GroupSnapshot, recipient ...core.PublicIdentity) (Material, error) {
	var result Material
	if _, err := g.ScopeGeneration(); err != nil {
		return result, err
	}
	anchor, err := g.Anchor(epoch.Body.GroupID)
	if err != nil {
		return result, err
	}
	if err = groups.VerifyEpoch(epoch, anchor); err != nil {
		return result, err
	}
	if err = groups.VerifySnapshot(snapshot, anchor, epoch); err != nil {
		return result, err
	}
	if err = privateEpoch(g, epoch); err != nil {
		return result, err
	}
	if _, err = retained(g, anchor.ID, epoch.Body.Number, epoch.ID, false); err != nil {
		return result, err
	}
	if !HasCard(epoch, producer) {
		return result, bad("só leitor autorizado pode transportar snapshot")
	}
	result = Material{map[string]any{"type": "group-control", "version": 1, "action": "snapshot", "groupId": anchor.ID, "epoch": epoch, "snapshot": snapshot}, snapshot.Members}
	if len(recipient) > 1 {
		return result, bad("destinatário inválido")
	}
	if len(recipient) == 1 {
		if !HasCard(epoch, recipient[0]) {
			return result, bad("destinatário fora do snapshot")
		}
		result.Payload["to"] = recipient[0].ID
		result.Readers = []core.PublicIdentity{recipient[0]}
	}
	return result, nil
}
func SnapshotPreview(bundle core.Bundle, c Control, anchor groups.GroupAnchor) (SnapshotResult, error) {
	var result SnapshotResult
	if c.Action != "snapshot" {
		return result, bad("snapshot inválido")
	}
	raw, err := core.Canonical(c.Epoch)
	if err != nil {
		return result, bad(err.Error())
	}
	epoch, err := groups.DecodeEpoch(raw, anchor)
	if err != nil {
		return result, bad(err.Error())
	}
	raw, err = core.Canonical(c.Snapshot)
	if err != nil {
		return result, bad(err.Error())
	}
	snapshot, err := groups.DecodeSnapshot(raw, anchor, epoch)
	if err != nil {
		return result, bad(err.Error())
	}
	expected := ids(snapshot.Members)
	if c.To != "" {
		found := false
		for _, m := range epoch.Body.Members {
			found = found || m.ID == c.To
		}
		if !found {
			return result, bad("destinatário fora do snapshot")
		}
		expected = []string{c.To}
		if c.To != bundle.Manifest.Author.ID {
			expected = append(expected, bundle.Manifest.Author.ID)
		}
		sort.Strings(expected)
	}
	if !HasCard(epoch, bundle.Manifest.Author) || !equal(readers(bundle), expected) {
		return result, bad("carrier de snapshot alarga leitores ou assinante")
	}
	result = SnapshotResult{epoch, snapshot}
	return result, nil
}
func CheckedSnapshot(g *groupauthority.Registry, bundle core.Bundle, c Control) (SnapshotResult, error) {
	var result SnapshotResult
	if _, err := g.ScopeGeneration(); err != nil {
		return result, err
	}
	anchor, err := g.Anchor(c.GroupID)
	if err != nil {
		return result, err
	}
	result, err = SnapshotPreview(bundle, c, anchor)
	if err != nil {
		return result, err
	}
	if _, err = retained(g, c.GroupID, result.Epoch.Body.Number, result.Epoch.ID, false); err != nil {
		return result, err
	}
	if err = privateEpoch(g, result.Epoch); err != nil {
		return result, err
	}
	return result, nil
}
