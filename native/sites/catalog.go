package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"sort"
	"strings"
	"time"
)

const CatalogLimit = 64

type CatalogDatabase interface {
	Update(func(*groupstore.Tx) error) error
}
type catalogEntry struct {
	OwnerID string `json:"ownerId"`
	Name    string `json:"name"`
}
type catalogIndex struct {
	Domain string         `json:"domain"`
	Sites  []catalogEntry `json:"sites"`
}
type OperationHandle struct {
	Sequence    int64  `json:"sequence"`
	OperationID string `json:"operationId"`
	Fingerprint string `json:"fingerprint"`
}
type OperationSummary struct {
	OperationHandle
	BundleID  string `json:"bundleId"`
	Phase     string `json:"phase"`
	Requested bool   `json:"requested"`
}
type BundleHint struct {
	RevisionID string   `json:"revisionId"`
	Bundles    []string `json:"bundles"`
}
type CatalogState struct {
	RecordState
	Base        string             `json:"base"`
	BundleHints []BundleHint       `json:"bundleHints"`
	Pending     []OperationSummary `json:"pending"`
}
type PendingPublication struct {
	Name string `json:"name"`
	OperationSummary
}
type PreparationAccess struct {
	Readers any `json:"readers"`
}
type Catalog struct {
	database CatalogDatabase
	identity core.Identity
	indexKey string
	now      func() int64
}

