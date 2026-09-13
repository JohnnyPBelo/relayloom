package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

func (n *Node) maySeedLocked(manifest core.Manifest) (bool, error) {
	if manifest.Kind != "message" || manifest.PublicKey != nil {
		return true, nil
	}
	// Cold locked profiles cannot authenticate their private retry journal.
	// This does not pause transit relay or seed-only nodes without an identity.
	if n.identity == nil {
		return !n.initialized(), nil
	}
	if manifest.Author.ID != n.identity.Public.ID {
		return true, nil
	}
	bundle, err := n.Store.GetWithTouch(manifest.ID, false)
	if err != nil {
		return false, err
	}
	object, err := n.displayLocked(bundle)
	if err != nil {
		return false, err
	}
	if !groupaccess.HasBinding(object.Content) {
		return true, nil
	}
	for operation, entry := range n.private.Outbox {
		if entry.ID != manifest.ID {
			continue
		}
		if entry.Phase != "ready" || entry.GroupEpoch == "" || entry.GroupEpoch != text(object.Content["groupEpoch"]) || entry.Conversation != text(object.Content["conversation"]) || !n.groupRetries[operation].SeedAllowed || n.blockedOutboxLocked(entry) {
			return false, nil
		}
		_, err := n.exactOutboxBundleLocked(entry)
		return err == nil, err
	}
	return false, nil
}

type groupRetry struct {
	groupledger.RetryResult
	SeedAllowed bool `json:"seedAllowed"`
}

func groupStopped(entry OutboxRecord) bool { return entry.GroupStopped != nil && *entry.GroupStopped }
func hasGroupOutbox(outbox map[string]OutboxRecord) bool {
	for _, entry := range outbox {
		if entry.GroupEpoch != "" {
			return true
		}
	}
	return false
}

// The caller owns this copy. Only the ledger checkpoint writes during a stop;
// the private document need not grow or be rewritten for revocation to commit.
func reconcileGroupOutbox(l *groupledger.Ledger, outbox map[string]OutboxRecord) (map[string]groupRetry, error) {
	results := map[string]groupRetry{}
	for operation, entry := range outbox {
		previous, err := l.Stop(operation)
		if err != nil {
			return nil, err
		}
		if entry.GroupEpoch == "" {
			if previous != nil {
				return nil, errors.New("paragem associada a envio sem época")
			}
			continue
		}
		if groupStopped(entry) && previous == nil {
			return nil, errors.New("envio parado sem paragem autenticada")
		}
		accepted, err := l.Accepted(entry.ID)
		if err != nil {
			return nil, err
		}
		if accepted != nil && (accepted.Context.Kind != "message" || accepted.Context.Author != entry.Author || accepted.Context.GroupID != entry.Conversation || accepted.Context.EpochID != entry.GroupEpoch || accepted.Expires != entry.Expires || !equalIDs(accepted.Context.Readers, outboxReaders(entry))) {
			return nil, errors.New("admissão não corresponde à intenção de envio")
		}
		received, _ := confirmationCounts(entry)
		result, err := l.ReconcileRetry(groupledger.RetryEntry{OperationID: operation, ID: entry.ID, GroupID: entry.Conversation, EpochID: entry.GroupEpoch}, received < len(entry.Confirmations))
		if err != nil {
			return nil, err
		}
		stopped := result.Stop != nil
		entry.GroupStopped = &stopped
		outbox[operation] = entry
		seed := false
		if accepted != nil && result.Stop == nil {
			authority, err := l.RetryAuthority(entry.Conversation, entry.GroupEpoch)
			if err != nil {
				return nil, err
			}
			seed = authority.Allowed
		}
		if result.Allowed && accepted == nil {
			result.Allowed = false
			result.Reason = "group-history-unavailable"
		}
		results[operation] = groupRetry{result, seed}
	}
	return results, nil
}

func groupOutboxReservations(outbox map[string]OutboxRecord, now int64) []string {
	ids := []string{}
	for _, entry := range outbox {
		if entry.GroupEpoch != "" && pendingOutbox(entry, now) {
			ids = append(ids, entry.ID)
		}
	}
	return ids
}

func (n *Node) reconcileGroupSendsLocked() error {
	if n.identity == nil || n.privateDatabase == nil || !hasGroupOutbox(n.private.Outbox) {
		return nil
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return err
	}
	var decisions map[string]groupRetry
	err = n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		current, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if current == nil || current.Digest != n.privateDigest {
			return errors.New("estado privado desactualizado")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, _ *groupauthority.Registry) error {
			var err error
			decisions, err = reconcileGroupOutbox(l, next.Outbox)
			return err
		})
		return err
	})
	if err != nil {
		n.cancelGroupPacketsLocked(true)
		identity := *n.identity
		_ = n.privateDatabase.Close()
		database, local, digest, readErr := openPrivateProfile(n.Dir, identity)
		if readErr != nil {
			_ = n.lockPrivateLocked()
		} else {
			n.privateDatabase, n.private, n.privateDigest = database, local, digest
			n.groupRetries = nil
		}
		return err
	}
	n.private, n.groupRetries = next, decisions
	n.cancelGroupPacketsLocked(false)
	return nil
}

func (n *Node) groupReservedIDsLocked() []string {
	ids := []string{}
	for _, id := range groupOutboxReservations(n.private.Outbox, time.Now().UnixMilli()) {
		if n.Store.Has(id) {
			ids = append(ids, id)
		}
	}
	return ids
}

func (n *Node) cancelGroupPacketsLocked(all bool) {
	ids := map[string]bool{}
	for operation, entry := range n.private.Outbox {
		if entry.GroupEpoch != "" && (all || (!n.groupRetries[operation].Allowed && !n.groupRetries[operation].SeedAllowed)) {
			ids[entry.ID] = true
		}
	}
	if len(ids) == 0 {
		return
	}
	n.Router.CancelLocal(func(payload any) bool {
		m, ok := payload.(map[string]any)
		if !ok || m["type"] != "bundle" {
			return false
		}
		bundle, ok := m["bundle"].(map[string]any)
		if !ok {
			return false
		}
		manifest, ok := bundle["manifest"].(map[string]any)
		return ok && ids[text(manifest["id"])]
	})
}
