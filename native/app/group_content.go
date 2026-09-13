package app

import (
	"errors"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

type groupHeldView struct {
	groupledger.HeldRecord
	Available bool   `json:"available"`
	Current   string `json:"current"`
}

type groupInspection struct {
	Decision groupaccess.Decision
	Stable   bool
}

func (n *Node) reconcileGroupReservationsLocked(ids []string) error {
	if equalIDs(ids, n.Store.Reservations()) {
		return nil
	}
	return n.Store.SetReservations(ids)
}

func (n *Node) recoverGroupContentLocked() {
	if n.identity == nil || n.privateDatabase == nil {
		return
	}
	identity := *n.identity
	_ = n.privateDatabase.Close()
	database, local, digest, err := openPrivateProfile(n.Dir, identity)
	if err == nil {
		n.privateDatabase, n.private, n.privateDigest = database, local, digest
		err = n.restoreGroupHoldsLocked()
	}
	if err != nil {
		_ = n.lockPrivateLocked()
	}
}

// This scope only classifies immutable, fully validated runtime summaries.
// New admissions still verify stored bytes and cross their own commit boundary.
// No authority cache survives the read transaction or the next snapshot.
func (n *Node) inspectGroupObjectsLocked(objects []DisplayObject, available map[string]core.Manifest) (map[string]groupInspection, error) {
	results := map[string]groupInspection{}
	held := []groupledger.HeldRecord{}
	now := time.Now().UnixMilli()
	err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		current, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if current == nil || current.Digest != n.privateDigest {
			return errors.New("o estado privado mudou antes da observação")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, g *groupauthority.Registry) error {
			access, err := groupaccess.New(g, n.identity.Public)
			if err != nil {
				return err
			}
			entries, err := l.Held()
			if err != nil {
				return err
			}
			holds := map[string]groupledger.HeldRecord{}
			for _, entry := range entries {
				if entry.Expires > now {
					held = append(held, entry)
					holds[entry.ID] = entry
				}
			}
			for _, object := range objects {
				if object.Expires <= now {
					results[object.ID] = groupInspection{groupaccess.Decision{Status: "invalid", Reason: "expired-content"}, true}
					continue
				}
				previous, err := l.Accepted(object.ID)
				if err != nil {
					return err
				}
				if previous != nil && previous.Expires != object.Expires {
					return errors.New("expiração da admissão não corresponde ao conteúdo")
				}
				targetID := text(object.Content["target"])
				if object.Kind == "message" {
					targetID = text(object.Content["replyTo"])
				}
				var priorContext, targetContext *groupaccess.AcceptedContext
				if previous != nil {
					priorContext = &previous.Context
				}
				if targetID != "" {
					target, err := l.Accepted(targetID)
					if err != nil {
						return err
					}
					if target != nil {
						targetContext = &target.Context
					}
				}
				decision, err := access.Decide(groupaccess.Candidate{ID: object.ID, Kind: object.Kind, Author: object.Author, Readers: object.Readers, Public: object.Public, Content: object.Content}, priorContext, targetContext)
				if err != nil {
					return err
				}
				hold, exists := holds[object.ID]
				epoch := text(object.Content["groupEpoch"])
				if epoch == "" {
					epoch = text(object.Content["targetEpoch"])
				}
				if exists && (hold.GroupID != text(object.Content["conversation"]) || hold.EpochID != epoch || hold.Expires != object.Expires) {
					return errors.New("quarentena não corresponde ao conteúdo imutável")
				}
				stable := decision.Status == "invalid" || (previous != nil && decision.Status == "accepted") || (exists && (decision.Status == "quarantine" || decision.Status == "awaiting-proof"))
				results[object.ID] = groupInspection{decision, stable}
			}
			return nil
		})
		return err
	})
	if err == nil {
		ids := []string{}
		for _, entry := range held {
			if _, ok := available[entry.ID]; ok && n.Store.Has(entry.ID) {
				ids = append(ids, entry.ID)
			}
		}
		err = n.reconcileGroupReservationsLocked(ids)
	}
	if err != nil {
		n.recoverGroupContentLocked()
		return nil, err
	}
	n.groupHolds = held
	return results, nil
}

func (n *Node) protectedGroupContentLocked() map[string]bool {
	ids := map[string]bool{}
	for _, m := range n.Store.List() {
		ids[m.ID] = true
	}
	for _, entry := range n.private.Outbox {
		ids[entry.ID] = true
	}
	return ids
}

func (n *Node) restoreGroupHoldsLocked() error {
	if n.identity == nil || n.privateDatabase == nil {
		return nil
	}
	var held []groupledger.HeldRecord
	err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		_, err := groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, _ *groupauthority.Registry) error {
			var err error
			held, err = l.Held()
			return err
		})
		return err
	})
	if err != nil {
		return err
	}
	verified := map[string]bool{}
	for _, m := range n.Store.List() {
		verified[m.ID] = true
	}
	now := time.Now().UnixMilli()
	live := []groupledger.HeldRecord{}
	ids := []string{}
	for _, entry := range held {
		if entry.Expires > now {
			live = append(live, entry)
			if verified[entry.ID] {
				ids = append(ids, entry.ID)
			}
		}
	}
	if err = n.Store.SetReservations(ids); err != nil {
		return err
	}
	n.groupHolds = live
	return nil
}

func (n *Node) groupContentStateLocked() map[string]any {
	held := []groupHeldView{}
	if n.identity != nil {
		verified := map[string]bool{}
		if len(n.groupHolds) > 0 {
			for _, m := range n.Store.List() {
				verified[m.ID] = true
			}
		}
		for _, entry := range n.groupHolds {
			current := "not-rechecked"
			if d, ok := n.groupDecisions[entry.ID]; ok {
				current = d.Status
			}
			held = append(held, groupHeldView{entry, verified[entry.ID], current})
		}
	}
	return map[string]any{"held": held, "outbound": false}
}

