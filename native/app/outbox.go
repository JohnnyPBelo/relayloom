package app

import (
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

const outboxPendingLimit = 128
const outboxBytesLimit = 32 * 1024 * 1024
const outboxTotalLimit = 256
const outboxAttemptLimit = 1000000

var operationPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type Confirmation struct {
	ReceivedAt int64 `json:"receivedAt,omitempty"`
	ReadAt     int64 `json:"readAt,omitempty"`
}
type OutboxRecord struct {
	GroupEpoch    string                  `json:"groupEpoch,omitempty"`
	GroupStopped  *bool                   `json:"groupStopped,omitempty"`
	OperationID   string                  `json:"operationId"`
	Fingerprint   string                  `json:"fingerprint"`
	ID            string                  `json:"id"`
	Author        string                  `json:"author"`
	Conversation  string                  `json:"conversation"`
	Preview       string                  `json:"preview"`
	Created       int64                   `json:"created"`
	Expires       int64                   `json:"expires"`
	Priority      transport.Priority      `json:"priority"`
	Bytes         int64                   `json:"bytes"`
	Phase         string                  `json:"phase"`
	Attempts      int64                   `json:"attempts"`
	LastAttemptAt int64                   `json:"lastAttemptAt"`
	NextAttemptAt int64                   `json:"nextAttemptAt"`
	LastError     string                  `json:"lastError"`
	ManualPin     bool                    `json:"manualPin"`
	Confirmations map[string]Confirmation `json:"confirmations"`
}

func confirmationCounts(record OutboxRecord) (received, read int) {
	for _, value := range record.Confirmations {
		if value.ReceivedAt > 0 {
			received++
		}
		if value.ReadAt > 0 {
			read++
		}
	}
	return
}
func pendingOutbox(record OutboxRecord, now int64) bool {
	received, _ := confirmationCounts(record)
	return !groupStopped(record) && record.Phase != "unavailable" && record.Expires > now && received < len(record.Confirmations)
}
func outboxReaders(record OutboxRecord) []string {
	readers := []string{record.Author}
	for id := range record.Confirmations {
		readers = append(readers, id)
	}
	return sorted(readers)
}
func parseOutbox(value any, owner string, now int64) (map[string]OutboxRecord, error) {
	input, err := object(value)
	if err != nil || len(input) > outboxTotalLimit {
		return nil, errors.New("diário de envios inválido")
	}
	result := map[string]OutboxRecord{}
	ids := map[string]bool{}
	pending, bytes := 0, int64(0)
	for operation, value := range input {
		m, err := object(value)
		if err != nil {
			return nil, err
		}
		// Require the documented schema rather than accepting lossy coercion.
		fields := []string{"operationId", "fingerprint", "id", "author", "conversation", "preview", "created", "expires", "priority", "bytes", "phase", "attempts", "lastAttemptAt", "nextAttemptAt", "lastError", "manualPin", "confirmations"}
		_, epochPresent := m["groupEpoch"]
		_, stoppedPresent := m["groupStopped"]
		grouped := epochPresent || stoppedPresent
		if grouped {
			fields = append(fields, "groupEpoch", "groupStopped")
		}
		if len(m) != len(fields) {
			return nil, errors.New("formato do diário de envios incompatível")
		}
		for _, field := range fields {
			if _, ok := m[field]; !ok {
				return nil, errors.New("campo do diário de envios ausente")
			}
		}
		r := OutboxRecord{Confirmations: map[string]Confirmation{}}
		if grouped {
			epoch, ok := m["groupEpoch"].(string)
			stopped, flagOK := m["groupStopped"].(bool)
			if !ok || !flagOK || !core.ValidAddress(epoch) || !core.ValidAddress(text(m["conversation"])) {
				return nil, errors.New("ligação de época do envio inválida")
			}
			r.GroupEpoch, r.GroupStopped = epoch, &stopped
		}
		for field, dest := range map[string]*string{"operationId": &r.OperationID, "fingerprint": &r.Fingerprint, "id": &r.ID, "author": &r.Author, "conversation": &r.Conversation, "preview": &r.Preview, "phase": &r.Phase, "lastError": &r.LastError} {
			value, ok := m[field].(string)
			if !ok {
				return nil, errors.New("texto do diário de envios inválido")
			}
			*dest = value
		}
		priority, ok := m["priority"].(string)
		if !ok || !contains([]string{"sos", "normal", "bulk"}, priority) {
			return nil, errors.New("prioridade do diário de envios inválida")
		}
		r.Priority = transport.Priority(priority)
		for field, dest := range map[string]*int64{"created": &r.Created, "expires": &r.Expires, "bytes": &r.Bytes, "attempts": &r.Attempts, "lastAttemptAt": &r.LastAttemptAt, "nextAttemptAt": &r.NextAttemptAt} {
			v, err := number(m[field])
			if err != nil || v < 0 || v > 9007199254740991 {
				return nil, errors.New("número do diário de envios inválido")
			}
			*dest = v
		}
		r.ManualPin, err = boolean(m["manualPin"])
		if err != nil {
			return nil, err
		}
		if !operationPattern.MatchString(operation) || r.OperationID != operation || r.Author != owner || !core.ValidAddress(r.Author) || !core.ValidAddress(r.ID) || ids[r.ID] || !core.ValidAddress(r.Fingerprint) || !contains([]string{"preparing", "ready", "unavailable"}, r.Phase) || jsLen(r.Preview) > 160 || jsLen(r.LastError) > 240 || r.Created <= 0 || r.Expires-r.Created < 1000 || r.Expires-r.Created > core.MaxTTL || r.Bytes < 1 || r.Bytes > core.MaxBundleBytes || r.Attempts > outboxAttemptLimit || r.NextAttemptAt < r.LastAttemptAt || (r.Attempts == 0 && r.LastAttemptAt != 0) || (r.Attempts > 0 && r.LastAttemptAt == 0) {
			return nil, errors.New("registo do diário de envios inválido")
		}
		confirmations, err := object(m["confirmations"])
		if err != nil || len(confirmations) < 1 || len(confirmations) > 63 {
			return nil, errors.New("destinatários do diário de envios inválidos")
		}
		for id, value := range confirmations {
			c, err := object(value)
			if err != nil || !core.ValidAddress(id) || id == owner || len(c) > 2 {
				return nil, errors.New("confirmação do diário de envios inválida")
			}
			confirmation := Confirmation{}
			for field, value := range c {
				at, err := number(value)
				if err != nil || at <= 0 || at > 9007199254740991 {
					return nil, errors.New("instante de confirmação inválido")
				}
				switch field {
				case "receivedAt":
					confirmation.ReceivedAt = at
				case "readAt":
					confirmation.ReadAt = at
				default:
					return nil, errors.New("campo de confirmação inválido")
				}
			}
			if confirmation.ReadAt > 0 && (confirmation.ReceivedAt == 0 || confirmation.ReadAt < confirmation.ReceivedAt) {
				return nil, errors.New("confirmação de leitura inválida")
			}
			r.Confirmations[id] = confirmation
		}
		if strings.HasPrefix(r.Conversation, "dm:") {
			if r.Conversation != "dm:"+core.Hash([]byte(strings.Join(outboxReaders(r), ":"))) {
				return nil, errors.New("conversa do diário de envios inválida")
			}
		} else if !core.ValidAddress(r.Conversation) {
			return nil, errors.New("conversa do diário de envios inválida")
		}
		if pendingOutbox(r, now) {
			pending++
			bytes += r.Bytes
		}
		if pending > outboxPendingLimit || bytes > outboxBytesLimit {
			return nil, errors.New("reserva do diário de envios excedida")
		}
		ids[r.ID] = true
		result[operation] = r
	}
	return result, nil
}

func outboxPreview(value string) string {
	units := 0
	for index := 0; index < len(value); {
		r, size := utf8.DecodeRuneInString(value[index:])
		if r == utf8.RuneError && size == 1 && index+2 < len(value) && value[index] == 0xed && value[index+1] >= 0xa0 && value[index+1] <= 0xbf && value[index+2]&0xc0 == 0x80 {
			size = 3
		}
		n := 1
		if r > 0xffff {
			n = 2
		}
		if units+n > 160 {
			return value[:index]
		}
		units += n
		index += size
	}
	return value
}

func outboxPreviewMatches(value, preview string) bool {
	expected := outboxPreview(value)
	if preview == expected {
		return true
	}
	// Earlier Node releases used slice(0, 160), which could retain only the
	// high surrogate. Accept exactly that legacy prefix without changing the
	// signed payload or widening any author/reader/ID verification.
	if jsLen(expected) != 159 || len(expected) >= len(value) {
		return false
	}
	r, _ := utf8.DecodeRuneInString(value[len(expected):])
	if r <= 0xffff {
		return false
	}
	high := 0xd800 + ((r - 0x10000) >> 10)
	legacy := expected + string([]byte{byte(0xe0 | (high >> 12)), byte(0x80 | ((high >> 6) & 0x3f)), byte(0x80 | (high & 0x3f))})
	return preview == legacy
}

func (n *Node) exactOutboxBundleLocked(record OutboxRecord) (core.Bundle, error) {
	bundle, err := n.Store.GetWithTouch(record.ID, false)
	if err != nil {
		return core.Bundle{}, err
	}
	encoded, err := core.Canonical(bundle)
	if err != nil {
		return core.Bundle{}, err
	}
	m := bundle.Manifest
	readers := []string{}
	for _, key := range m.Keys {
		readers = append(readers, key.Reader)
	}
	if m.ID != record.ID || m.Author.ID != record.Author || m.Kind != "message" || m.PublicKey != nil || m.Created != record.Created || m.Expires != record.Expires || int64(len(encoded)) != record.Bytes || !equalIDs(readers, outboxReaders(record)) {
		return core.Bundle{}, errors.New("conteúdo do envio não corresponde ao diário")
	}
	object, err := n.displayLocked(bundle)
	if err != nil {
		return core.Bundle{}, err
	}
	previewSource := text(object.Content["text"])
	if record.GroupEpoch != "" {
		previewSource = groupMessagePreviewSource(object.Content)
	}
	if text(object.Content["conversation"]) != record.Conversation || !outboxPreviewMatches(previewSource, record.Preview) {
		return core.Bundle{}, errors.New("conteúdo do envio não corresponde ao diário")
	}
	if record.GroupEpoch != "" && text(object.Content["groupEpoch"]) != record.GroupEpoch {
		return core.Bundle{}, errors.New("reserva não corresponde à época de envio")
	}
	cards, err := members(object.Content["members"])
	if err != nil || !equalIDs(memberIDs(cards), readers) {
		return core.Bundle{}, errors.New("destinatários do envio não correspondem ao diário")
	}
	return bundle, nil
}

func outboxManifestMatches(record OutboxRecord, manifest core.Manifest) bool {
	readers := make([]string, 0, len(manifest.Keys))
	for _, key := range manifest.Keys {
		readers = append(readers, key.Reader)
	}
	return manifest.ID == record.ID && manifest.Author.ID == record.Author && manifest.Kind == "message" && manifest.PublicKey == nil && manifest.Created == record.Created && manifest.Expires == record.Expires && equalIDs(readers, outboxReaders(record))
}
func (n *Node) outboxManifestsLocked() map[string]core.Manifest {
	manifests := map[string]core.Manifest{}
	for _, manifest := range n.Store.List() {
		manifests[manifest.ID] = manifest
	}
	return manifests
}
func (n *Node) reconcileOutboxLocked(now int64) error { return n.reconcileOutboxModeLocked(now, false) }
func (n *Node) recoverOutboxLocked(now int64) error   { return n.reconcileOutboxModeLocked(now, true) }
func (n *Node) reconcileOutboxModeLocked(now int64, recovering bool) error {
	if n.identity == nil || len(n.private.Outbox) == 0 {
		return nil
	}
	return n.reconcileOutboxManifestsLocked(now, recovering, n.outboxManifestsLocked())
}
func (n *Node) reconcileOutboxManifestsLocked(now int64, recovering bool, manifests map[string]core.Manifest) error {
	if n.identity == nil {
		return nil
	}
	if err := n.reconcileGroupSendsLocked(manifests); err != nil {
		return err
	}
	if len(n.private.Outbox) == 0 {
		return nil
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return err
	}
	changed := false
	reserved := n.Store.Reservations()
	// Store.List verifies the current bytes/fingerprint before returning each
	// manifest. Warm state queries need no attachment decryption/rehydration.
	for operation, record := range next.Outbox {
		if pendingOutbox(record, now) {
			available := outboxManifestMatches(record, manifests[record.ID])
			if available && (recovering || record.Phase == "preparing") {
				_, verifyErr := n.exactOutboxBundleLocked(record)
				available = verifyErr == nil
			}
			if !available {
				record.Phase = "unavailable"
				record.LastError = "O conteúdo original do envio está indisponível"
				changed = true
			} else {
				if record.GroupEpoch != "" {
					// Unchanged availability flags need no repeated full-set verification.
					// Store.List already checked the actual bytes for this snapshot.
					if !contains(reserved, record.ID) {
						reserved = append(reserved, record.ID)
						if err = n.Store.SetReservations(reserved); err != nil {
							return err
						}
					}
				} else if !n.Store.IsPinned(record.ID) {
					if err = n.Store.Pin(record.ID, true); err != nil {
						return err
					}
				}
				if record.Phase == "preparing" {
					if record.GroupEpoch != "" {
						if err := n.Store.Pin(record.ID, record.ManualPin || n.Store.IsPinned(record.ID)); err != nil {
							return err
						}
					}
					record.Phase = "ready"
					changed = true
				}
			}
		}
		next.Outbox[operation] = record
	}
	// Commit terminal/recovered state before releasing any automatic reserve.
	if changed {
		if err = n.persistPrivateLocked(next); err != nil {
			return err
		}
	}
	for _, record := range n.private.Outbox {
		if record.GroupEpoch == "" && !pendingOutbox(record, now) && !record.ManualPin && n.Store.IsPinned(record.ID) {
			if _, err := n.Store.GetWithTouch(record.ID, false); err != nil {
				err = n.Store.Remove(record.ID)
				if err != nil {
					return err
				}
			} else if err := n.Store.Pin(record.ID, false); err != nil {
				return err
			}
		}
	}
	return nil
}

func (n *Node) blockedOutboxLocked(record OutboxRecord) bool {
	for id := range record.Confirmations {
		if contains(n.config.Blocked, id) {
			return true
		}
	}
	return false
}
func (n *Node) outboxItemLocked(record OutboxRecord, now int64, retained bool) map[string]any {
	retained = retained && record.Expires > now
	value, _ := cloneValue(record)
	item, _ := object(value)
	delete(item, "fingerprint")
	delete(item, "phase")
	delete(item, "confirmations")
	received, read := confirmationCounts(record)
	status := "pending"
	switch {
	case read == len(record.Confirmations):
		status = "read"
	case received == len(record.Confirmations):
		status = "received"
	case groupStopped(record):
		status = "superseded"
	case record.Expires <= now:
		status = "expired"
	case record.Phase == "unavailable" || !retained:
		status = "unavailable"
	case n.blockedOutboxLocked(record):
		status = "blocked"
	}
	recipients := make([]map[string]any, 0, len(record.Confirmations))
	for _, id := range outboxReaders(record) {
		if id == record.Author {
			continue
		}
		entry := map[string]any{"id": id}
		c := record.Confirmations[id]
		if c.ReceivedAt > 0 {
			entry["receivedAt"] = c.ReceivedAt
		}
		if c.ReadAt > 0 {
			entry["readAt"] = c.ReadAt
		}
		recipients = append(recipients, entry)
	}
	if record.GroupEpoch != "" {
		item["groupAuthority"] = n.groupRetries[record.OperationID]
	}
	item["status"], item["accepted"], item["contentExpired"], item["retained"] = status, record.Phase == "ready" && retained, record.Expires <= now, retained
	item["receivedCount"], item["readCount"], item["recipientCount"], item["recipients"] = received, read, len(record.Confirmations), recipients
	return item
}
func (n *Node) outboxItemsLocked(now int64, manifests map[string]core.Manifest) []map[string]any {
	items := []map[string]any{}
	if n.identity == nil {
		return items
	}
	records := make([]OutboxRecord, 0, len(n.private.Outbox))
	for _, record := range n.private.Outbox {
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].Created == records[j].Created {
			return records[i].ID < records[j].ID
		}
		return records[i].Created < records[j].Created
	})
	for _, record := range records {
		items = append(items, n.outboxItemLocked(record, now, outboxManifestMatches(record, manifests[record.ID])))
	}
	return items
}
func (n *Node) outboxResponseLocked(operation string) (map[string]any, error) {
	manifests := n.outboxManifestsLocked()
	now := time.Now().UnixMilli()
	if err := n.reconcileOutboxManifestsLocked(now, false, manifests); err != nil {
		return nil, err
	}
	record := n.private.Outbox[operation]
	item := n.outboxItemLocked(record, now, outboxManifestMatches(record, manifests[record.ID]))
	return map[string]any{"accepted": item["accepted"], "id": record.ID, "outbox": item}, nil
}

