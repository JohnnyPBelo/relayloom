package sites

import (
	"encoding/json"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"sort"
	"strings"
)

func shapeOptional(value any, required []string, optional string) (map[string]any, error) {
	m, e := object(value, required...)
	if e == nil {
		return m, nil
	}
	return object(value, append(append([]string{}, required...), optional)...)
}
func cloneValue(value any) (any, error) {
	b, e := core.Canonical(value)
	if e != nil {
		return nil, e
	}
	return core.DecodeJSON(b, PrivateBytes)
}
func jsonTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, e := x.Float64()
		return e != nil || f != 0
	case float64:
		return x != 0
	case int:
		return x != 0
	case int64:
		return x != 0
	}
	return true
}

// ParsePayload validates the complete authored document before hashing it. The
// legacy fallback blocks retain their existing wire semantics; rich blocks use
// the same strict validator as the native editor.
func ParsePayload(value any) (map[string]any, error) {
	p, e := shapeOptional(value, []string{"type", "blocks", "theme", "site"}, "attachments")
	if e != nil {
		return nil, e
	}
	if p["type"] != "site" || !docContains([]string{"sand", "forest", "ink"}, docTextValue(p["theme"])) {
		return nil, errors.New("documento de site inválido")
	}
	if assets, exists := p["attachments"]; exists {
		list, ok := assets.([]any)
		if !ok || len(list) > 4 {
			return nil, errors.New("anexos de site inválidos")
		}
		for _, value := range list {
			m, ok := value.(map[string]any)
			if !ok || !siteText(m["name"], 150) || !siteText(m["mime"], 100) {
				return nil, errors.New("anexo inválido")
			}
			data, ok := m["data"].(string)
			if !ok || len(data) > 3500000 {
				return nil, errors.New("dados do anexo inválidos")
			}
		}
	}
	if e = ValidateDocument(p["site"], p["attachments"]); e != nil {
		return nil, e
	}
	blocks, ok := p["blocks"].([]any)
	if !ok || len(blocks) > 24 {
		return nil, errors.New("blocos de compatibilidade inválidos")
	}
	for _, v := range blocks {
		b, ok := v.(map[string]any)
		if !ok || !siteText(b["id"], 64) || !docContains([]string{"hero", "text", "links", "callout"}, docTextValue(b["type"])) || !siteText(b["title"], 120) || !siteText(b["body"], 4000) {
			return nil, errors.New("bloco declarativo inválido")
		}
		if url := b["url"]; jsonTruthy(url) {
			s, ok := url.(string)
			if !ok || docLength(s) > 2000 || !strings.HasPrefix(s, "https://") {
				return nil, errors.New("ligação inválida")
			}
		}
	}
	if _, e = DocumentHash(p); e != nil {
		return nil, e
	}
	owned, e := cloneValue(p)
	if e != nil {
		return nil, e
	}
	return owned.(map[string]any), nil
}
func CreateContent(identity core.Identity, name string, number int64, previous []string, value any) (map[string]any, error) {
	p, e := ParsePayload(value)
	if e != nil {
		return nil, e
	}
	h, e := DocumentHash(p)
	if e != nil {
		return nil, e
	}
	r, e := CreateRevision(identity, name, number, previous, h)
	if e != nil {
		return nil, e
	}
	p["siteRevision"] = r
	return p, nil
}

type VerifiedContent struct {
	Content  map[string]any
	Revision Revision
}

func VerifyContent(value any, author core.PublicIdentity, expectedName string) (VerifiedContent, error) {
	var empty VerifiedContent
	m, e := shapeOptional(value, []string{"type", "blocks", "theme", "site", "siteRevision"}, "attachments")
	if e != nil {
		return empty, e
	}
	if e = core.ValidateIdentity(author); e != nil {
		return empty, e
	}
	data := map[string]any{}
	for k, v := range m {
		if k != "siteRevision" {
			data[k] = v
		}
	}
	p, e := ParsePayload(data)
	if e != nil {
		return empty, e
	}
	r, e := recordRevision(m["siteRevision"])
	if e != nil {
		return empty, e
	}
	if expectedName == "" {
		expectedName = r.Body.Name
	}
	if e = VerifySnapshot(r, p, author.ID, expectedName); e != nil {
		return empty, e
	}
	p["siteRevision"] = r
	return VerifiedContent{p, r}, nil
}

