package app

import (
	"bytes"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func groupMessagePreviewSource(content Content) string {
	value := text(content["text"])
	if value == "" {
		if attachments, ok := content["attachments"].([]any); ok && len(attachments) > 0 {
			if file, err := object(attachments[0]); err == nil {
				value = text(file["name"])
			}
		}
	}
	if value == "" {
		value = "Mensagem"
	}
	return value
}

func groupMessagePreview(content Content) string {
	return outboxPreview(groupMessagePreviewSource(content))
}

// A locally authored bundle is fully verified before its admission and intent
// share one SQL commit. No content-store or network write happens before that
// commit. A preparing record whose payload is lost never signs a replacement.
func (n *Node) sendGroupLocked(operation, fingerprint string, input Content, recipients []string, ttl int64) (any, error) {
	if err := n.requireGroupReplayLocked(); err != nil {
		return nil, err
	}
	if err := validateContent(input); err != nil {
		return nil, err
	}
	binding, err := groupaccess.ParseBinding(input)
	if err != nil {
		return nil, err
	}
	if text(input["type"]) != "message" || binding.Epoch == "" || binding.Audience == "historical" {
		return nil, errors.New("esta operação exige uma mensagem de grupo")
	}
	attachments, _ := input["attachments"].([]any)
	if strings.TrimSpace(text(input["text"])) == "" && len(attachments) == 0 {
		return nil, errors.New("escreva uma mensagem ou junte um anexo")
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	digest := n.privateDigest
	var bundle core.Bundle
	var entry OutboxRecord
	update := n.updateGroupState
	if update == nil {
		update = n.privateDatabase.Update
	}
	protected := n.protectedGroupContentLocked()
	err = update(func(tx *groupstore.Tx) error {
		current, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if current == nil || current.Digest != n.privateDigest {
			return errors.New("o estado privado mudou antes do envio")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, g *groupauthority.Registry) error {
			if _, err := reconcileGroupOutbox(l, next.Outbox); err != nil {
				return err
			}
			if _, ok := next.Outbox[operation]; ok {
				return errors.New("a intenção já existe; consulte o seu estado")
			}
			current, err := g.State(binding.Conversation)
			if err != nil {
				return err
			}
			if current.Status != "active" || current.Head == nil || current.Head.ID != binding.Epoch {
				return errors.New("o grupo mudou; reveja os destinatários antes de enviar")
			}
			snapshot, err := g.PrivateState(binding.Conversation, binding.Epoch)
			if err != nil {
				return err
			}
			if snapshot == nil {
				return errors.New("falta confirmar o estado privado do grupo")
			}
			cards := append([]core.PublicIdentity{}, snapshot.Members...)
			if binding.Audience == "target" {
				target, err := l.Accepted(text(input["replyTo"]))
				if err != nil {
					return err
				}
				if target == nil || target.Context.GroupID != binding.Conversation || target.Context.EpochID != binding.TargetEpoch || target.Context.Kind != "message" {
					return errors.New("a resposta exige uma mensagem de grupo já verificada")
				}
				filtered := []core.PublicIdentity{}
				for _, card := range cards {
					if contains(target.Context.Readers, card.ID) {
						filtered = append(filtered, card)
					}
				}
				cards = filtered
			}
			ids := sorted(memberIDs(cards))
			requested := map[string]bool{n.identity.Public.ID: true}
			for _, id := range recipients {
				requested[id] = true
			}
			selected := []string{}
			for id := range requested {
				selected = append(selected, id)
			}
			if len(ids) < 2 || !contains(ids, n.identity.Public.ID) || !equalIDs(ids, selected) {
				return errors.New("os destinatários não correspondem à audiência verificada do grupo")
			}
			for _, id := range ids {
				if contains(n.config.Blocked, id) {
					return errors.New("há um destinatário bloqueado")
				}
			}
			if supplied, exists := input["members"]; exists {
				a, err := core.Canonical(supplied)
				if err != nil {
					return err
				}
				b, err := core.Canonical(cards)
				if err != nil {
					return err
				}
				if !bytes.Equal(a, b) {
					return errors.New("os cartões indicados não correspondem ao grupo verificado")
				}
			}
			raw, err := cloneValue(input)
			if err != nil {
				return err
			}
			values, err := object(raw)
			if err != nil {
				return err
			}
			content := Content(values)
			content["members"] = cards
			if err := validateContent(content); err != nil {
				return err
			}
			bundle, err = core.CreateBundle(*n.identity, "message", content, cards, false, ttl)
			if err != nil {
				return err
			}
			if err := core.VerifyBundle(bundle); err != nil {
				return err
			}
			decoded, err := core.DecryptBundle(bundle, n.identity)
			if err != nil {
				return err
			}
			verified, err := object(decoded)
			if err != nil {
				return err
			}
			if err := validateContent(Content(verified)); err != nil {
				return err
			}
			a, err := core.Canonical(content)
			if err != nil {
				return err
			}
			b, err := core.Canonical(verified)
			if err != nil {
				return err
			}
			if !bytes.Equal(a, b) {
				return errors.New("o conteúdo assinado não corresponde ao envio")
			}
			encoded, err := core.Canonical(bundle)
			if err != nil {
				return err
			}
			priority := transport.Priority(text(content["priority"]))
			if priority == "" {
				priority = transport.Normal
				if len(attachments) > 0 {
					priority = transport.Bulk
				}
			}
			stopped := false
			entry = OutboxRecord{OperationID: operation, Fingerprint: fingerprint, ID: bundle.Manifest.ID, Author: n.identity.Public.ID, Conversation: binding.Conversation,
				GroupEpoch: binding.Epoch, GroupStopped: &stopped, Preview: groupMessagePreview(Content(verified)), Created: bundle.Manifest.Created, Expires: bundle.Manifest.Expires,
				Priority: priority, Bytes: int64(len(encoded)), Phase: "preparing", Confirmations: map[string]Confirmation{}}
			for _, id := range ids {
				if id != entry.Author {
					entry.Confirmations[id] = Confirmation{}
				}
			}
			now := time.Now().UnixMilli()
			pending, totalBytes := 0, entry.Bytes
			terminal := []OutboxRecord{}
			for _, record := range next.Outbox {
				if pendingOutbox(record, now) {
					pending++
					totalBytes += record.Bytes
				} else {
					terminal = append(terminal, record)
				}
			}
			if pending >= outboxPendingLimit || totalBytes > outboxBytesLimit {
				return errors.New("reserva de envios pendentes atingida; aguarde a recepção ou expiração")
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
				return errors.New("limite do diário de envios atingido")
			}
			next.Outbox[operation] = entry
			retained := map[string]bool{}
			for operation, record := range next.Outbox {
				retained[operation] = true
				protected[record.ID] = true
			}
			admission, err := l.Consider(groupaccess.Candidate{ID: entry.ID, Kind: "message", Author: bundle.Manifest.Author, Readers: ids, Content: verified}, entry.Expires, entry.Bytes, protected, now)
			if err != nil {
				return err
			}
			if admission.Decision.Status != "accepted" {
				return errors.New("a mensagem não pôde ser admitida neste grupo")
			}
			if err := l.RetireStops(retained); err != nil {
				return err
			}
			data, err := core.Canonical(next)
			if err != nil {
				return err
			}
			digest, err = profilestate.Write(tx, data, &n.privateDigest)
			return err
		})
		return err
	})
	if err != nil {
		n.recoverGroupContentLocked()
		return nil, err
	}
	n.private, n.privateDigest = next, digest
	if _, err := n.Store.PutReserved(bundle, false); err != nil {
		failed, copyErr := copyPrivate(n.private, n.identity.Public.ID)
		if copyErr == nil {
			entry.Phase = "unavailable"
			entry.LastError = "Não foi possível guardar o conteúdo do envio. Não foi criado outro ID."
			failed.Outbox[operation] = entry
			copyErr = n.persistPrivateLocked(failed)
		}
		if copyErr == nil {
			copyErr = n.restoreGroupHoldsLocked()
		}
		if copyErr != nil {
			_ = n.lockPrivateLocked()
		}
		return nil, err
	}
	next, err = copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	entry.Phase = "ready"
	next.Outbox[operation] = entry
	if err := n.persistPrivateLocked(next); err != nil {
		return nil, err
	}
	if n.connectedOutboxLocked() {
		if err := n.attemptOutboxLocked(operation, time.Now().UnixMilli()); err != nil && n.identity == nil {
			return nil, err
		}
	}
	return n.outboxResponseLocked(operation)
}