func (n *Node) sendLocked(body map[string]any) (any, error) {
	operation := text(body["operationId"])
	if !operationPattern.MatchString(operation) {
		return nil, errors.New("identificador de operação UUIDv4 inválido")
	}
	content, err := object(body["content"])
	if err != nil || text(content["type"]) != "message" {
		return nil, errors.New("o envio persistente exige uma mensagem privada")
	}
	ids, err := stringsList(body["recipients"], 64, true)
	if err != nil {
		return nil, err
	}
	unique := map[string]bool{}
	for _, id := range ids {
		unique[id] = true
	}
	ids = []string{}
	remote := false
	for id := range unique {
		ids = append(ids, id)
		remote = remote || id != n.identity.Public.ID
	}
	if !remote {
		return nil, errors.New("indique pelo menos um destinatário")
	}
	ids = sorted(ids)
	ttl := core.DefaultTTL
	if value, ok := body["ttlMs"]; ok {
		ttl, err = number(value)
		if err != nil || ttl < 1000 || ttl > core.MaxTTL {
			return nil, errors.New("prazo inválido")
		}
	}
	encoded, err := core.Canonical(map[string]any{"content": content, "recipients": ids, "ttlMs": ttl})
	if err != nil {
		return nil, err
	}
	fingerprint := core.Hash(encoded)
	if existing, ok := n.private.Outbox[operation]; ok {
		if existing.Fingerprint != fingerprint {
			return nil, errors.New("a operação já existe com outro conteúdo")
		}
		if _, err = n.objectsLocked(); err != nil {
			return nil, err
		}
		return n.outboxResponseLocked(operation)
	}
	if _, err = n.objectsLocked(); err != nil {
		return nil, err
	}
	if groupaccess.HasBinding(content) {
		return n.sendGroupLocked(operation, fingerprint, Content(content), ids, ttl)
	}
	prepared, err := n.prepareLocked(Content(content), ids, ttl)
	if err != nil {
		return nil, err
	}
	bundle := prepared.bundle
	encoded, err = core.Canonical(bundle)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	pending, bytes := 0, int64(len(encoded))
	terminal := []OutboxRecord{}
	for _, record := range next.Outbox {
		if pendingOutbox(record, now) {
			pending++
			bytes += record.Bytes
		} else {
			terminal = append(terminal, record)
		}
	}
	if pending >= outboxPendingLimit || bytes > outboxBytesLimit {
		return nil, errors.New("reserva de envios pendentes atingida; aguarde a receção ou expiração")
	}
	sort.Slice(terminal, func(i, j int) bool {
		if terminal[i].Created == terminal[j].Created {
			return terminal[i].ID < terminal[j].ID
		}
		return terminal[i].Created < terminal[j].Created
	})
	for len(next.Outbox) >= outboxTotalLimit && len(terminal) > 0 {
		delete(next.Outbox, terminal[0].OperationID)
		terminal = terminal[1:]
	}
	if len(next.Outbox) >= outboxTotalLimit {
		return nil, errors.New("limite do diário de envios atingido")
	}
	record := OutboxRecord{OperationID: operation, Fingerprint: fingerprint, ID: bundle.Manifest.ID, Author: n.identity.Public.ID, Conversation: text(prepared.content["conversation"]), Preview: outboxPreview(text(prepared.content["text"])), Created: bundle.Manifest.Created, Expires: bundle.Manifest.Expires, Priority: prepared.priority, Bytes: int64(len(encoded)), Phase: "preparing", Confirmations: map[string]Confirmation{}}
	for _, key := range bundle.Manifest.Keys {
		if key.Reader != record.Author {
			record.Confirmations[key.Reader] = Confirmation{}
		}
	}
	next.Outbox[operation] = record
	if err = n.persistPrivateLocked(next); err != nil {
		return nil, err
	}
	if _, err = n.Store.Put(bundle, true); err != nil {
		// Preserve the operation even when quota/disk admission fails; a retry
		// must never sign a different message under that operation ID.
		_ = n.reconcileOutboxLocked(time.Now().UnixMilli())
		return nil, err
	}
	next, err = copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	record.Phase = "ready"
	next.Outbox[operation] = record
	if err = n.persistPrivateLocked(next); err != nil {
		return nil, err
	}
	if n.connectedOutboxLocked() {
		if attemptErr := n.attemptOutboxLocked(operation, time.Now().UnixMilli()); attemptErr != nil && n.identity == nil {
			return nil, attemptErr
		}
	}
	return n.outboxResponseLocked(operation)
}

