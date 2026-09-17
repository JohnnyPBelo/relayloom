package sites

import (
	"encoding/json"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"math"
	"regexp"
	"sort"
)

const RegistryHeaders = 128
const BundlesPerRevision = 4
const RegistryOperations = 32
const RecordBytes = 480 * 1024
const recordDomain = "relayloom/site-record/1"

var operationPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type StoredRevision struct {
	Revision Revision `json:"revision"`
	Bundles  []string `json:"bundles"`
}
type Operation struct {
	Sequence           int64    `json:"sequence"`
	OperationID        string   `json:"operationId"`
	Fingerprint        string   `json:"fingerprint"`
	ExpectedBase       string   `json:"expectedBase"`
	Revision           Revision `json:"revision"`
	BundleID           string   `json:"bundleId"`
	RequestFingerprint *string  `json:"requestFingerprint,omitempty"`
	Phase              string   `json:"phase"`
}
type Record struct {
	Domain     string           `json:"domain"`
	OwnerID    string           `json:"ownerId"`
	Name       string           `json:"name"`
	Counter    int64            `json:"counter"`
	Headers    []StoredRevision `json:"headers"`
	Operations []Operation      `json:"operations"`
}
type Reservation struct {
	Sequence           int64    `json:"sequence"`
	OperationID        string   `json:"operationId"`
	Fingerprint        string   `json:"fingerprint"`
	ExpectedBase       string   `json:"expectedBase"`
	Revision           Revision `json:"revision"`
	BundleID           string   `json:"bundleId"`
	RequestFingerprint *string  `json:"requestFingerprint,omitempty"`
}
type RecordState struct {
	Selection
	NextSequence *int64 `json:"nextSequence"`
	Address      string `json:"address"`
}
type Transition struct {
	Record    Record    `json:"record"`
	Operation Operation `json:"operation"`
}
type ReservationResult struct {
	Transition
	Created bool `json:"created"`
}

