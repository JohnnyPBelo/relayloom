package app

import (
	"errors"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

// The caller supplies a freshly verified, semantically authorized original.
// Event signatures come from Store.Get/receive decoding, never from metadata.
func recordConfirmation(next *PrivateState, event, original DisplayObject, owner string, now int64) bool {
	if (event.Kind != "delivery" && event.Kind != "receipt") || original.Kind != "message" || original.Public || event.Public || original.Author.ID != owner || event.Author.ID == owner || !contains(original.Readers, event.Author.ID) || !equalIDs(original.Readers, event.Readers) || text(event.Content["target"]) != original.ID {
		return false
	}
	for operation, record := range next.Outbox {
		if record.ID != original.ID || record.Author != owner || record.Created != original.Created || record.Expires != original.Expires || !equalIDs(outboxReaders(record), original.Readers) {
			continue
		}
		confirmation, ok := record.Confirmations[event.Author.ID]
		if !ok {
			return false
		}
		changed := false
		if confirmation.ReceivedAt == 0 {
			confirmation.ReceivedAt = now
			changed = true
		}
		if event.Kind == "receipt" && confirmation.ReadAt == 0 {
			confirmation.ReadAt = max(now, confirmation.ReceivedAt)
			changed = true
		}
		if changed {
			record.Confirmations[event.Author.ID] = confirmation
			next.Outbox[operation] = record
		}
		return changed
	}
	return false
}

func (n *Node) aggregateConfirmationsLocked(objects []DisplayObject, now int64) error {
	if n.identity == nil || len(n.private.Outbox) == 0 {
		return nil
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return err
	}
	changed := false
	for _, event := range objects {
		if event.Kind != "delivery" && event.Kind != "receipt" {
			continue
		}
		original := findObject(objects, text(event.Content["target"]))
		if original != nil && recordConfirmation(&next, event, *original, n.identity.Public.ID, now) {
			changed = true
		}
	}
	if changed {
		return n.persistPrivateLocked(next)
	}
	return nil
}

func (n *Node) journalReceivedConfirmationLocked(bundle core.Bundle) error {
	if n.identity == nil || len(n.private.Outbox) == 0 || (bundle.Manifest.Kind != "delivery" && bundle.Manifest.Kind != "receipt") {
		return nil
	}
	// Store admission can evict a now-unpinned original. Capture the verified
	// recipient's statement while its original authorization is still available.
	event, err := n.displayLocked(bundle)
	if err != nil {
		return nil
	}
	original, err := n.authorizedObjectLocked(text(event.Content["target"]), false)
	if err != nil {
		return nil
	}
	return n.aggregateConfirmationsLocked([]DisplayObject{*original, *event}, time.Now().UnixMilli())
}

func (n *Node) confirmationAllowedLocked(original *DisplayObject) bool {
	if n.identity == nil || original.Kind != "message" || original.Public || original.Author.ID == n.identity.Public.ID || !contains(original.Readers, n.identity.Public.ID) {
		return false
	}
	for _, id := range original.Readers {
		if contains(n.config.Blocked, id) {
			return false
		}
	}
	return true
}

// Suppression depends on surviving verified events, not a memory flag that
// could outlive eviction. A legacy read event also suppresses delivery issuance.
func (n *Node) retainedConfirmationLocked(original *DisplayObject, kind string) bool {
	for _, manifest := range n.Store.List() {
		if manifest.Author.ID != n.identity.Public.ID || (manifest.Kind != kind && !(kind == "delivery" && manifest.Kind == "receipt")) {
			continue
		}
		bundle, err := n.Store.GetWithTouch(manifest.ID, false)
		if err != nil {
			continue
		}
		event, err := n.displayLocked(bundle)
		if err == nil && !event.Public && text(event.Content["target"]) == original.ID && equalIDs(event.Readers, original.Readers) {
			return true
		}
	}
	return false
}

func (n *Node) ensureConfirmationLocked(original *DisplayObject, kind string) error {
	if kind != "receipt" && kind != "delivery" {
		return errors.New("confirmação inválida")
	}
	if !n.confirmationAllowedLocked(original) || n.retainedConfirmationLocked(original, kind) {
		return nil
	}
	// Authorize again at the issuance boundary; a cached view never authorizes
	// a signature after its target/dependency disappeared from the store.
	verified, err := n.authorizedObjectLocked(original.ID, false)
	if err != nil || !n.confirmationAllowedLocked(verified) {
		return err
	}
	cards, err := members(verified.Content["members"])
	if err != nil || !equalIDs(memberIDs(cards), verified.Readers) {
		return errors.New("destinatários da confirmação inválidos")
	}
	// Signed original member cards already establish the roster; issuing a
	// receipt must not require mutating contacts or available contact slots.
	bundle, err := core.CreateBundle(*n.identity, kind, Content{"type": kind, "target": verified.ID}, cards, false, core.DefaultTTL)
	if err != nil {
		return err
	}
	if _, err = n.Store.Put(bundle, false); err != nil {
		return err
	}
	_, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Normal, 2*time.Minute, false)
	return err
}

func (n *Node) issueDeliveriesLocked(objects []DisplayObject) {
	issued := 0
	// These summaries are already verified and authorized by objectsLocked.
	// Avoid scanning/decrypting every receipt again for every old message.
	retained := map[string]bool{}
	for _, event := range objects {
		if event.Author.ID == n.identity.Public.ID && (event.Kind == "delivery" || event.Kind == "receipt") {
			retained[text(event.Content["target"])] = true
		}
	}
	for i := range objects {
		original := &objects[i]
		if !n.confirmationAllowedLocked(original) || retained[original.ID] {
			continue
		}
		issued++
		_ = n.ensureConfirmationLocked(original, "delivery")
		if issued >= 2 {
			return
		}
	}
}

// Preserve the existing convenience of learning signed member cards on view.
// Contact quota/disk failures are independent of authorized content access.
func (n *Node) rememberViewedMembersLocked(original *DisplayObject) {
	cards, err := members(original.Content["members"])
	if err != nil {
		return
	}
	next := n.cloneConfig()
	changed := false
	for _, card := range cards {
		if card.ID == n.identity.Public.ID || contains(n.config.Blocked, card.ID) {
			continue
		}
		known := false
		for _, old := range next.Contacts {
			if old.ID == card.ID {
				known = true
				break
			}
		}
		if !known && len(next.Contacts) < 256 {
			next.Contacts = append(next.Contacts, card)
			changed = true
		}
	}
	if changed {
		_ = n.saveConfigLocked(next)
	}
}
