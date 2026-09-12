// Package groupledger persists local group admission, holds and immutable retry
// stops in the same protected transaction as membership authority.
package groupledger

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"unicode/utf8"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

const (
	AcceptedLimit       = 4096
	HeldLimit           = 128
	HeldByteLimit       = 16 * 1024 * 1024
	StopLimit           = 256
	StopByteLimit       = 128 * 1024
	LossByteLimit       = 512
	maxSafe       int64 = 9007199254740991
	historyPrefix       = "group-history:"
	heldPrefix          = "group-held:"
	stopKey             = "group-access:stops"
	clockKey            = "group-access:clock"
	lossKey             = "group-access:losses"
)

var operationPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var terminalReasons = map[string]bool{"group-left": true, "group-closed": true, "group-forked": true, "group-epoch-changed": true, "group-card-changed": true, "group-invalid-original-author": true}

type HistoryRecord struct {
	Version  int                         `json:"version"`
	Context  groupaccess.AcceptedContext `json:"context"`
	Observed int64                       `json:"observed"`
	Expires  int64                       `json:"expires"`
}
type HeldRecord struct {
	Version  int    `json:"version"`
	ID       string `json:"id"`
	GroupID  string `json:"groupId"`
	EpochID  string `json:"epochId"`
	Status   string `json:"status"`
	Reason   string `json:"reason"`
	Observed int64  `json:"observed"`
	Expires  int64  `json:"expires"`
	Bytes    int64  `json:"bytes"`
}
type StopRecord struct {
	Version     int    `json:"version"`
	OperationID string `json:"operationId"`
	ID          string `json:"id"`
	GroupID     string `json:"groupId"`
	EpochID     string `json:"epochId"`
	Reason      string `json:"reason"`
	Observed    int64  `json:"observed"`
}
type Losses struct {
	HistoryRetired int64 `json:"historyRetired"`
	HistoryRefused int64 `json:"historyRefused"`
	HoldRefused    int64 `json:"holdRefused"`
	HoldExpired    int64 `json:"holdExpired"`
	StopRetired    int64 `json:"stopRetired"`
}
type clockRecord struct {
	Version  int   `json:"version"`
	Sequence int64 `json:"sequence"`
}
type lossRecord struct {
	Version int `json:"version"`
	Losses
}
type stopRecordSet struct {
	Version int          `json:"version"`
	Entries []StopRecord `json:"entries"`
}
type RetryEntry struct {
	OperationID string `json:"operationId"`
	ID          string `json:"id"`
	GroupID     string `json:"groupId"`
	EpochID     string `json:"epochId"`
}
type RetryResult struct {
	Allowed bool        `json:"allowed"`
	Reason  string      `json:"reason"`
	Stop    *StopRecord `json:"stop"`
}
type ConsiderResult struct {
	Decision groupaccess.Decision `json:"decision"`
	Held     bool                 `json:"held"`
}
type Limits struct {
	Accepted  int `json:"accepted"`
	Held      int `json:"held"`
	HeldBytes int `json:"heldBytes"`
	Stops     int `json:"stops"`
	StopBytes int `json:"stopBytes"`
	LossBytes int `json:"lossBytes"`
}
type Accounting struct {
	Accepted  int                   `json:"accepted"`
	Held      int                   `json:"held"`
	HeldBytes int64                 `json:"heldBytes"`
	Stops     int                   `json:"stops"`
	Losses    Losses                `json:"losses"`
	Limits    Limits                `json:"limits"`
	Storage   groupstore.Accounting `json:"storage"`
}
type Ledger struct {
	tx       *groupstore.Tx
	registry *groupauthority.Registry
	access   *groupaccess.Access
}

func integrity(message string) error { return fmt.Errorf("%w: %s", groupstore.ErrIntegrity, message) }
func positive(n int64) bool          { return n > 0 && n <= maxSafe }
func utf16Length(value string) int {
	count := 0
	for at := 0; at < len(value); {
		r, size := utf8.DecodeRuneInString(value[at:])
		if r == utf8.RuneError && size == 1 && at+2 < len(value) && value[at] == 0xed && value[at+1] >= 0xa0 && value[at+1] <= 0xbf && value[at+2]&0xc0 == 0x80 {
			size = 3
		}
		count++
		if r > 0xffff {
			count++
		}
		at += size
	}
	return count
}
func one(value string, choices ...string) bool {
	for _, choice := range choices {
		if value == choice {
			return true
		}
	}
	return false
}
func contextValid(c groupaccess.AcceptedContext) bool {
	if !core.ValidAddress(c.ID) || !core.ValidAddress(c.GroupID) || !core.ValidAddress(c.EpochID) || !core.ValidAddress(c.Author) || !one(c.Kind, "message", "edit", "comment", "reaction", "receipt", "delivery", "delete") || len(c.Readers) < 1 || len(c.Readers) > 64 {
		return false
	}
	author := false
	previous := ""
	for _, id := range c.Readers {
		if !core.ValidAddress(id) || id <= previous {
			return false
		}
		previous = id
		if id == c.Author {
			author = true
		}
	}
	return author
}