func RecordKey(ownerID, name string) (string, error) {
	a, err := Address(ownerID, name)
	if err != nil {
		return "", err
	}
	return "site:" + core.Hash([]byte(a)), nil
}
func InitialRecord(ownerID, name string) (Record, error) {
	if _, err := Address(ownerID, name); err != nil {
		return Record{}, err
	}
	return Record{Domain: recordDomain, OwnerID: ownerID, Name: name, Headers: []StoredRevision{}, Operations: []Operation{}}, nil
}
func cloneRevision(r Revision) Revision {
	r.Body.Previous = append([]string{}, r.Body.Previous...)
	return r
}
func cloneOperation(o Operation) Operation {
	o.Revision = cloneRevision(o.Revision)
	if o.RequestFingerprint != nil {
		v := *o.RequestFingerprint
		o.RequestFingerprint = &v
	}
	return o
}
func cloneRecord(r Record) Record {
	headers := make([]StoredRevision, len(r.Headers))
	for i, h := range r.Headers {
		headers[i] = StoredRevision{cloneRevision(h.Revision), append([]string{}, h.Bundles...)}
	}
	r.Headers = headers
	ops := make([]Operation, len(r.Operations))
	for i, o := range r.Operations {
		ops[i] = cloneOperation(o)
	}
	r.Operations = ops
	return r
}
func validIDs(ids []string, maximum int) bool {
	if ids == nil || len(ids) > maximum {
		return false
	}
	for i, id := range ids {
		if !core.ValidAddress(id) || (i > 0 && ids[i-1] >= id) {
			return false
		}
	}
	return true
}
func validPhase(p string) bool {
	switch p {
	case "prepared", "committed", "ready", "cancelled", "superseded", "expired":
		return true
	}
	return false
}
func pendingPhase(p string) bool { return p == "prepared" || p == "committed" }
func ValidateRecord(r Record, ownerID, name string) error {
	if _, err := Address(ownerID, name); err != nil {
		return err
	}
	if r.Domain != recordDomain || r.OwnerID != ownerID || r.Name != name || r.Counter < 0 || r.Counter > MaxSequence || r.Headers == nil || len(r.Headers) > RegistryHeaders || r.Operations == nil || len(r.Operations) > RegistryOperations {
		return errors.New("contexto do registo de site inválido")
	}
	headers := map[string]bool{}
	revisions := make([]Revision, 0, len(r.Headers))
	for _, h := range r.Headers {
		if err := VerifyRevision(h.Revision); err != nil {
			return err
		}
		b := h.Revision.Body
		if b.Owner.ID != ownerID || b.Name != name || b.Number > r.Counter || headers[h.Revision.ID] || !validIDs(h.Bundles, BundlesPerRevision) {
			return errors.New("cabeçalho de site inválido")
		}
		headers[h.Revision.ID] = true
		revisions = append(revisions, h.Revision)
	}
	seqs := map[int64]bool{}
	ids := map[string]bool{}
	pending := 0
	for _, o := range r.Operations {
		if err := VerifyRevision(o.Revision); err != nil {
			return err
		}
		b := o.Revision.Body
		if !operationPattern.MatchString(o.OperationID) || ids[o.OperationID] || !core.ValidAddress(o.Fingerprint) || !core.ValidAddress(o.ExpectedBase) || !core.ValidAddress(o.BundleID) || o.RequestFingerprint != nil && !core.ValidAddress(*o.RequestFingerprint) || !validPhase(o.Phase) || o.Sequence != b.Number || o.Sequence > r.Counter || seqs[o.Sequence] || b.Owner.ID != ownerID || b.Name != name {
			return errors.New("operação de site inválida")
		}
		ids[o.OperationID] = true
		seqs[o.Sequence] = true
		if pendingPhase(o.Phase) {
			pending++
		}
	}
	if pending > 1 {
		return errors.New("mais de uma publicação pendente")
	}
	if _, err := ClassifyRevisions(ownerID, name, revisions); err != nil {
		return err
	}
	data, err := core.Canonical(r)
	if err != nil {
		return err
	}
	if len(data) > RecordBytes {
		return errors.New("registo de site excede o limite")
	}
	return nil
}
func State(r Record) (RecordState, error) {
	if err := ValidateRecord(r, r.OwnerID, r.Name); err != nil {
		return RecordState{}, err
	}
	revisions := make([]Revision, len(r.Headers))
	for i, h := range r.Headers {
		revisions[i] = cloneRevision(h.Revision)
	}
	selected, err := ClassifyRevisions(r.OwnerID, r.Name, revisions)
	if err != nil {
		return RecordState{}, err
	}
	address, _ := Address(r.OwnerID, r.Name)
	result := RecordState{Selection: selected, Address: address}
	if r.Counter < MaxSequence {
		n := r.Counter + 1
		result.NextSequence = &n
	}
	return result, nil
}
func BaseHash(r Record) (string, error) {
	state, err := State(r)
	if err != nil {
		return "", err
	}
	ids := []string{}
	for _, h := range state.Heads {
		ids = append(ids, h.ID)
	}
	data, err := core.Canonical(map[string]any{"domain": "relayloom/site-base/1", "ownerId": r.OwnerID, "name": r.Name, "heads": ids})
	if err != nil {
		return "", err
	}
	return core.Hash(data), nil
}
func appendHeader(r *Record, revision Revision, bundleID string) error {
	found := -1
	for i, h := range r.Headers {
		if h.Revision.ID == revision.ID {
			found = i
			break
		}
	}
	if found >= 0 && bundleID != "" {
		set := map[string]bool{bundleID: true}
		for _, id := range r.Headers[found].Bundles {
			set[id] = true
		}
		ids := []string{}
		for id := range set {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		if len(ids) > BundlesPerRevision {
			ids = ids[len(ids)-BundlesPerRevision:]
		}
		r.Headers[found].Bundles = ids
	} else if found < 0 {
		ids := []string{}
		if bundleID != "" {
			ids = append(ids, bundleID)
		}
		r.Headers = append(r.Headers, StoredRevision{cloneRevision(revision), ids})
	}
	if revision.Body.Number > r.Counter {
		r.Counter = revision.Body.Number
	}
	sort.Slice(r.Headers, func(i, j int) bool {
		a, b := r.Headers[i].Revision, r.Headers[j].Revision
		if a.Body.Number != b.Body.Number {
			return a.Body.Number > b.Body.Number
		}
		return a.ID < b.ID
	})
	highest := r.Headers[0].Revision.Body.Number
	n := 0
	for _, h := range r.Headers {
		if h.Revision.Body.Number == highest {
			n++
		}
	}
	if n > RegistryHeaders {
		return errors.New("demasiadas revisões concorrentes")
	}
	if len(r.Headers) > RegistryHeaders {
		r.Headers = r.Headers[:RegistryHeaders]
	}
	return nil
}
func Observe(r Record, revision Revision, bundleID string) (Record, error) {
	if err := ValidateRecord(r, r.OwnerID, r.Name); err != nil {
		return Record{}, err
	}
	if err := VerifyRevision(revision); err != nil {
		return Record{}, err
	}
	if !core.ValidAddress(bundleID) || revision.Body.Owner.ID != r.OwnerID || revision.Body.Name != r.Name {
		return Record{}, errors.New("revisão de outro site")
	}
	next := cloneRecord(r)
	if err := appendHeader(&next, revision, bundleID); err != nil {
		return Record{}, err
	}
	return next, ValidateRecord(next, r.OwnerID, r.Name)
}
func Lookup(r Record, sequence int64, id, fingerprint string) (*Operation, error) {
	if err := ValidateRecord(r, r.OwnerID, r.Name); err != nil {
		return nil, err
	}
	if sequence < 1 || sequence > MaxSequence || !operationPattern.MatchString(id) || !core.ValidAddress(fingerprint) {
		return nil, errors.New("pedido de publicação inválido")
	}
	for _, o := range r.Operations {
		if o.Sequence == sequence {
			if o.OperationID != id || o.Fingerprint != fingerprint {
				return nil, errors.New("a operação já foi usada para outra publicação")
			}
			copy := cloneOperation(o)
			return &copy, nil
		}
	}
	for _, o := range r.Operations {
		if o.OperationID == id {
			return nil, errors.New("a operação já foi usada noutra sequência")
		}
	}
	if sequence <= r.Counter {
		return nil, errors.New("operação de publicação antiga ou desconhecida")
	}
	return nil, nil
}
func Begin(r Record, q Reservation) (ReservationResult, error) {
	var empty ReservationResult
	if q.RequestFingerprint != nil && !core.ValidAddress(*q.RequestFingerprint) {
		return empty, errors.New("pedido de publicação inválido")
	}
	prior, err := Lookup(r, q.Sequence, q.OperationID, q.Fingerprint)
	if err != nil {
		return empty, err
	}
	if prior != nil {
		return ReservationResult{Transition{cloneRecord(r), *prior}, false}, nil
	}
	state, err := State(r)
	if err != nil {
		return empty, err
	}
	base, err := BaseHash(r)
	if err != nil {
		return empty, err
	}
	if state.NextSequence == nil || q.Sequence != *state.NextSequence || q.ExpectedBase != base {
		return empty, errors.New("o site mudou desde que começaste a editar")
	}
	for _, o := range r.Operations {
		if pendingPhase(o.Phase) {
			return empty, errors.New("conclui ou cancela a publicação pendente")
		}
	}
	if err = VerifyRevision(q.Revision); err != nil {
		return empty, err
	}
	parents := []string{}
	for _, h := range state.Heads {
		parents = append(parents, h.ID)
	}
	sort.Strings(parents)
	if len(parents) > Predecessors {
		parents = parents[:Predecessors]
	}
	if !core.ValidAddress(q.BundleID) || q.Revision.Body.Owner.ID != r.OwnerID || q.Revision.Body.Name != r.Name || q.Revision.Body.Number != q.Sequence || !sameStrings(q.Revision.Body.Previous, parents) {
		return empty, errors.New("certificado não corresponde à reserva")
	}
	op := cloneOperation(Operation{Sequence: q.Sequence, OperationID: q.OperationID, Fingerprint: q.Fingerprint, ExpectedBase: q.ExpectedBase, Revision: q.Revision, BundleID: q.BundleID, RequestFingerprint: q.RequestFingerprint, Phase: "prepared"})
	next := cloneRecord(r)
	next.Counter = q.Sequence
	sort.Slice(next.Operations, func(i, j int) bool { return next.Operations[i].Sequence < next.Operations[j].Sequence })
	if len(next.Operations) >= RegistryOperations {
		next.Operations = next.Operations[len(next.Operations)-(RegistryOperations-1):]
	}
	next.Operations = append(next.Operations, op)
	if err = ValidateRecord(next, r.OwnerID, r.Name); err != nil {
		return empty, err
	}
	return ReservationResult{Transition{next, cloneOperation(op)}, true}, nil
}
func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func Finish(r Record, sequence int64, id, fingerprint, action string) (Transition, error) {
	var empty Transition
	prior, err := Lookup(r, sequence, id, fingerprint)
	if err != nil {
		return empty, err
	}
	if prior == nil {
		return empty, errors.New("publicação não reservada")
	}
	next := cloneRecord(r)
	index := -1
	for i, o := range next.Operations {
		if o.Sequence == sequence {
			index = i
			break
		}
	}
	op := &next.Operations[index]
	switch action {
	case "commit":
		if op.Phase == "prepared" {
			base, e := BaseHash(r)
			if e != nil {
				return empty, e
			}
			if base != op.ExpectedBase {
				op.Phase = "superseded"
			} else {
				op.Phase = "committed"
				if err = appendHeader(&next, op.Revision, ""); err != nil {
					return empty, err
				}
			}
		}
	case "cancel":
		if op.Phase == "prepared" {
			op.Phase = "cancelled"
		}
	case "expire":
		if pendingPhase(op.Phase) {
			op.Phase = "expired"
		}
	case "markReady":
		if op.Phase != "committed" && op.Phase != "ready" {
			return empty, errors.New("publicação sem autorização durável")
		}
		op.Phase = "ready"
		if err = appendHeader(&next, op.Revision, op.BundleID); err != nil {
			return empty, err
		}
	default:
		return empty, errors.New("transição de site inválida")
	}
	if err = ValidateRecord(next, r.OwnerID, r.Name); err != nil {
		return empty, err
	}
	return Transition{next, cloneOperation(*op)}, nil
}

func recordNumber(v any) (int64, error) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, errors.New("número de registo inválido")
	}
	f, err := n.Float64()
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > float64(MaxSequence) || f != math.Trunc(f) {
		return 0, errors.New("limite numérico do registo")
	}
	return int64(f), nil
}
func recordStrings(v any, max int) ([]string, error) {
	list, ok := v.([]any)
	if !ok || len(list) > max {
		return nil, errors.New("lista de registo inválida")
	}
	out := make([]string, len(list))
	for i, v := range list {
		out[i], ok = v.(string)
		if !ok {
			return nil, errors.New("texto de registo inválido")
		}
	}
	return out, nil
}
func recordRevision(v any) (Revision, error) {
	data, err := core.Canonical(v)
	if err != nil {
		return Revision{}, err
	}
	return DecodeRevision(data)
}
func decodeOperation(v any) (Operation, error) {
	keys := []string{"sequence", "operationId", "fingerprint", "expectedBase", "revision", "bundleId", "phase"}
	m, err := object(v, keys...)
	if err != nil {
		m, err = object(v, append(keys, "requestFingerprint")...)
	}
	if err != nil {
		return Operation{}, err
	}
	o := Operation{}
	o.Sequence, err = recordNumber(m["sequence"])
	if err != nil {
		return o, err
	}
	for key, target := range map[string]*string{"operationId": &o.OperationID, "fingerprint": &o.Fingerprint, "expectedBase": &o.ExpectedBase, "bundleId": &o.BundleID, "phase": &o.Phase} {
		value, ok := m[key].(string)
		if !ok {
			return o, errors.New("texto de operação inválido")
		}
		*target = value
	}
	if value, ok := m["requestFingerprint"]; ok {
		s, valid := value.(string)
		if !valid {
			return o, errors.New("pedido guardado inválido")
		}
		o.RequestFingerprint = &s
	}
	o.Revision, err = recordRevision(m["revision"])
	return o, err
}