func NewCatalog(database CatalogDatabase, identity core.Identity) *Catalog {
	data, _ := core.Canonical(map[string]any{"domain": "relayloom/local-site-catalog-key/1", "owner": identity.Public.ID})
	return &Catalog{database, identity, "site:" + core.Hash(data) + ":record", func() int64 { return time.Now().UnixMilli() }}
}
func operationSummary(o Operation) OperationSummary {
	return OperationSummary{OperationHandle{o.Sequence, o.OperationID, o.Fingerprint}, o.BundleID, o.Phase, o.RequestFingerprint != nil}
}
func equalValue(a, b any) bool {
	aa, e := core.Canonical(a)
	if e != nil {
		return false
	}
	bb, e := core.Canonical(b)
	return e == nil && string(aa) == string(bb)
}
func (c *Catalog) run(fn func(*PrivateRecords, *catalogIndex) error) error {
	return c.database.Update(func(tx *groupstore.Tx) error {
		return RunPrivate(tx, c.identity, func(values *PrivateRecords) error {
			stored, found, e := values.Read(c.indexKey)
			if e != nil {
				return e
			}
			if !found {
				keys, e := tx.Keys("site:")
				if e != nil {
					return e
				}
				if len(keys) != 0 {
					return privateIntegrity("catálogo ausente com registos existentes")
				}
				return fn(values, &catalogIndex{"relayloom/site-catalog/1", []catalogEntry{}})
			}
			m, e := object(stored, "domain", "sites")
			if e != nil || m["domain"] != "relayloom/site-catalog/1" {
				return privateIntegrity("catálogo inválido")
			}
			list, ok := m["sites"].([]any)
			if !ok || len(list) > CatalogLimit {
				return privateIntegrity("limite do catálogo")
			}
			index := catalogIndex{"relayloom/site-catalog/1", make([]catalogEntry, len(list))}
			previous := ""
			for i, v := range list {
				entry, e := object(v, "ownerId", "name")
				if e != nil {
					return privateIntegrity("entrada de catálogo inválida")
				}
				owner, name := docTextValue(entry["ownerId"]), docTextValue(entry["name"])
				address, e := Address(owner, name)
				if e != nil || previous >= address {
					return privateIntegrity("contexto de catálogo inválido")
				}
				index.Sites[i] = catalogEntry{owner, name}
				previous = address
			}
			return fn(values, &index)
		})
	})
}
func (c *Catalog) key(owner, name string) string { key, _ := RecordKey(owner, name); return key }
func (c *Catalog) record(values *PrivateRecords, index *catalogIndex, owner, name string) (Record, error) {
	if _, e := Address(owner, name); e != nil {
		return Record{}, e
	}
	key := c.key(owner, name)
	known := false
	for _, entry := range index.Sites {
		if entry.OwnerID == owner && entry.Name == name {
			known = true
		}
	}
	value, found, e := values.Read(key + ":record")
	if e != nil {
		return Record{}, e
	}
	if !known {
		_, staged, e := values.Read(key + ":stage")
		if e != nil {
			return Record{}, e
		}
		if found || staged {
			return Record{}, privateIntegrity("registo fora do catálogo")
		}
		return InitialRecord(owner, name)
	}
	if !found {
		return Record{}, privateIntegrity("registo em falta")
	}
	data, e := core.Canonical(value)
	if e != nil {
		return Record{}, privateIntegrity("registo ilegível")
	}
	r, e := DecodeRecord(data, owner, name)
	if e != nil {
		return Record{}, privateIntegrity("registo de site inválido")
	}
	stage, e := c.stage(values, r)
	if e != nil {
		return Record{}, e
	}
	if stage != nil && stage.Manifest.Expires <= c.now() {
		var pending Operation
		for _, o := range r.Operations {
			if pendingPhase(o.Phase) {
				pending = o
				break
			}
		}
		next, e := Finish(r, pending.Sequence, pending.OperationID, pending.Fingerprint, "expire")
		if e != nil {
			return Record{}, e
		}
		r = next.Record
		if e = values.Remove(key + ":stage"); e != nil {
			return Record{}, e
		}
		if e = c.save(values, index, r); e != nil {
			return Record{}, e
		}
	}
	return r, nil
}
func (c *Catalog) save(values *PrivateRecords, index *catalogIndex, r Record) error {
	known := false
	for _, e := range index.Sites {
		if e.OwnerID == r.OwnerID && e.Name == r.Name {
			known = true
		}
	}
	if !known {
		if len(index.Sites) >= CatalogLimit {
			return groupstore.ErrCapacity
		}
		index.Sites = append(index.Sites, catalogEntry{r.OwnerID, r.Name})
		sort.Slice(index.Sites, func(i, j int) bool {
			a, _ := Address(index.Sites[i].OwnerID, index.Sites[i].Name)
			b, _ := Address(index.Sites[j].OwnerID, index.Sites[j].Name)
			return a < b
		})
		if e := values.Write(c.indexKey, index); e != nil {
			return e
		}
	}
	return values.Write(c.key(r.OwnerID, r.Name)+":record", r)
}
func (c *Catalog) verified(bundle core.Bundle, name string, stored bool) (VerifiedContent, error) {
	at := c.now()
	if stored {
		at = bundle.Manifest.Created
	}
	if e := core.VerifyBundleAt(bundle, at); e != nil {
		return VerifiedContent{}, e
	}
	if bundle.Manifest.Kind != "site" {
		return VerifiedContent{}, errors.New("envelope de site inválido")
	}
	value, e := core.DecryptBundleAt(bundle, &c.identity, at)
	if e != nil {
		return VerifiedContent{}, e
	}
	return VerifyContent(value, bundle.Manifest.Author, name)
}
func readersOf(bundle core.Bundle) any {
	if bundle.Manifest.PublicKey != nil {
		return "public"
	}
	ids := []string{}
	for _, key := range bundle.Manifest.Keys {
		ids = append(ids, key.Reader)
	}
	sort.Strings(ids)
	return ids
}
func (c *Catalog) fingerprint(bundle core.Bundle, base, name string, stored bool) (string, error) {
	verified, e := c.verified(bundle, name, stored)
	if e != nil {
		return "", e
	}
	return fingerprintVerified(bundle, base, name, verified.Revision)
}
func fingerprintVerified(bundle core.Bundle, base, name string, revision Revision) (string, error) {
	readers := readersOf(bundle)
	if bundle.Manifest.PublicKey == nil {
		readers = map[string]any{"ids": readers, "envelope": bundle.Manifest.ID}
	}
	value := map[string]any{"domain": "relayloom/site-publication-command/1", "ownerId": bundle.Manifest.Author.ID, "name": name, "number": revision.Body.Number, "expectedBase": base, "documentHash": revision.Body.DocumentHash, "readers": readers}
	data, e := core.Canonical(value)
	if e != nil {
		return "", e
	}
	return core.Hash(data), nil
}
func (c *Catalog) stage(values *PrivateRecords, r Record) (*core.Bundle, error) {
	var pending *Operation
	for _, o := range r.Operations {
		if pendingPhase(o.Phase) {
			v := o
			pending = &v
			break
		}
	}
	stored, found, e := values.Read(c.key(r.OwnerID, r.Name) + ":stage")
	if e != nil {
		return nil, e
	}
	if pending == nil {
		if found {
			return nil, privateIntegrity("preparação sem operação")
		}
		return nil, nil
	}
	m, e := shapeOptional(stored, []string{"domain", "bundle"}, "request")
	if e != nil || !found || r.OwnerID != c.identity.Public.ID || m["domain"] != "relayloom/site-stage/1" {
		return nil, privateIntegrity("preparação inválida ou ausente")
	}
	data, e := core.Canonical(m["bundle"])
	if e != nil {
		return nil, privateIntegrity("preparação ilegível")
	}
	bundle, e := core.DecodeBundle(data)
	if e != nil {
		return nil, privateIntegrity("bundle preparado inválido")
	}
	verified, e := c.verified(bundle, r.Name, true)
	if e != nil {
		return nil, privateIntegrity("preparação corrompida")
	}
	fp, e := fingerprintVerified(bundle, pending.ExpectedBase, r.Name, verified.Revision)
	if e != nil || fp != pending.Fingerprint || bundle.Manifest.ID != pending.BundleID || !equalValue(verified.Revision, pending.Revision) {
		return nil, privateIntegrity("preparação não corresponde à operação")
	}
	context, hasRequest := m["request"]
	if pending.RequestFingerprint != nil {
		request, e := shapeOptional(context, []string{"sequence", "operationId", "expectedBase", "readers", "ttlMs"}, "confirmedHeads")
		if e != nil {
			return nil, privateIntegrity("pedido guardado inválido")
		}
		payload := map[string]any{}
		for k, v := range verified.Content {
			if k != "siteRevision" {
				payload[k] = v
			}
		}
		input := map[string]any{}
		for k, v := range request {
			input[k] = v
		}
		input["payload"] = payload
		normalized, e := NormalizeRequest(bundle.Manifest.Author, r.Name, input)
		if e != nil {
			return nil, privateIntegrity("pedido guardado corrompido")
		}
		access := any("public")
		if cards, ok := normalized.Context.Readers.([]core.PublicIdentity); ok {
			ids := []string{}
			for _, card := range cards {
				ids = append(ids, card.ID)
			}
			sort.Strings(ids)
			access = ids
		}
		if normalized.Fingerprint != *pending.RequestFingerprint || !equalValue(normalized.Context.Value(), context) || normalized.Context.Sequence != pending.Sequence || normalized.Context.OperationID != pending.OperationID || normalized.Context.ExpectedBase != pending.ExpectedBase || bundle.Manifest.Expires-bundle.Manifest.Created < normalized.Context.TTLMS || bundle.Manifest.Expires-bundle.Manifest.Created > normalized.Context.TTLMS+10 || !equalValue(access, readersOf(bundle)) {
			return nil, privateIntegrity("pedido não corresponde à preparação")
		}
	} else if hasRequest {
		return nil, privateIntegrity("pedido sem operação correspondente")
	}
	return &bundle, nil
}
func (c *Catalog) State(owner, name string) (CatalogState, error) {
	var result CatalogState
	e := c.run(func(v *PrivateRecords, index *catalogIndex) error {
		r, e := c.record(v, index, owner, name)
		if e != nil {
			return e
		}
		state, e := State(r)
		if e != nil {
			return e
		}
		base, e := BaseHash(r)
		if e != nil {
			return e
		}
		result = CatalogState{RecordState: state, Base: base, BundleHints: []BundleHint{}, Pending: []OperationSummary{}}
		heads := map[string]bool{}
		for _, h := range state.Heads {
			heads[h.ID] = true
		}
		for _, h := range r.Headers {
			if heads[h.Revision.ID] {
				result.BundleHints = append(result.BundleHints, BundleHint{h.Revision.ID, append([]string{}, h.Bundles...)})
			}
		}
		for _, o := range r.Operations {
			if pendingPhase(o.Phase) {
				result.Pending = append(result.Pending, operationSummary(o))
			}
		}
		return nil
	})
	return result, e
}
func (c *Catalog) History(owner, name string) ([]StoredRevision, error) {
	var result []StoredRevision
	e := c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, owner, name)
		if e == nil {
			result = cloneRecord(r).Headers
		}
		return e
	})
	return result, e
}
func (c *Catalog) Operation(name string, seq int64, id string) (*OperationSummary, error) {
	var result *OperationSummary
	e := c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, c.identity.Public.ID, name)
		if e != nil {
			return e
		}
		fp := strings.Repeat("0", 64)
		for _, o := range r.Operations {
			if o.Sequence == seq {
				fp = o.Fingerprint
				break
			}
		}
		o, e := Lookup(r, seq, id, fp)
		if e != nil {
			return e
		}
		if o != nil {
			s := operationSummary(*o)
			result = &s
		}
		return nil
	})
	return result, e
}
func (c *Catalog) CreatePublication(name string, input any, validateResources ...func(NormalizedRequest) error) (OperationSummary, error) {
	var result OperationSummary
	q, e := NormalizeRequest(c.identity.Public, name, input)
	if e != nil {
		return result, e
	}
	e = c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, c.identity.Public.ID, name)
		if e != nil {
			return e
		}
		fp := strings.Repeat("0", 64)
		for _, o := range r.Operations {
			if o.Sequence == q.Context.Sequence {
				fp = o.Fingerprint
				break
			}
		}
		prior, e := Lookup(r, q.Context.Sequence, q.Context.OperationID, fp)
		if e != nil {
			return e
		}
		if prior != nil {
			if prior.RequestFingerprint == nil || *prior.RequestFingerprint != q.Fingerprint {
				return errors.New("operação usada para outro pedido")
			}
			result = operationSummary(*prior)
			return nil
		}
		state, e := State(r)
		if e != nil {
			return e
		}
		base, e := BaseHash(r)
		if e != nil {
			return e
		}
		heads := []string{}
		for _, h := range state.Heads {
			heads = append(heads, h.ID)
		}
		sort.Strings(heads)
		if state.Status == "conflict" || q.Context.ConfirmedHeads != nil {
			if q.Context.ConfirmedHeads == nil || !sameStrings(q.Context.ConfirmedHeads, heads) {
				return errors.New("confirma explicitamente as versões concorrentes")
			}
		}
		if state.NextSequence == nil || q.Context.Sequence != *state.NextSequence || q.Context.ExpectedBase != base {
			return errors.New("o site mudou desde que começaste a editar")
		}
		for _, o := range r.Operations {
			if pendingPhase(o.Phase) {
				return errors.New("conclui ou cancela a publicação pendente")
			}
		}
		if len(heads) > Predecessors {
			heads = heads[:Predecessors]
		}
		refs, e := ResourceBlocks(q.Payload["site"].(map[string]any))
		if e != nil {
			return e
		}
		if len(refs) > 0 {
			if len(validateResources) != 1 || validateResources[0] == nil {
				return errors.New("as referências de recursos precisam de verificação antes de publicar")
			}
			if e = validateResources[0](q); e != nil {
				return e
			}
		}
		content, e := CreateContent(c.identity, name, q.Context.Sequence, heads, q.Payload)
		if e != nil {
			return e
		}
		readers, public := q.Context.Readers.([]core.PublicIdentity)
		public = !public
		bundle, e := core.CreateBundleAt(c.identity, "site", content, readers, public, q.Context.TTLMS, c.now())
		if e != nil {
			return e
		}
		fingerprint, e := c.fingerprint(bundle, q.Context.ExpectedBase, name, false)
		if e != nil {
			return e
		}
		revision := content["siteRevision"].(Revision)
		begun, e := Begin(r, Reservation{Sequence: q.Context.Sequence, OperationID: q.Context.OperationID, Fingerprint: fingerprint, ExpectedBase: q.Context.ExpectedBase, Revision: revision, BundleID: bundle.Manifest.ID, RequestFingerprint: &q.Fingerprint})
		if e != nil {
			return e
		}
		if e = v.Write(c.key(r.OwnerID, name)+":stage", map[string]any{"domain": "relayloom/site-stage/1", "bundle": bundle, "request": q.Context.Value()}); e != nil {
			return e
		}
		if e = c.save(v, i, begun.Record); e != nil {
			return e
		}
		result = operationSummary(begun.Operation)
		return nil
	})
	return result, e
}
func (c *Catalog) Prepare(name, base, id string, bundle core.Bundle) (OperationSummary, error) {
	var result OperationSummary
	parsed, e := c.verified(bundle, name, true)
	if e != nil {
		return result, e
	}
	if bundle.Manifest.Author.ID != c.identity.Public.ID {
		return result, errors.New("só o proprietário pode preparar")
	}
	fingerprint, e := c.fingerprint(bundle, base, name, true)
	if e != nil {
		return result, e
	}
	e = c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, c.identity.Public.ID, name)
		if e != nil {
			return e
		}
		prior, e := Lookup(r, parsed.Revision.Body.Number, id, fingerprint)
		if e != nil {
			return e
		}
		if prior != nil {
			result = operationSummary(*prior)
			return nil
		}
		if e = core.VerifyBundleAt(bundle, c.now()); e != nil {
			return e
		}
		b, e := Begin(r, Reservation{Sequence: parsed.Revision.Body.Number, OperationID: id, Fingerprint: fingerprint, ExpectedBase: base, Revision: parsed.Revision, BundleID: bundle.Manifest.ID})
		if e != nil {
			return e
		}
		if e = v.Write(c.key(r.OwnerID, name)+":stage", map[string]any{"domain": "relayloom/site-stage/1", "bundle": bundle}); e != nil {
			return e
		}
		if e = c.save(v, i, b.Record); e != nil {
			return e
		}
		result = operationSummary(b.Operation)
		return nil
	})
	return result, e
}
func (c *Catalog) transition(name string, h OperationHandle, action string) (OperationSummary, error) {
	var result OperationSummary
	e := c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, c.identity.Public.ID, name)
		if e != nil {
			return e
		}
		next, e := Finish(r, h.Sequence, h.OperationID, h.Fingerprint, action)
		if e != nil {
			return e
		}
		if !equalValue(r, next.Record) {
			if !pendingPhase(next.Operation.Phase) {
				if e = v.Remove(c.key(r.OwnerID, name) + ":stage"); e != nil {
					return e
				}
			}
			if e = c.save(v, i, next.Record); e != nil {
				return e
			}
		}
		result = operationSummary(next.Operation)
		return nil
	})
	return result, e
}
func (c *Catalog) Commit(name string, h OperationHandle) (OperationSummary, error) {
	return c.transition(name, h, "commit")
}
func (c *Catalog) Cancel(name string, h OperationHandle) (OperationSummary, error) {
	return c.transition(name, h, "cancel")
}
func (c *Catalog) MarkReady(name string, h OperationHandle) (OperationSummary, error) {
	return c.transition(name, h, "markReady")
}
func (c *Catalog) AuthorizedBundle(name string, h OperationHandle) (core.Bundle, error) {
	var result core.Bundle
	e := c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, c.identity.Public.ID, name)
		if e != nil {
			return e
		}
		o, e := Lookup(r, h.Sequence, h.OperationID, h.Fingerprint)
		if e != nil {
			return e
		}
		if o == nil || o.Phase != "committed" {
			return errors.New("publicação sem autorização durável")
		}
		bundle, e := c.stage(v, r)
		if e != nil {
			return e
		}
		result = *bundle
		return nil
	})
	if e != nil {
		return core.Bundle{}, e
	}
	return result, core.VerifyBundleAt(result, c.now())
}
func (c *Catalog) PreparationAccess(name string, h OperationHandle) (*PreparationAccess, error) {
	var result *PreparationAccess
	e := c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, c.identity.Public.ID, name)
		if e != nil {
			return e
		}
		o, e := Lookup(r, h.Sequence, h.OperationID, h.Fingerprint)
		if e != nil {
			return e
		}
		if o == nil || !pendingPhase(o.Phase) {
			return nil
		}
		b, e := c.stage(v, r)
		if e != nil {
			return e
		}
		result = &PreparationAccess{readersOf(*b)}
		return nil
	})
	return result, e
}
func (c *Catalog) Observe(bundle core.Bundle, name string) (map[string]any, error) {
	verified, e := c.verified(bundle, name, false)
	if e != nil {
		return nil, e
	}
	var result map[string]any
	e = c.run(func(v *PrivateRecords, i *catalogIndex) error {
		r, e := c.record(v, i, verified.Revision.Body.Owner.ID, name)
		if e != nil {
			return e
		}
		next, e := Observe(r, verified.Revision, bundle.Manifest.ID)
		if e != nil {
			return e
		}
		if !equalValue(r, next) {
			if e = c.save(v, i, next); e != nil {
				return e
			}
		}
		address, _ := Address(r.OwnerID, name)
		result = map[string]any{"address": address, "revisionId": verified.Revision.ID}
		return nil
	})
	return result, e
}
func (c *Catalog) Pending() ([]PendingPublication, error) {
	result := []PendingPublication{}
	e := c.run(func(v *PrivateRecords, i *catalogIndex) error {
		for _, entry := range i.Sites {
			if entry.OwnerID != c.identity.Public.ID {
				continue
			}
			r, e := c.record(v, i, entry.OwnerID, entry.Name)
			if e != nil {
				return e
			}
			for _, o := range r.Operations {
				if pendingPhase(o.Phase) {
					result = append(result, PendingPublication{entry.Name, operationSummary(o)})
				}
			}
		}
		return nil
	})
	return result, e
}