type RequestContext struct {
	Sequence       int64    `json:"sequence"`
	OperationID    string   `json:"operationId"`
	ExpectedBase   string   `json:"expectedBase"`
	Readers        any      `json:"readers"`
	TTLMS          int64    `json:"ttlMs"`
	ConfirmedHeads []string `json:"confirmedHeads,omitempty"`
}
type NormalizedRequest struct {
	Context     RequestContext `json:"context"`
	Payload     map[string]any `json:"payload"`
	Fingerprint string         `json:"fingerprint"`
}

func (c RequestContext) Value() map[string]any {
	v := map[string]any{"sequence": c.Sequence, "operationId": c.OperationID, "expectedBase": c.ExpectedBase, "readers": c.Readers, "ttlMs": c.TTLMS}
	if c.ConfirmedHeads != nil {
		v["confirmedHeads"] = c.ConfirmedHeads
	}
	return v
}
func NormalizeRequest(owner core.PublicIdentity, name string, input any) (NormalizedRequest, error) {
	var empty NormalizedRequest
	owned, cloneError := cloneValue(input)
	if cloneError != nil {
		return empty, cloneError
	}
	input = owned
	if e := core.ValidateIdentity(owner); e != nil {
		return empty, e
	}
	if _, e := Address(owner.ID, name); e != nil {
		return empty, e
	}
	m, e := shapeOptional(input, []string{"sequence", "operationId", "expectedBase", "readers", "ttlMs", "payload"}, "confirmedHeads")
	if e != nil {
		return empty, e
	}
	sequence, e := docNumber(m["sequence"])
	if e != nil {
		return empty, e
	}
	ttl, e := docNumber(m["ttlMs"])
	if e != nil {
		return empty, e
	}
	id, base := docTextValue(m["operationId"]), docTextValue(m["expectedBase"])
	if sequence < 1 || sequence > MaxSequence || ttl < 1000 || ttl > 365*86400000 || !operationPattern.MatchString(id) || !core.ValidAddress(base) {
		return empty, errors.New("parâmetros de publicação inválidos")
	}
	context := RequestContext{Sequence: sequence, OperationID: id, ExpectedBase: base, TTLMS: ttl, Readers: "public"}
	if value, exists := m["confirmedHeads"]; exists {
		context.ConfirmedHeads, e = recordStrings(value, RegistryHeaders)
		if e != nil || len(context.ConfirmedHeads) < 2 || !validIDs(context.ConfirmedHeads, RegistryHeaders) {
			return empty, errors.New("confirmação das versões concorrentes inválida")
		}
	}
	if m["readers"] != "public" {
		list, ok := m["readers"].([]any)
		if !ok || len(list) > 64 {
			return empty, errors.New("leitores inválidos")
		}
		cards := map[string]core.PublicIdentity{owner.ID: owner}
		for _, v := range list {
			data, e := core.Canonical(v)
			if e != nil {
				return empty, e
			}
			card, e := core.DecodePublicIdentity(data)
			if e != nil {
				return empty, e
			}
			if e = core.ValidateIdentity(card); e != nil {
				return empty, e
			}
			if prior, exists := cards[card.ID]; exists {
				a, _ := core.Canonical(prior)
				b, _ := core.Canonical(card)
				if string(a) != string(b) {
					return empty, errors.New("cartões diferentes para o mesmo leitor")
				}
			}
			cards[card.ID] = card
		}
		if len(cards) > 64 {
			return empty, errors.New("demasiados leitores")
		}
		ids := []string{}
		for id := range cards {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		normalized := make([]core.PublicIdentity, len(ids))
		for i, id := range ids {
			normalized[i] = cards[id]
		}
		context.Readers = normalized
	}
	p, e := ParsePayload(m["payload"])
	if e != nil {
		return empty, e
	}
	h, e := DocumentHash(p)
	if e != nil {
		return empty, e
	}
	fingerprint := context.Value()
	fingerprint["domain"] = "relayloom/site-publication-request/1"
	fingerprint["ownerId"] = owner.ID
	fingerprint["name"] = name
	fingerprint["documentHash"] = h
	data, e := core.Canonical(fingerprint)
	if e != nil {
		return empty, e
	}
	return NormalizedRequest{context, p, core.Hash(data)}, nil
}