// DecodeRecord preserves the shared canonical parser's UTF-16 behavior and
// rejects unknown fields before conversion. It never resets malformed state.
func DecodeRecord(data []byte, ownerID, name string) (Record, error) {
	var r Record
	v, err := core.DecodeJSON(data, RecordBytes)
	if err != nil {
		return r, err
	}
	m, err := object(v, "domain", "ownerId", "name", "counter", "headers", "operations")
	if err != nil {
		return r, err
	}
	for key, target := range map[string]*string{"domain": &r.Domain, "ownerId": &r.OwnerID, "name": &r.Name} {
		value, ok := m[key].(string)
		if !ok {
			return r, errors.New("texto de registo inválido")
		}
		*target = value
	}
	r.Counter, err = recordNumber(m["counter"])
	if err != nil {
		return r, err
	}
	hs, ok := m["headers"].([]any)
	if !ok || len(hs) > RegistryHeaders {
		return r, errors.New("cabeçalhos inválidos")
	}
	r.Headers = make([]StoredRevision, len(hs))
	for i, h := range hs {
		entry, e := object(h, "revision", "bundles")
		if e != nil {
			return r, e
		}
		r.Headers[i].Revision, e = recordRevision(entry["revision"])
		if e != nil {
			return r, e
		}
		r.Headers[i].Bundles, e = recordStrings(entry["bundles"], BundlesPerRevision)
		if e != nil {
			return r, e
		}
	}
	os, ok := m["operations"].([]any)
	if !ok || len(os) > RegistryOperations {
		return r, errors.New("operações inválidas")
	}
	r.Operations = make([]Operation, len(os))
	for i, v := range os {
		r.Operations[i], err = decodeOperation(v)
		if err != nil {
			return r, err
		}
	}
	return r, ValidateRecord(r, ownerID, name)
}

func DecodeReservation(data []byte) (Reservation, error) {
	v, err := core.DecodeJSON(data, 16384)
	if err != nil {
		return Reservation{}, err
	}
	keys := []string{"sequence", "operationId", "fingerprint", "expectedBase", "revision", "bundleId"}
	m, err := object(v, keys...)
	if err != nil {
		m, err = object(v, append(keys, "requestFingerprint")...)
	}
	if err != nil {
		return Reservation{}, err
	}
	m["phase"] = "prepared"
	o, err := decodeOperation(m)
	if err != nil {
		return Reservation{}, err
	}
	return Reservation{o.Sequence, o.OperationID, o.Fingerprint, o.ExpectedBase, o.Revision, o.BundleID, o.RequestFingerprint}, nil
}