// Run never accepts an externally supplied historical context. Candidates must
// already be verified/decrypted and semantically checked by the application.
func Run(tx *groupstore.Tx, identity core.Identity, callback func(*Ledger, *groupauthority.Registry) error) ([]groupauthority.ProofRejection, error) {
	return groupauthority.InTransaction(tx, identity, func(g *groupauthority.Registry) error {
		a, err := groupaccess.New(g, identity.Public)
		if err != nil {
			return err
		}
		l := &Ledger{tx, g, a}
		if err := l.initialize(); err != nil {
			return err
		}
		return callback(l, g)
	})
}
func (l *Ledger) read(key string, limit int, destination any) (bool, error) {
	if _, err := l.registry.ScopeGeneration(); err != nil {
		return false, err
	}
	raw, exists, err := l.tx.Get(key)
	if err != nil || !exists {
		return exists, err
	}
	if len(raw) > limit {
		return false, integrity("registo de acesso excessivo")
	}
	parsed, err := core.DecodeJSON(raw, limit)
	if err != nil {
		return false, integrity("registo de acesso ilegível")
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		return false, integrity("registo de acesso inválido")
	}
	// Preserve escaped lone UTF-16 surrogates in the only unrestricted text
	// field; the bounded core parser retains their canonical WTF-8 value.
	if held, ok := destination.(*HeldRecord); ok {
		if object, ok := parsed.(map[string]any); ok {
			if reason, ok := object["reason"].(string); ok {
				held.Reason = reason
			}
		}
	}
	encoded, err := core.Canonical(destination)
	if err != nil || !bytes.Equal(raw, encoded) {
		return false, integrity("registo de acesso não canónico ou campos inválidos")
	}
	return true, nil
}
func (l *Ledger) put(key string, value any, class groupstore.StorageClass) error {
	data, err := core.Canonical(value)
	if err != nil {
		return err
	}
	return l.tx.Put(key, data, class)
}
func (l *Ledger) initialize() error {
	history, err := l.tx.Keys(historyPrefix)
	if err != nil {
		return err
	}
	held, err := l.tx.Keys(heldPrefix)
	if err != nil {
		return err
	}
	stops, err := l.stops()
	if err != nil {
		return err
	}
	if len(history) > AcceptedLimit || len(held) > HeldLimit || len(stops) > StopLimit {
		return integrity("limites persistidos de acesso inválidos")
	}
	clock, exists, err := l.clock()
	if err != nil {
		return err
	}
	_ = clock
	if !exists && (len(history) > 0 || len(held) > 0 || len(stops) > 0) {
		return integrity("registos de acesso sem sequência")
	}
	_, err = l.Losses()
	return err
}
func (l *Ledger) clock() (clockRecord, bool, error) {
	var c clockRecord
	exists, err := l.read(clockKey, 256, &c)
	if err != nil {
		return c, false, err
	}
	if exists && (c.Version != 1 || c.Sequence < 0 || c.Sequence > maxSafe) {
		return c, false, integrity("sequência de acesso inválida")
	}
	return c, exists, nil
}
func (l *Ledger) next() (int64, error) {
	c, exists, err := l.clock()
	if err != nil {
		return 0, err
	}
	if !exists {
		for _, prefix := range []string{historyPrefix, heldPrefix, stopKey} {
			keys, err := l.tx.Keys(prefix)
			if err != nil {
				return 0, err
			}
			if len(keys) > 0 {
				return 0, integrity("registos de acesso sem sequência")
			}
		}
	}
	if c.Sequence == maxSafe {
		return 0, integrity("sequência de acesso esgotada")
	}
	c = clockRecord{1, c.Sequence + 1}
	return c.Sequence, l.put(clockKey, c, groupstore.Checkpoint)
}
func (l *Ledger) Losses() (Losses, error) {
	var record lossRecord
	exists, err := l.read(lossKey, LossByteLimit, &record)
	if err != nil || !exists {
		return Losses{}, err
	}
	if record.Version != 1 {
		return Losses{}, integrity("contadores de acesso inválidos")
	}
	for _, v := range []int64{record.HistoryRetired, record.HistoryRefused, record.HoldRefused, record.HoldExpired, record.StopRetired} {
		if v < 0 || v > maxSafe {
			return Losses{}, integrity("contadores de acesso inválidos")
		}
	}
	return record.Losses, nil
}
func (l *Ledger) loss(kind string, count int64) error {
	value, err := l.Losses()
	if err != nil {
		return err
	}
	var field *int64
	switch kind {
	case "historyRetired":
		field = &value.HistoryRetired
	case "historyRefused":
		field = &value.HistoryRefused
	case "holdRefused":
		field = &value.HoldRefused
	case "holdExpired":
		field = &value.HoldExpired
	case "stopRetired":
		field = &value.StopRetired
	default:
		return errors.New("invalid internal counter")
	}
	if count > maxSafe-*field {
		*field = maxSafe
	} else {
		*field += count
	}
	return l.put(lossKey, lossRecord{1, value}, groupstore.Checkpoint)
}
func (l *Ledger) Accepted(id string) (*HistoryRecord, error) {
	if !core.ValidAddress(id) {
		return nil, integrity("identificador de admissão inválido")
	}
	var value HistoryRecord
	exists, err := l.read(historyPrefix+id, 8192, &value)
	if err != nil || !exists {
		return nil, err
	}
	if value.Version != 1 || value.Context.ID != id || !contextValid(value.Context) || !positive(value.Observed) || !positive(value.Expires) {
		return nil, integrity("admissão persistida inválida")
	}
	return &value, nil
}
func (l *Ledger) Held() ([]HeldRecord, error) {
	if _, err := l.registry.ScopeGeneration(); err != nil {
		return nil, err
	}
	keys, err := l.tx.Keys(heldPrefix)
	if err != nil {
		return nil, err
	}
	if len(keys) > HeldLimit {
		return nil, integrity("limite de quarentena inválido")
	}
	values := []HeldRecord{}
	var total int64
	for _, key := range keys {
		var value HeldRecord
		exists, err := l.read(key, 2048, &value)
		if err != nil {
			return nil, err
		}
		if !exists || value.Version != 1 || key != heldPrefix+value.ID || !core.ValidAddress(value.ID) || !core.ValidAddress(value.GroupID) || !core.ValidAddress(value.EpochID) || !one(value.Status, "quarantine", "awaiting-proof") || utf16Length(value.Reason) > 100 || !positive(value.Observed) || !positive(value.Expires) || value.Bytes < 1 || value.Bytes > 6*1024*1024 {
			return nil, integrity("quarentena persistida inválida")
		}
		total += value.Bytes
		values = append(values, value)
	}
	if total > HeldByteLimit {
		return nil, integrity("orçamento de quarentena inválido")
	}
	return values, nil
}
func (l *Ledger) retainHeld(candidate groupaccess.Candidate, decision groupaccess.Decision, expires, size, now int64) (bool, error) {
	if decision.Status == "invalid" {
		return false, nil
	}
	values, err := l.Held()
	if err != nil {
		return false, err
	}
	groupID, _ := candidate.Content["conversation"].(string)
	epochID, _ := candidate.Content["groupEpoch"].(string)
	if epochID == "" {
		epochID, _ = candidate.Content["targetEpoch"].(string)
	}
	for _, value := range values {
		if value.ID == candidate.ID {
			if value.GroupID != groupID || value.EpochID != epochID || value.Bytes != size || value.Expires != expires {
				return false, integrity("quarentena não corresponde ao conteúdo imutável")
			}
			return true, nil
		}
	}
	live, expired := 0, int64(0)
	var total int64
	for _, value := range values {
		if value.Expires <= now {
			if err := l.tx.Delete(heldPrefix + value.ID); err != nil {
				return false, err
			}
			expired++
		} else {
			live++
			total += value.Bytes
		}
	}
	if expired > 0 {
		if err := l.loss("holdExpired", expired); err != nil {
			return false, err
		}
	}
	if live >= HeldLimit || total+size > HeldByteLimit {
		return false, l.loss("holdRefused", 1)
	}
	if !core.ValidAddress(groupID) || !core.ValidAddress(epochID) {
		return false, nil
	}
	observed, err := l.next()
	if err != nil {
		return false, err
	}
	value := HeldRecord{1, candidate.ID, groupID, epochID, decision.Status, decision.Reason, observed, expires, size}
	err = l.put(heldPrefix+candidate.ID, value, groupstore.Data)
	if errors.Is(err, groupstore.ErrCapacity) {
		return false, l.loss("holdRefused", 1)
	}
	return err == nil, err
}
func (l *Ledger) Consider(candidate groupaccess.Candidate, expires, size int64, protected map[string]bool, now int64) (ConsiderResult, error) {
	if !positive(expires) || expires <= now || size < 1 || size > 6*1024*1024 {
		return ConsiderResult{}, errors.New("conteúdo de acesso fora dos limites")
	}
	previous, err := l.Accepted(candidate.ID)
	if err != nil {
		return ConsiderResult{}, err
	}
	targetID, _ := candidate.Content["target"].(string)
	if candidate.Kind == "message" {
		targetID, _ = candidate.Content["replyTo"].(string)
	}
	var target *HistoryRecord
	if core.ValidAddress(targetID) {
		target, err = l.Accepted(targetID)
		if err != nil {
			return ConsiderResult{}, err
		}
	}
	var priorContext, targetContext *groupaccess.AcceptedContext
	if previous != nil {
		priorContext = &previous.Context
	}
	if target != nil {
		targetContext = &target.Context
	}
	decision, err := l.access.Decide(candidate, priorContext, targetContext)
	if err != nil {
		return ConsiderResult{}, err
	}
	if decision.Status == "accepted" {
		if previous == nil {
			keys, err := l.tx.Keys(historyPrefix)
			if err != nil {
				return ConsiderResult{}, err
			}
			if len(keys) > AcceptedLimit {
				return ConsiderResult{}, integrity("limite de histórico inválido")
			}
			retire := ""
			if len(keys) == AcceptedLimit {
				removable := []HistoryRecord{}
				for _, key := range keys {
					value, err := l.Accepted(key[len(historyPrefix):])
					if err != nil {
						return ConsiderResult{}, err
					}
					if !protected[value.Context.ID] && value.Context.ID != targetID {
						removable = append(removable, *value)
					}
				}
				sort.Slice(removable, func(i, j int) bool {
					if removable[i].Observed != removable[j].Observed {
						return removable[i].Observed < removable[j].Observed
					}
					return removable[i].Context.ID < removable[j].Context.ID
				})
				if len(removable) == 0 {
					decision = groupaccess.Decision{Status: "quarantine", Reason: "accepted-history-capacity"}
				} else {
					retire = removable[0].Context.ID
				}
			}
			if decision.Status == "accepted" {
				observed, err := l.next()
				if err != nil {
					return ConsiderResult{}, err
				}
				err = l.put(historyPrefix+candidate.ID, HistoryRecord{1, *decision.Context, observed, expires}, groupstore.Data)
				if errors.Is(err, groupstore.ErrCapacity) {
					decision = groupaccess.Decision{Status: "quarantine", Reason: "accepted-history-capacity"}
				} else if err != nil {
					return ConsiderResult{}, err
				}
				if decision.Status == "accepted" && retire != "" {
					if err := l.tx.Delete(historyPrefix + retire); err != nil {
						return ConsiderResult{}, err
					}
					if err := l.loss("historyRetired", 1); err != nil {
						return ConsiderResult{}, err
					}
				}
			}
		}
		if decision.Status == "accepted" {
			return ConsiderResult{Decision: decision}, l.tx.Delete(heldPrefix + candidate.ID)
		}
		if err := l.loss("historyRefused", 1); err != nil {
			return ConsiderResult{}, err
		}
	}
	held, err := l.retainHeld(candidate, decision, expires, size, now)
	return ConsiderResult{decision, held}, err
}
func (l *Ledger) stops() ([]StopRecord, error) {
	var value stopRecordSet
	exists, err := l.read(stopKey, StopByteLimit, &value)
	if err != nil {
		return nil, err
	}
	if !exists {
		return []StopRecord{}, nil
	}
	if value.Version != 1 || value.Entries == nil || len(value.Entries) > StopLimit {
		return nil, integrity("limite de paragens inválido")
	}
	ids := map[string]bool{}
	for _, entry := range value.Entries {
		if entry.Version != 1 || !operationPattern.MatchString(entry.OperationID) || ids[entry.OperationID] || !core.ValidAddress(entry.ID) || !core.ValidAddress(entry.GroupID) || !core.ValidAddress(entry.EpochID) || !terminalReasons[entry.Reason] || !positive(entry.Observed) {
			return nil, integrity("paragem de envio inválida")
		}
		ids[entry.OperationID] = true
	}
	return value.Entries, nil
}
func (l *Ledger) writeStops(entries []StopRecord) error {
	data, err := core.Canonical(stopRecordSet{1, entries})
	if err != nil {
		return err
	}
	if len(data) > StopByteLimit {
		return fmt.Errorf("%w: bytes das paragens", groupstore.ErrCapacity)
	}
	if len(entries) == 0 {
		return l.tx.Delete(stopKey)
	}
	return l.tx.Put(stopKey, data, groupstore.Checkpoint)
}
func (l *Ledger) Stop(operation string) (*StopRecord, error) {
	if !operationPattern.MatchString(operation) {
		return nil, integrity("identificador de envio inválido")
	}
	values, err := l.stops()
	if err != nil {
		return nil, err
	}
	for _, value := range values {
		if value.OperationID == operation {
			return &value, nil
		}
	}
	return nil, nil
}
func (l *Ledger) ReconcileRetry(entry RetryEntry, unfinished bool) (RetryResult, error) {
	previous, err := l.Stop(entry.OperationID)
	if err != nil {
		return RetryResult{}, err
	}
	if previous != nil {
		if previous.ID != entry.ID || previous.GroupID != entry.GroupID || previous.EpochID != entry.EpochID {
			return RetryResult{}, integrity("paragem não corresponde ao envio imutável")
		}
		return RetryResult{false, previous.Reason, previous}, nil
	}
	if !unfinished {
		return RetryResult{Reason: "completed"}, nil
	}
	decision, err := l.access.Retry(entry.GroupID, entry.EpochID)
	if err != nil {
		return RetryResult{}, err
	}
	if !decision.Terminal {
		return RetryResult{Allowed: decision.Allowed, Reason: decision.Reason}, nil
	}
	values, err := l.stops()
	if err != nil {
		return RetryResult{}, err
	}
	if len(values) >= StopLimit {
		return RetryResult{}, fmt.Errorf("%w: paragens de envio", groupstore.ErrCapacity)
	}
	if !core.ValidAddress(entry.ID) || !core.ValidAddress(entry.GroupID) || !core.ValidAddress(entry.EpochID) {
		return RetryResult{}, integrity("contexto de envio inválido")
	}
	observed, err := l.next()
	if err != nil {
		return RetryResult{}, err
	}
	stop := StopRecord{1, entry.OperationID, entry.ID, entry.GroupID, entry.EpochID, decision.Reason, observed}
	if err := l.writeStops(append(values, stop)); err != nil {
		return RetryResult{}, err
	}
	return RetryResult{false, stop.Reason, &stop}, nil
}
func (l *Ledger) RetireStops(retained map[string]bool) error {
	if _, err := l.registry.ScopeGeneration(); err != nil {
		return err
	}
	before, err := l.stops()
	if err != nil {
		return err
	}
	after := []StopRecord{}
	for _, stop := range before {
		if retained[stop.OperationID] {
			after = append(after, stop)
		}
	}
	if len(after) == len(before) {
		return nil
	}
	if err := l.writeStops(after); err != nil {
		return err
	}
	return l.loss("stopRetired", int64(len(before)-len(after)))
}
func (l *Ledger) Accounting() (Accounting, error) {
	held, err := l.Held()
	if err != nil {
		return Accounting{}, err
	}
	keys, err := l.tx.Keys(historyPrefix)
	if err != nil {
		return Accounting{}, err
	}
	stops, err := l.stops()
	if err != nil {
		return Accounting{}, err
	}
	losses, err := l.Losses()
	if err != nil {
		return Accounting{}, err
	}
	storage, err := l.tx.Accounting()
	if err != nil {
		return Accounting{}, err
	}
	var total int64
	for _, value := range held {
		total += value.Bytes
	}
	return Accounting{len(keys), len(held), total, len(stops), losses, Limits{AcceptedLimit, HeldLimit, HeldByteLimit, StopLimit, StopByteLimit, LossByteLimit}, storage}, nil
}