func (n *Node) observeGroupLocked(id string, protected map[string]bool) (bool, error) {
	if n.identity == nil || n.privateDatabase == nil {
		return false, errors.New("desbloqueie a identidade")
	}
	accepted, err := n.observeGroupTransactionLocked(id, protected)
	if err != nil {
		n.recoverGroupContentLocked()
		return false, err
	}
	return accepted, nil
}

// Caller holds the application mutex. Admission derives from verified stored
// bytes and local authenticated history, never a provided summary/context.
func (n *Node) observeGroupTransactionLocked(id string, protected map[string]bool) (bool, error) {
	bundle, err := n.Store.GetWithTouch(id, false)
	if err != nil {
		return false, err
	}
	object, err := n.displayLocked(bundle)
	if err != nil {
		return false, err
	}
	if !groupaccess.HasBinding(object.Content) {
		return false, errors.New("falta a ligação de grupo")
	}
	raw, err := core.Canonical(bundle)
	if err != nil {
		return false, err
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return false, err
	}
	before := map[string]bool{}
	available := map[string]bool{}
	for _, manifest := range n.Store.List() {
		available[manifest.ID] = true
	}
	for _, id := range n.Store.Reservations() {
		if available[id] && n.Store.Has(id) {
			before[id] = true
		}
	}
	now := time.Now().UnixMilli()
	var decision groupaccess.Decision
	held := []groupledger.HeldRecord{}
	digest := n.privateDigest
	update := n.updateGroupState
	if update == nil {
		update = n.privateDatabase.Update
	}
	err = update(func(tx *groupstore.Tx) error {
		current, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if current == nil || current.Digest != n.privateDigest {
			return errors.New("o estado privado mudou antes da admissão")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, _ *groupauthority.Registry) error {
			previous, err := l.Accepted(id)
			if err != nil {
				return err
			}
			if previous != nil && previous.Expires != object.Expires {
				return errors.New("expiração da admissão não corresponde ao conteúdo")
			}
			result, err := l.Consider(groupaccess.Candidate{ID: id, Kind: object.Kind, Author: object.Author, Readers: object.Readers, Public: object.Public, Content: object.Content}, object.Expires, int64(len(raw)), protected, now)
			if err != nil {
				return err
			}
			decision = result.Decision
			changed := false
			if decision.Status == "accepted" {
				if object.Kind == "edit" || object.Kind == "delete" {
					target, err := l.Accepted(text(object.Content["target"]))
					if err != nil {
						return err
					}
					if target == nil || target.Context.Author != object.Author.ID {
						return errors.New("alvo sem contexto autenticado")
					}
					if previous, ok := next.Mutations[target.Context.ID]; ok && previous.Author != target.Context.Author {
						return errors.New("autoria do histórico não coincide")
					}
					manifest := core.Manifest{ID: target.Context.ID, ManifestBody: core.ManifestBody{Author: core.PublicIdentity{ID: target.Context.Author}, Expires: target.Expires}}
					changed = recordMutation(&next, manifest, bundle.Manifest, object.Content)
				}
				if object.Kind == "receipt" || object.Kind == "delivery" {
					target, err := l.Accepted(text(object.Content["target"]))
					if err != nil {
						return err
					}
					for operation, entry := range next.Outbox {
						if entry.ID != text(object.Content["target"]) {
							continue
						}
						if target == nil || entry.Author != target.Context.Author || entry.Conversation != target.Context.GroupID || entry.Expires != target.Expires || !equalIDs(outboxReaders(entry), target.Context.Readers) {
							return errors.New("confirmação não corresponde à intenção de grupo retida")
						}
						fact, exists := entry.Confirmations[object.Author.ID]
						if !exists || entry.Author == object.Author.ID {
							continue
						}
						if fact.ReceivedAt == 0 {
							fact.ReceivedAt = now
							changed = true
						}
						if object.Kind == "receipt" && fact.ReadAt == 0 {
							fact.ReadAt = now
							changed = true
						}
						entry.Confirmations[object.Author.ID] = fact
						next.Outbox[operation] = entry
					}
				}
			}
			entries, err := l.Held()
			if err != nil {
				return err
			}
			for _, entry := range entries {
				if entry.Expires > now {
					held = append(held, entry)
					if available[entry.ID] && n.Store.Has(entry.ID) {
						before[entry.ID] = true
					}
				}
			}
			ids := []string{}
			for id := range before {
				ids = append(ids, id)
			}
			if err = n.reconcileGroupReservationsLocked(ids); err != nil {
				return err
			}
			if changed {
				data, err := core.Canonical(next)
				if err != nil {
					return err
				}
				digest, err = profilestate.Write(tx, data, &n.privateDigest)
				if err != nil {
					return err
				}
			}
			return nil
		})
		return err
	})
	if err != nil {
		return false, err
	}
	ids := []string{}
	for _, entry := range held {
		if available[entry.ID] && n.Store.Has(entry.ID) {
			ids = append(ids, entry.ID)
		}
	}
	if err = n.reconcileGroupReservationsLocked(ids); err != nil {
		return false, err
	}
	n.private, n.privateDigest, n.groupHolds = next, digest, held
	if n.groupDecisions == nil {
		n.groupDecisions = map[string]groupaccess.Decision{}
	}
	n.groupDecisions[id] = decision
	return decision.Status == "accepted", nil
}
