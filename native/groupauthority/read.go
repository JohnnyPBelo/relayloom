package groupauthority

import (
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func (g *Registry) State(id string) (View, error) {
	var result View
	err := g.store.View(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		result, err = g.view(tx, r)
		return err
	})
	return result, err
}

type SyncState struct {
	View             View
	Anchor           groups.GroupAnchor
	Invitation       *groups.GroupInvitation
	InvitationParent *groups.GroupEpoch
	Consent          *groups.GroupConsent
	CheckedThrough   *int
	Admitted         bool
}

// Scheduling material is not admission. Call only within the authenticated
// registry transaction that derives any outgoing control data.
func (g *Registry) SyncState(id string) (SyncState, error) {
	var result SyncState
	if _, err := g.ScopeGeneration(); err != nil {
		return result, err
	}
	err := g.store.View(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		view, err := g.view(tx, r)
		if err != nil {
			return err
		}
		result = SyncState{view, r.Anchor, r.Invitation, r.InvitationParent, r.Consent, r.CheckedThrough, r.Admitted != nil}
		return nil
	})
	return result, err
}
func (g *Registry) Anchor(id string) (groups.GroupAnchor, error) {
	var result groups.GroupAnchor
	err := g.store.View(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		result = r.Anchor
		return nil
	})
	return result, err
}
func (g *Registry) List() ([]View, error) {
	result := []View{}
	err := g.store.View(func(tx *groupstore.Tx) error {
		keys, err := tx.Keys("group:")
		if err != nil {
			return err
		}
		if len(keys) > GroupLimit {
			return integrity(errors.New("limite de grupos ultrapassado"))
		}
		for _, key := range keys {
			r, err := g.record(tx, key[6:])
			if err != nil {
				return err
			}
			view, err := g.view(tx, r)
			if err != nil {
				return err
			}
			result = append(result, view)
		}
		return nil
	})
	return result, err
}
func (g *Registry) Proofs(id string, from, count int) ([]groups.GroupEpoch, error) {
	if from < 0 || from >= groups.EpochLimit || count < 1 || count > PageLimit {
		return nil, errors.New("pedido de provas fora dos limites")
	}
	result := []groups.GroupEpoch{}
	err := g.store.View(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		for n := from; r.Head != nil && n <= r.Head.Body.Number && len(result) < count; n++ {
			e, err := g.header(tx, r, n)
			if err != nil {
				return err
			}
			if e == nil {
				return integrity(errors.New("cadeia protegida incompleta"))
			}
			candidate := append(result, *e)
			data, err := core.Canonical(candidate)
			if err != nil {
				return err
			}
			if len(data) > PageBytes {
				break
			}
			result = candidate
		}
		return nil
	})
	return result, err
}
func (g *Registry) PrivateState(id, epochID string) (*groups.GroupSnapshot, error) {
	var result *groups.GroupSnapshot
	err := g.store.View(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		e, err := g.findEpoch(tx, r, epochID)
		if err != nil {
			return err
		}
		if e == nil {
			return nil
		}
		result, err = g.snapshot(tx, r, e)
		return err
	})
	return result, err
}
func (g *Registry) StopEvidence(id string) (*StopEvidence, error) {
	var result *StopEvidence
	err := g.store.View(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		result = r.Frozen
		return nil
	})
	return result, err
}
