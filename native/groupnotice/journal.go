package groupnotice

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

const retiredKey = "group-notice:retired"

type Direction string

const Incoming Direction = "in"
const Outgoing Direction = "out"

func prefix(d Direction) string       { return "group-notice:" + string(d) + ":" }
func validDirection(d Direction) bool { return d == Incoming || d == Outgoing }

type Entry struct {
	Version   int            `json:"version"`
	Direction Direction      `json:"direction"`
	Sequence  int64          `json:"sequence"`
	Notice    map[string]any `json:"notice"`
}
type retiredItem struct {
	ID        string    `json:"id"`
	Direction Direction `json:"direction"`
	Sequence  int64     `json:"sequence"`
}
type retired struct {
	Version int           `json:"version"`
	Items   []retiredItem `json:"items"`
}
type Journal struct {
	tx    *groupstore.Tx
	owner core.PublicIdentity
}

func New(tx *groupstore.Tx, owner core.PublicIdentity) (*Journal, error) {
	j := &Journal{tx, owner}
	if err := core.ValidateIdentity(owner); err != nil {
		return nil, bad(err.Error())
	}
	if err := j.guard(); err != nil {
		return nil, err
	}
	return j, nil
}
func (j *Journal) guard() error {
	id, err := j.tx.Owner()
	if err != nil {
		return err
	}
	if id != j.owner.ID {
		return bad("avisos de outro perfil")
	}
	return nil
}