func retryDelay(attempt int64) int64 {
	delay := int64(2200)
	for i := int64(1); i < attempt && delay < 60000; i++ {
		delay *= 2
	}
	return min(delay, 60000)
}
func (n *Node) connectedOutboxLocked() bool {
	for _, peer := range n.Router.Peers() {
		if peer.Connected {
			return true
		}
	}
	return false
}
func (n *Node) attemptOutboxLocked(operation string, now int64) error {
	if err := n.reconcileGroupSendsLocked(); err != nil {
		return err
	}
	record, exists := n.private.Outbox[operation]
	if !exists || record.Phase != "ready" || !pendingOutbox(record, now) || record.NextAttemptAt > now || n.blockedOutboxLocked(record) {
		return nil
	}
	if record.GroupEpoch != "" && !n.groupRetries[operation].Allowed {
		return nil
	}
	bundle, err := n.exactOutboxBundleLocked(record)
	if err != nil {
		return n.reconcileOutboxLocked(now)
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return err
	}
	record.Attempts = min(record.Attempts+1, outboxAttemptLimit)
	record.LastAttemptAt = now
	record.NextAttemptAt = now + retryDelay(record.Attempts)
	record.LastError = ""
	next.Outbox[operation] = record
	if err = n.persistPrivateLocked(next); err != nil {
		return err
	}
	_, broadcastErr := n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, record.Priority, min(2*time.Minute, time.Duration(record.Expires-now)*time.Millisecond), false)
	if broadcastErr != nil {
		next, err = copyPrivate(n.private, n.identity.Public.ID)
		if err != nil {
			return err
		}
		record.LastError = "Transporte temporariamente indisponível; o envio continua guardado"
		next.Outbox[operation] = record
		if err = n.persistPrivateLocked(next); err != nil {
			return err
		}
	}
	return nil
}
func (n *Node) flushOutboxLocked(now int64) {
	if !n.connectedOutboxLocked() {
		return
	}
	due := []OutboxRecord{}
	for _, record := range n.private.Outbox {
		if record.Phase == "ready" && pendingOutbox(record, now) && record.NextAttemptAt <= now && !n.blockedOutboxLocked(record) {
			due = append(due, record)
		}
	}
	rank := map[transport.Priority]int{transport.SOS: 0, transport.Normal: 1, transport.Bulk: 2}
	sort.Slice(due, func(i, j int) bool {
		if rank[due[i].Priority] != rank[due[j].Priority] {
			return rank[due[i].Priority] < rank[due[j].Priority]
		}
		if due[i].Created == due[j].Created {
			return due[i].ID < due[j].ID
		}
		return due[i].Created < due[j].Created
	})
	for _, record := range due[:min(2, len(due))] {
		if err := n.attemptOutboxLocked(record.OperationID, now); err != nil {
			n.lastTransportError = "Não foi possível guardar a tentativa de envio"
		}
	}
}
func (n *Node) retryOutboxLocked(operation string) (any, error) {
	if !operationPattern.MatchString(operation) {
		return nil, errors.New("identificador de operação UUIDv4 inválido")
	}
	if _, ok := n.private.Outbox[operation]; !ok {
		return nil, errors.New("envio desconhecido")
	}
	if _, err := n.objectsLocked(); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	record := n.private.Outbox[operation]
	if pendingOutbox(record, now) && record.Phase == "ready" && !n.blockedOutboxLocked(record) {
		if now < record.LastAttemptAt+2200 {
			return nil, errors.New("aguarde antes de repetir a tentativa")
		}
		next, err := copyPrivate(n.private, n.identity.Public.ID)
		if err != nil {
			return nil, err
		}
		record.NextAttemptAt = now
		next.Outbox[operation] = record
		if err = n.persistPrivateLocked(next); err != nil {
			return nil, err
		}
	}
	if n.connectedOutboxLocked() {
		if err := n.attemptOutboxLocked(operation, time.Now().UnixMilli()); err != nil {
			return nil, err
		}
	}
	return n.outboxResponseLocked(operation)
}

func outboxPolicy() map[string]any {
	return map[string]any{"maxRecords": outboxTotalLimit, "maxPending": outboxPendingLimit, "maxPendingBytes": outboxBytesLimit, "idempotency": "retained-records"}
}

func (n *Node) pinOutboxLocked(id string, value bool) error {
	if err := n.reconcileOutboxLocked(time.Now().UnixMilli()); err != nil {
		return err
	}
	for operation, record := range n.private.Outbox {
		if record.ID != id {
			continue
		}
		if !value && pendingOutbox(record, time.Now().UnixMilli()) {
			return errors.New("o envio pendente mantém uma reserva até à receção ou expiração")
		}
		next, err := copyPrivate(n.private, n.identity.Public.ID)
		if err != nil {
			return err
		}
		record.ManualPin = value
		next.Outbox[operation] = record
		// Retain the encrypted intent first, so a crash cannot lose an explicit
		// manual pin to the automatic release path.
		if err = n.persistPrivateLocked(next); err != nil {
			return err
		}
		return n.Store.Pin(id, value)
	}
	return n.Store.Pin(id, value)
}
