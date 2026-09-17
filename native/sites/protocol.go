// Package sites verifies owner-signed complete snapshots. Persisted adoption,
// stale-draft CAS, transport and rendering are separate application boundaries.
package sites

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const CertificateBytes = 4096
const PayloadBytes = 3500000
const Predecessors = 16
const Headers = 1024
const MaxSequence int64 = 9007199254740991
const domain = "relayloom/site-snapshot/1"

var namePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

type Body struct {
	Domain       string              `json:"domain"`
	Owner        core.PublicIdentity `json:"owner"`
	Name         string              `json:"name"`
	Number       int64               `json:"number"`
	Previous     []string            `json:"previous"`
	DocumentHash string              `json:"documentHash"`
}
type Revision struct {
	Body      Body   `json:"body"`
	ID        string `json:"id"`
	Signature string `json:"signature"`
}
type Selection struct {
	Status         string     `json:"status"`
	Number         int64      `json:"number"`
	Heads          []Revision `json:"heads"`
	MissingHistory []string   `json:"missingHistory"`
}

func Address(ownerID, name string) (string, error) {
	if !core.ValidAddress(ownerID) || !namePattern.MatchString(name) {
		return "", errors.New("endereço de site inválido")
	}
	return "relayloom:site:" + ownerID + "/" + name, nil
}
func ParseAddress(value string) (string, string, error) {
	if len(value) > 120 || !strings.HasPrefix(value, "relayloom:site:") {
		return "", "", errors.New("endereço de site inválido")
	}
	parts := strings.Split(strings.TrimPrefix(value, "relayloom:site:"), "/")
	if len(parts) != 2 {
		return "", "", errors.New("endereço de site inválido")
	}
	if _, err := Address(parts[0], parts[1]); err != nil {
		return "", "", err
	}
	return parts[0], parts[1], nil
}
func bounded(value any, maximum int) ([]byte, error) {
	data, err := core.Canonical(value)
	if err != nil {
		return nil, err
	}
	if len(data) > maximum {
		return nil, errors.New("revisão de site demasiado grande")
	}
	return data, nil
}
func validBody(body Body) error {
	if body.Domain != domain || !namePattern.MatchString(body.Name) || body.Number < 1 || body.Number > MaxSequence || !core.ValidAddress(body.DocumentHash) || body.Previous == nil || len(body.Previous) > Predecessors {
		return errors.New("revisão de site inválida")
	}
	if err := core.ValidateIdentity(body.Owner); err != nil {
		return err
	}
	for i, id := range body.Previous {
		if !core.ValidAddress(id) || (i > 0 && body.Previous[i-1] >= id) {
			return errors.New("antecessores de site não canónicos")
		}
	}
	if body.Number == 1 && len(body.Previous) != 0 {
		return errors.New("a primeira revisão não tem antecessores")
	}
	_, err := bounded(body, CertificateBytes)
	return err
}
func VerifyRevision(revision Revision) error {
	if err := validBody(revision.Body); err != nil {
		return err
	}
	data, err := bounded(revision.Body, CertificateBytes)
	if err != nil {
		return err
	}
	if !core.ValidAddress(revision.ID) || revision.ID != core.Hash(data) || len(revision.Signature) != 88 {
		return errors.New("certificado de site inválido")
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(revision.Signature)
	if err != nil || len(signature) != 64 || base64.StdEncoding.EncodeToString(signature) != revision.Signature {
		return errors.New("assinatura de revisão não canónica")
	}
	if err = core.VerifyCertificateData(revision.Body.Owner, data, signature); err != nil {
		return err
	}
	for _, id := range revision.Body.Previous {
		if id == revision.ID {
			return errors.New("revisão de site circular")
		}
	}
	_, err = bounded(revision, CertificateBytes)
	return err
}
func CreateRevision(identity core.Identity, name string, number int64, previous []string, hash string) (Revision, error) {
	var empty Revision
	if len(previous) > Predecessors {
		return empty, errors.New("antecessores fora dos limites")
	}
	body := Body{domain, identity.Public, name, number, append([]string{}, previous...), hash}
	if err := validBody(body); err != nil {
		return empty, err
	}
	data, err := bounded(body, CertificateBytes)
	if err != nil {
		return empty, err
	}
	signature, err := core.SignCertificateData(identity, data)
	if err != nil {
		return empty, err
	}
	result := Revision{Body: body, ID: core.Hash(data), Signature: base64.StdEncoding.EncodeToString(signature)}
	if err = VerifyRevision(result); err != nil {
		return empty, err
	}
	return result, nil
}
func CreateSuccessor(identity core.Identity, name string, parents []Revision, hash string) (Revision, error) {
	if len(parents) > Predecessors {
		return Revision{}, errors.New("antecessores fora dos limites")
	}
	var highest int64
	ids := map[string]bool{}
	for _, parent := range parents {
		if err := VerifyRevision(parent); err != nil {
			return Revision{}, err
		}
		if parent.Body.Owner.ID != identity.Public.ID || parent.Body.Name != name {
			return Revision{}, errors.New("antecessor de outro proprietário ou site")
		}
		if parent.Body.Number > highest {
			highest = parent.Body.Number
		}
		ids[parent.ID] = true
	}
	if highest >= MaxSequence {
		return Revision{}, errors.New("número de revisão esgotado")
	}
	previous := make([]string, 0, len(ids))
	for id := range ids {
		previous = append(previous, id)
	}
	sort.Strings(previous)
	return CreateRevision(identity, name, highest+1, previous, hash)
}
func DocumentHash(payload any) (string, error) {
	data, err := bounded(map[string]any{"domain": "relayloom/site-document/1", "payload": payload}, PayloadBytes)
	if err != nil {
		return "", err
	}
	return core.Hash(data), nil
}
func VerifySnapshot(revision Revision, payload any, ownerID, name string) error {
	if _, err := Address(ownerID, name); err != nil {
		return err
	}
	if err := VerifyRevision(revision); err != nil {
		return err
	}
	if revision.Body.Owner.ID != ownerID || revision.Body.Name != name {
		return errors.New("a revisão pertence a outro site")
	}
	hash, err := DocumentHash(payload)
	if err != nil {
		return err
	}
	if hash != revision.Body.DocumentHash {
		return errors.New("o documento não corresponde à revisão assinada")
	}
	return nil
}
func historyLink(child, parent Revision) error {
	if child.Body.Owner.ID != parent.Body.Owner.ID || child.Body.Name != parent.Body.Name || parent.Body.Number >= child.Body.Number {
		return errors.New("ligação de histórico inválida")
	}
	for _, id := range child.Body.Previous {
		if id == parent.ID {
			return nil
		}
	}
	return errors.New("antecessor não referenciado")
}
func VerifyHistoryLink(child, parent Revision) error {
	if err := VerifyRevision(child); err != nil {
		return err
	}
	if err := VerifyRevision(parent); err != nil {
		return err
	}
	return historyLink(child, parent)
}
func ClassifyRevisions(ownerID, name string, values []Revision) (Selection, error) {
	result := Selection{Status: "empty", Heads: []Revision{}, MissingHistory: []string{}}
	if _, err := Address(ownerID, name); err != nil {
		return result, err
	}
	if len(values) > Headers {
		return result, errors.New("histórico de site demasiado grande")
	}
	byID := map[string]Revision{}
	for _, value := range values {
		if err := VerifyRevision(value); err != nil {
			return result, err
		}
		if value.Body.Owner.ID != ownerID || value.Body.Name != name {
			return result, errors.New("histórico de outro site")
		}
		byID[value.ID] = value
		if value.Body.Number > result.Number {
			result.Number = value.Body.Number
		}
	}
	for _, value := range byID {
		for _, id := range value.Body.Previous {
			if parent, ok := byID[id]; ok {
				if err := historyLink(value, parent); err != nil {
					return result, err
				}
			}
		}
	}
	if len(byID) == 0 {
		return result, nil
	}
	for _, value := range byID {
		if value.Body.Number == result.Number {
			result.Heads = append(result.Heads, value)
		}
	}
	sort.Slice(result.Heads, func(i, j int) bool { return result.Heads[i].ID < result.Heads[j].ID })
	result.Status = "head"
	if len(result.Heads) > 1 {
		result.Status = "conflict"
	}
	queue := append([]Revision{}, result.Heads...)
	seen, missing := map[string]bool{}, map[string]bool{}
	for len(queue) > 0 {
		value := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		if seen[value.ID] {
			continue
		}
		seen[value.ID] = true
		for _, id := range value.Body.Previous {
			if parent, ok := byID[id]; ok {
				queue = append(queue, parent)
			} else {
				missing[id] = true
			}
		}
	}
	for id := range missing {
		result.MissingHistory = append(result.MissingHistory, id)
	}
	sort.Strings(result.MissingHistory)
	return result, nil
}

func object(value any, keys ...string) (map[string]any, error) {
	m, ok := value.(map[string]any)
	if !ok || len(m) != len(keys) {
		return nil, errors.New("campos da revisão inválidos")
	}
	for _, key := range keys {
		if _, ok = m[key]; !ok {
			return nil, errors.New("campo da revisão ausente")
		}
	}
	return m, nil
}

// DecodeRevision rejects extra/missing/wrongly typed fields before converting to
// a typed struct; ordinary json.Unmarshal would silently discard unknown fields.
func DecodeRevision(data []byte) (Revision, error) {
	var empty Revision
	value, err := core.DecodeJSON(data, CertificateBytes)
	if err != nil {
		return empty, err
	}
	outer, err := object(value, "body", "id", "signature")
	if err != nil {
		return empty, err
	}
	b, err := object(outer["body"], "domain", "owner", "name", "number", "previous", "documentHash")
	if err != nil {
		return empty, err
	}
	texts := make([]string, 5)
	for i, value := range []any{outer["id"], outer["signature"], b["domain"], b["name"], b["documentHash"]} {
		var ok bool
		texts[i], ok = value.(string)
		if !ok {
			return empty, errors.New("texto de revisão inválido")
		}
	}
	number, ok := b["number"].(json.Number)
	if !ok {
		return empty, errors.New("número de revisão inválido")
	}
	n, err := number.Float64()
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || n < 1 || n > float64(MaxSequence) {
		return empty, errors.New("número de revisão inválido")
	}
	previous, ok := b["previous"].([]any)
	if !ok || len(previous) > Predecessors {
		return empty, errors.New("antecessores inválidos")
	}
	ids := make([]string, len(previous))
	for i, value := range previous {
		ids[i], ok = value.(string)
		if !ok {
			return empty, errors.New("antecessor inválido")
		}
	}
	card, err := bounded(b["owner"], CertificateBytes)
	if err != nil {
		return empty, err
	}
	owner, err := core.DecodePublicIdentity(card)
	if err != nil {
		return empty, err
	}
	revision := Revision{Body: Body{texts[2], owner, texts[3], int64(n), ids, texts[4]}, ID: texts[0], Signature: texts[1]}
	if err = VerifyRevision(revision); err != nil {
		return empty, err
	}
	return revision, nil
}
