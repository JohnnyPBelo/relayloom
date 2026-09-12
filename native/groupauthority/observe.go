package groupauthority

import (
	"bytes"
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

type invalidProof struct{ error }
type Observation struct {
	Rejected     string `json:"rejected,omitempty"`
	Status       View   `json:"status"`
	Accepted     int    `json:"accepted"`
	MissingProof bool   `json:"missingProof"`
}

func (g *Registry) save(tx *groupstore.Tx, r *record) error {
	data, err := core.Canonical(r)
	if err != nil {
		return err
	}
	if len(data) > CheckpointBytes {
		return errors.New("checkpoint excede a reserva individual")
	}
	return tx.Put(groupKey(r.Anchor.ID), data, groupstore.Checkpoint)
}
func (g *Registry) append(tx *groupstore.Tx, r *record, epoch groups.GroupEpoch) (string, error) {
	if err := groups.VerifyEpoch(epoch, r.Anchor); err != nil {
		return "", invalidProof{err}
	}
	if r.Frozen != nil && r.Frozen.Reason == "forked" {
		return "frozen", nil
	}
	var sameEpoch *groups.GroupEpoch
	if r.Frozen != nil && r.Frozen.Reason == "capacity" && r.Frozen.Observed.Body.Number == epoch.Body.Number {
		sameEpoch = r.Frozen.Observed
	} else {
		var err error
		sameEpoch, err = g.header(tx, r, epoch.Body.Number)
		if err != nil {
			return "", err
		}
	}
	if sameEpoch != nil {
		if sameEpoch.ID == epoch.ID {
			return "duplicate", nil
		}
		var parent *groups.GroupEpoch
		if epoch.Body.Number > 0 {
			var err error
			parent, err = g.header(tx, r, epoch.Body.Number-1)
			if err != nil {
				return "", err
			}
			if parent == nil || epoch.Body.Previous == nil || *epoch.Body.Previous != parent.ID {
				return "missing-proof", nil
			}
		}
		if parent != nil {
			if _, err := groups.VerifyEpochLink(r.Anchor, *parent, epoch); err != nil {
				return "", invalidProof{err}
			}
		}
		r.Frozen = &StopEvidence{Reason: "forked", First: sameEpoch, Second: &epoch}
		return "frozen", nil
	}
	if r.Frozen != nil {
		return "frozen", nil
	}
	if r.Head != nil {
		if epoch.Body.Number != r.Head.Body.Number+1 || epoch.Body.Previous == nil || *epoch.Body.Previous != r.Head.ID {
			return "missing-proof", nil
		}
		if _, err := groups.VerifyEpochLink(r.Anchor, *r.Head, epoch); err != nil {
			return "", invalidProof{err}
		}
	} else if epoch.Body.Number != 0 {
		return "missing-proof", nil
	}
	if epoch.Body.State != "closed" {
		data, err := core.Canonical(epoch)
		if err != nil {
			return "", err
		}
		if err = tx.Put(headerKey(r.Anchor.ID, epoch.Body.Number), data, groupstore.Data); err != nil {
			if !errors.Is(err, groupstore.ErrCapacity) || r.Head == nil {
				return "", err
			}
			r.Frozen = &StopEvidence{Reason: "capacity", Resource: "header", Observed: &epoch}
			return "frozen", nil
		}
	}
	r.Head = &epoch
	if r.Admitted != nil && !hasCard(&epoch, g.identity.Public.ID, r.Admitted.CardHash) {
		r.Admitted = nil
		r.CheckedThrough = nil
	}
	return "adopted", nil
}
func (g *Registry) ObserveHeaders(id string, epochs []groups.GroupEpoch) (Observation, error) {
	var result Observation
	if len(epochs) < 1 || len(epochs) > PageLimit {
		return result, errors.New("página de provas fora dos limites")
	}
	data, err := core.Canonical(epochs)
	if err != nil {
		return result, err
	}
	if len(data) > PageBytes {
		return result, errors.New("página de provas demasiado grande")
	}
	var rejected error
	err = g.store.Update(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		before, err := core.Canonical(r)
		if err != nil {
			return err
		}
		for _, epoch := range epochs {
			status, err := g.append(tx, r, epoch)
			if err != nil {
				var invalid invalidProof
				if !errors.As(err, &invalid) {
					return err
				}
				rejected = err
				break
			}
			if status == "adopted" {
				result.Accepted++
			}
			if status == "missing-proof" {
				result.MissingProof = true
				break
			}
			if status == "frozen" {
				break
			}
		}
		after, err := core.Canonical(r)
		if err != nil {
			return err
		}
		if !bytes.Equal(before, after) {
			if err = g.save(tx, r); err != nil {
				return err
			}
		}
		result.Status, err = g.view(tx, r)
		return err
	})
	if err != nil {
		return Observation{}, err
	}
	if rejected != nil && g.rejections != nil {
		result.Rejected = rejected.Error()
		*g.rejections = append(*g.rejections, ProofRejection{GroupID: id, Accepted: result.Accepted, Message: result.Rejected})
		return result, nil
	}
	return result, rejected
}
func (g *Registry) applyOwnConsent(tx *groupstore.Tx, r *record, epoch *groups.GroupEpoch, snapshot *groups.GroupSnapshot) error {
	if r.Consent == nil || r.Head == nil {
		return nil
	}
	found := false
	for _, c := range snapshot.Joins {
		if c.ID == r.Consent.ID {
			found = true
		}
	}
	if !found {
		return nil
	}
	local := false
	for _, m := range snapshot.Members {
		h, err := groups.MemberCardHash(m)
		if err != nil {
			return err
		}
		if m.ID == g.identity.Public.ID && h == g.cardHash {
			local = true
		}
	}
	if !local {
		return errors.New("adesão sem cartão local")
	}
	parent, err := g.parent(tx, r, epoch)
	if err != nil {
		return err
	}
	if parent == nil {
		return errors.New("adesão sem antecessor")
	}
	if err = groups.VerifyConsent(*r.Consent, r.Anchor, *parent, g.identity.Public); err != nil {
		return err
	}
	for n := epoch.Body.Number; n <= r.Head.Body.Number; n++ {
		e, err := g.header(tx, r, n)
		if err != nil {
			return err
		}
		if !hasCard(e, g.identity.Public.ID, g.cardHash) {
			return nil
		}
	}
	r.Admitted = &admission{g.cardHash, epoch.ID}
	r.CheckedThrough = ptr(epoch.Body.Number)
	r.EverJoined = true
	r.Left = nil
	r.Invitation = nil
	r.InvitationParent = nil
	r.InvitationCard = nil
	r.Consent = nil
	return nil
}
func (g *Registry) advanceChecked(tx *groupstore.Tx, r *record) error {
	if r.Admitted == nil || r.CheckedThrough == nil || r.Head == nil {
		return nil
	}
	for n := *r.CheckedThrough + 1; n <= r.Head.Body.Number; n++ {
		e, err := g.header(tx, r, n)
		if err != nil {
			return err
		}
		if e == nil {
			return integrity(errors.New("cadeia protegida incompleta"))
		}
		snapshot, err := g.snapshot(tx, r, e)
		if err != nil {
			return err
		}
		if snapshot == nil {
			break
		}
		r.CheckedThrough = ptr(n)
		r.Label = ptr(snapshot.Title)
	}
	return nil
}
func (g *Registry) ObserveSnapshot(id, epochID string, snapshot groups.GroupSnapshot) (View, error) {
	var result View
	if !core.ValidAddress(epochID) {
		return result, errors.New("época inválida")
	}
	err := g.store.Update(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		if f := r.Frozen; f != nil && !(f.Reason == "capacity" && f.Resource == "snapshot" && f.Observed.ID == epochID) {
			return errors.New("grupo suspenso")
		}
		before, err := core.Canonical(r)
		if err != nil {
			return err
		}
		epoch, err := g.findEpoch(tx, r, epochID)
		if err != nil {
			return err
		}
		if epoch == nil {
			return errors.New("falta a época verificada")
		}
		if err = g.checkedSnapshot(tx, r, epoch, snapshot); err != nil {
			return err
		}
		if !hasCard(epoch, g.identity.Public.ID, g.cardHash) {
			return errors.New("estado privado não se destina ao cartão local")
		}
		if r.Admitted == nil && r.Consent == nil {
			return errors.New("não existe adesão local")
		}
		data, err := core.Canonical(snapshot)
		if err != nil {
			return err
		}
		key := snapshotKey(id, epoch.Body.SnapshotHash)
		stored, _, err := tx.Get(key)
		if err != nil {
			return err
		}
		if !bytes.Equal(stored, data) {
			if err = tx.Put(key, data, groupstore.Data); err != nil {
				if !errors.Is(err, groupstore.ErrCapacity) {
					return err
				}
				r.Frozen = &StopEvidence{Reason: "capacity", Resource: "snapshot", Observed: epoch}
				after, err := core.Canonical(r)
				if err != nil {
					return err
				}
				if !bytes.Equal(before, after) {
					if err = g.save(tx, r); err != nil {
						return err
					}
				}
				result, err = g.view(tx, r)
				return err
			}
		}
		r.Frozen = nil
		if err = g.applyOwnConsent(tx, r, epoch, &snapshot); err != nil {
			return err
		}
		if err = g.advanceChecked(tx, r); err != nil {
			return err
		}
		if r.Admitted != nil && r.Head != nil && r.Head.ID == epoch.ID && *r.CheckedThrough == r.Head.Body.Number {
			r.Label = ptr(snapshot.Title)
		}
		after, err := core.Canonical(r)
		if err != nil {
			return err
		}
		if !bytes.Equal(before, after) {
			if err = g.save(tx, r); err != nil {
				return err
			}
		}
		result, err = g.view(tx, r)
		return err
	})
	return result, err
}
func (g *Registry) ResumeCapacity(id string) (View, error) {
	var result View
	err := g.store.Update(func(tx *groupstore.Tx) error {
		r, err := g.record(tx, id)
		if err != nil {
			return err
		}
		if r.Frozen == nil || r.Frozen.Reason != "capacity" {
			return errors.New("não existe suspensão por capacidade")
		}
		if r.Frozen.Resource == "snapshot" {
			result, err = g.view(tx, r)
			return err
		}
		before, err := core.Canonical(r)
		if err != nil {
			return err
		}
		observed := *r.Frozen.Observed
		r.Frozen = nil
		if _, err = g.append(tx, r, observed); err != nil {
			return err
		}
		after, err := core.Canonical(r)
		if err != nil {
			return err
		}
		if !bytes.Equal(before, after) {
			if err = g.save(tx, r); err != nil {
				return err
			}
		}
		result, err = g.view(tx, r)
		return err
	})
	return result, err
}