// Count reads authenticated index metadata; List verifies every actual notice.
func (j *Journal) Count(direction Direction) (int, error) {
	if err := j.guard(); err != nil {
		return 0, err
	}
	if !validDirection(direction) {
		return 0, bad("direcção inválida")
	}
	keys, err := j.tx.Keys(prefix(direction))
	if err != nil {
		return 0, err
	}
	limit := InboxLimit
	if direction == Outgoing {
		limit = OutboxLimit
	}
	if len(keys) > limit {
		return 0, j.integrity(bad("demasiados avisos persistidos"))
	}
	return len(keys), nil
}
func (j *Journal) integrity(err error) error {
	return j.tx.Abort(fmt.Errorf("%w: aviso: %v", groupstore.ErrIntegrity, err))
}
func decode(data []byte, limit int) (map[string]any, error) {
	value, err := core.DecodeJSON(data, limit)
	if err != nil {
		return nil, err
	}
	encoded, err := core.Canonical(value)
	if err != nil || !bytes.Equal(encoded, data) {
		return nil, bad("aviso persistido não canónico")
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, bad("aviso persistido inválido")
	}
	return m, nil
}
func integer(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	return i, err == nil && i > 0 && i <= 9007199254740991
}
func (j *Journal) retired() (retired, error) {
	result := retired{1, []retiredItem{}}
	if err := j.guard(); err != nil {
		return result, err
	}
	data, exists, err := j.tx.Get(retiredKey)
	if err != nil || !exists {
		return result, err
	}
	m, err := decode(data, 48*1024)
	if err != nil {
		return result, j.integrity(err)
	}
	items, ok := m["items"].([]any)
	if !exact(m, "version", "items") || !equal(m["version"], 1) || !ok || len(items) > RetiredLimit {
		return result, j.integrity(bad("histórico de avisos inválido"))
	}
	revision, exists, err := j.tx.RecordRevision(retiredKey)
	if err != nil {
		return result, err
	}
	if !exists {
		return result, j.integrity(bad("histórico sem revisão"))
	}
	seen := map[string]bool{}
	for _, v := range items {
		i, ok := v.(map[string]any)
		if !ok || !exact(i, "id", "direction", "sequence") {
			return result, j.integrity(bad("entrada retirada inválida"))
		}
		sequence, valid := integer(i["sequence"])
		d, id := Direction(str(i["direction"])), str(i["id"])
		key := string(d) + ":" + id
		if !core.ValidAddress(id) || !validDirection(d) || !valid || sequence > revision || seen[key] {
			return result, j.integrity(bad("histórico duplicado ou inválido"))
		}
		seen[key] = true
		result.Items = append(result.Items, retiredItem{id, d, sequence})
	}
	return result, nil
}
func (j *Journal) List(direction Direction) ([]Entry, error) {
	result := []Entry{}
	if err := j.guard(); err != nil {
		return result, err
	}
	if !validDirection(direction) {
		return result, bad("direcção inválida")
	}
	keys, err := j.tx.Keys(prefix(direction))
	if err != nil {
		return result, err
	}
	limit := InboxLimit
	if direction == Outgoing {
		limit = OutboxLimit
	}
	if len(keys) > limit {
		return result, j.integrity(bad("demasiados avisos persistidos"))
	}
	history, err := j.retired()
	if err != nil {
		return result, err
	}
	gone := map[string]bool{}
	for _, i := range history.Items {
		if i.Direction == direction {
			gone[i.ID] = true
		}
	}
	issuers := map[string]int{}
	for _, key := range keys {
		data, exists, err := j.tx.Get(key)
		if err != nil {
			return result, err
		}
		if !exists {
			return result, j.integrity(bad("aviso ausente"))
		}
		m, err := decode(data, PlainLimit+256)
		if err != nil {
			return result, j.integrity(err)
		}
		if !exact(m, "version", "direction", "sequence", "notice") {
			return result, j.integrity(bad("campos persistidos inválidos"))
		}
		n, err := Parse(m["notice"])
		if err != nil {
			return result, j.integrity(err)
		}
		issuer, recipient := n.Parties()
		owner := issuer.ID
		if direction == Incoming {
			owner = recipient.ID
		}
		sequence, valid := integer(m["sequence"])
		revision, _, err := j.tx.RecordRevision(key)
		if err != nil {
			return result, err
		}
		issuers[issuer.ID]++
		if !equal(m["version"], 1) || str(m["direction"]) != string(direction) || key != prefix(direction)+n.ID || owner != j.owner.ID || !valid || sequence != revision || gone[n.ID] || (direction == Incoming && issuers[issuer.ID] > IssuerLimit) {
			return result, j.integrity(bad("aviso persistido de outro contexto"))
		}
		result = append(result, Entry{1, direction, sequence, n.Raw})
	}
	sort.Slice(result, func(a, b int) bool {
		if result[a].Sequence != result[b].Sequence {
			return result[a].Sequence < result[b].Sequence
		}
		x, _ := result[a].Notice["certificate"].(map[string]any)
		y, _ := result[b].Notice["certificate"].(map[string]any)
		return str(x["id"]) < str(y["id"])
	})
	return result, nil
}
func (j *Journal) Save(direction Direction, value Notice) (string, error) {
	if err := j.guard(); err != nil {
		return "", err
	}
	if !validDirection(direction) {
		return "", bad("direcção inválida")
	}
	n, err := Parse(value.Raw)
	if err != nil {
		return "", err
	}
	issuer, recipient := n.Parties()
	owner := issuer.ID
	if direction == Incoming {
		owner = recipient.ID
	}
	if owner != j.owner.ID {
		return "", bad("aviso destinado a outro perfil")
	}
	history, err := j.retired()
	if err != nil {
		return "", err
	}
	for _, i := range history.Items {
		if i.Direction == direction && i.ID == n.ID {
			return "retired", nil
		}
	}
	entries, err := j.List(direction)
	if err != nil {
		return "", err
	}
	sameIssuer := 0
	for _, entry := range entries {
		old, err := Parse(entry.Notice)
		if err != nil {
			return "", j.integrity(err)
		}
		if old.ID == n.ID {
			if !equal(old.Raw, n.Raw) {
				return "", bad("mesmo certificado com material diferente")
			}
			return "duplicate", nil
		}
		previous, _ := old.Parties()
		if previous.ID == issuer.ID {
			sameIssuer++
		}
	}
	limit := InboxLimit
	if direction == Outgoing {
		limit = OutboxLimit
	}
	if len(entries) >= limit {
		return "", bad("caixa de avisos cheia")
	}
	if direction == Incoming && sameIssuer >= IssuerLimit {
		return "", bad("limite de avisos por emissor")
	}
	accounting, err := j.tx.Accounting()
	if err != nil {
		return "", err
	}
	data, err := core.Canonical(Entry{1, direction, accounting.Revision + 1, n.Raw})
	if err != nil {
		return "", err
	}
	if err = j.tx.Put(prefix(direction)+n.ID, data, groupstore.Data); err != nil {
		return "", err
	}
	return "stored", nil
}
func (j *Journal) Retire(direction Direction, id string) (bool, error) {
	if err := j.guard(); err != nil {
		return false, err
	}
	if !core.ValidAddress(id) {
		return false, bad("identificador inválido")
	}
	entries, err := j.List(direction)
	if err != nil {
		return false, err
	}
	found := false
	for _, e := range entries {
		n, err := Parse(e.Notice)
		if err != nil {
			return false, j.integrity(err)
		}
		found = found || n.ID == id
	}
	if !found {
		return false, nil
	}
	history, err := j.retired()
	if err != nil {
		return false, err
	}
	accounting, err := j.tx.Accounting()
	if err != nil {
		return false, err
	}
	next := []retiredItem{}
	for _, i := range history.Items {
		if i.ID != id || i.Direction != direction {
			next = append(next, i)
		}
	}
	next = append(next, retiredItem{id, direction, accounting.Revision + 1})
	if len(next) > RetiredLimit {
		next = next[len(next)-RetiredLimit:]
	}
	history.Items = next
	data, err := core.Canonical(history)
	if err != nil {
		return false, err
	}
	if err = j.tx.Delete(prefix(direction) + id); err != nil {
		return false, j.tx.Abort(err)
	}
	if err = j.tx.Put(retiredKey, data, groupstore.Data); err != nil {
		return false, j.tx.Abort(err)
	}
	return true, nil
}
