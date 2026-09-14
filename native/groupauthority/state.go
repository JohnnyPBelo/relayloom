package groupauthority

import (
	"bytes"
	"encoding/base64"
	"errors"
	"unicode/utf8"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func (g *Registry) header(tx *groupstore.Tx, r *record, number int) (*groups.GroupEpoch, error) {
	data, exists, err := tx.Get(headerKey(r.Anchor.ID, number))
	if err != nil {
		return nil, err
	}
	if !exists {
		if r.Head != nil && r.Head.Body.State == "closed" && r.Head.Body.Number == number {
			return r.Head, nil
		}
		return nil, nil
	}
	epoch, err := groups.DecodeEpoch(data, r.Anchor)
	if err != nil {
		return nil, integrity(err)
	}
	encoded, err := core.Canonical(epoch)
	if err != nil || epoch.Body.Number != number || !bytes.Equal(encoded, data) {
		return nil, integrity(errors.New("cabeçalho armazenado inválido"))
	}
	return &epoch, nil
}
func (g *Registry) parent(tx *groupstore.Tx, r *record, epoch *groups.GroupEpoch) (*groups.GroupEpoch, error) {
	if epoch.Body.Number == 0 {
		return nil, nil
	}
	parent, err := g.header(tx, r, epoch.Body.Number-1)
	if err != nil {
		return nil, err
	}
	if parent == nil || epoch.Body.Previous == nil || parent.ID != *epoch.Body.Previous {
		return nil, errors.New("falta o antecessor verificado")
	}
	_, err = groups.VerifyEpochLink(r.Anchor, *parent, *epoch)
	return parent, err
}
func (g *Registry) checkedSnapshot(tx *groupstore.Tx, r *record, epoch *groups.GroupEpoch, snapshot groups.GroupSnapshot) error {
	if err := groups.VerifySnapshot(snapshot, r.Anchor, *epoch); err != nil {
		return err
	}
	parent, err := g.parent(tx, r, epoch)
	if err != nil {
		return err
	}
	if parent != nil {
		_, err = groups.VerifySnapshotTransition(r.Anchor, *parent, *epoch, snapshot)
	}
	return err
}
func (g *Registry) snapshot(tx *groupstore.Tx, r *record, epoch *groups.GroupEpoch) (*groups.GroupSnapshot, error) {
	data, exists, err := tx.Get(snapshotKey(r.Anchor.ID, epoch.Body.SnapshotHash))
	if err != nil || !exists {
		return nil, err
	}
	snapshot, err := groups.DecodeSnapshot(data, r.Anchor, *epoch)
	if err == nil {
		err = g.checkedSnapshot(tx, r, epoch, snapshot)
	}
	if err != nil {
		return nil, integrity(err)
	}
	encoded, err := core.Canonical(snapshot)
	if err != nil || !bytes.Equal(encoded, data) {
		return nil, integrity(errors.New("estado privado não canónico"))
	}
	return &snapshot, nil
}
func (g *Registry) findEpoch(tx *groupstore.Tx, r *record, id string) (*groups.GroupEpoch, error) {
	for n := 0; r.Head != nil && n <= r.Head.Body.Number; n++ {
		e, err := g.header(tx, r, n)
		if err != nil {
			return nil, err
		}
		if e != nil && e.ID == id {
			return e, nil
		}
	}
	return nil, nil
}
func textLength(value string) int {
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
func (g *Registry) record(tx *groupstore.Tx, id string) (*record, error) {
	if !core.ValidAddress(id) {
		return nil, errors.New("identificador de grupo inválido")
	}
	cache := g.verifiedRecords
	if cache != nil {
		generation, err := g.ScopeGeneration()
		if err != nil {
			return nil, err
		}
		if cache.generation != generation {
			cache.values = make(map[string]*record)
			cache.order = nil
			cache.generation = generation
		}
		if saved := cache.values[id]; saved != nil {
			return cloneAuthorityRecord(saved), nil
		}
	}
	data, exists, err := tx.Get(groupKey(id))
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("grupo não está registado localmente")
	}
	r, err := decodeRecord(data)
	if err != nil {
		return nil, integrity(err)
	}
	if err = g.validateRecord(tx, r, id); err != nil {
		return nil, integrity(err)
	}
	if cache != nil && len(data) <= CheckpointBytes {
		cache.remember(id, r)
	}
	return r, nil
}
func (g *Registry) validateRecord(tx *groupstore.Tx, r *record, id string) error {
	if r.Version != 1 || r.Anchor.ID != id || (r.Label != nil && textLength(*r.Label) > 256) {
		return errors.New("checkpoint inválido")
	}
	if r.Head != nil {
		if err := groups.VerifyEpoch(*r.Head, r.Anchor); err != nil {
			return err
		}
		e, err := g.header(tx, r, r.Head.Body.Number)
		if err != nil {
			return err
		}
		if e == nil || e.ID != r.Head.ID {
			return errors.New("cabeça sem prova retida")
		}
		if r.Head.Body.State == "closed" {
			if _, err = g.parent(tx, r, r.Head); err != nil {
				return err
			}
		}
	}
	if r.Admitted != nil {
		if !core.ValidAddress(r.Admitted.CardHash) || !core.ValidAddress(r.Admitted.EpochID) || !r.EverJoined || r.Head == nil || r.CheckedThrough == nil || *r.CheckedThrough < 0 || *r.CheckedThrough > r.Head.Body.Number {
			return errors.New("admissão ou cursor inválido")
		}
		checked, err := g.header(tx, r, *r.CheckedThrough)
		if err != nil {
			return err
		}
		if !hasCard(checked, g.identity.Public.ID, r.Admitted.CardHash) {
			return errors.New("cursor sem cartão admitido")
		}
		snapshot, err := g.snapshot(tx, r, checked)
		if err != nil {
			return err
		}
		if snapshot == nil {
			return errors.New("cursor sem estado privado")
		}
	} else if r.CheckedThrough != nil {
		return errors.New("cursor sem admissão")
	}
	if r.Invitation != nil {
		if r.InvitationCard == nil || r.InvitationCard.ID != g.identity.Public.ID || r.InvitationParent == nil {
			return errors.New("convite sem cartão ou antecessor")
		}
		if err := groups.VerifyInvitation(*r.Invitation, r.Anchor, *r.InvitationParent, *r.InvitationCard); err != nil {
			return err
		}
	} else if r.InvitationCard != nil || r.InvitationParent != nil {
		return errors.New("referências sem convite")
	}
	if r.Consent != nil {
		if r.Invitation == nil || r.Consent.Body.InvitationHash != r.Invitation.ID {
			return errors.New("consentimento sem convite")
		}
		if err := groups.VerifyConsent(*r.Consent, r.Anchor, *r.InvitationParent, *r.InvitationCard); err != nil {
			return err
		}
	}
	if r.Left != nil {
		nonce, err := base64.StdEncoding.Strict().DecodeString(r.Left.Nonce)
		if err != nil || len(nonce) != 32 || base64.StdEncoding.EncodeToString(nonce) != r.Left.Nonce || (r.Left.EpochID != nil && !core.ValidAddress(*r.Left.EpochID)) || r.Admitted != nil {
			return errors.New("saída inválida")
		}
		if r.Left.Request != nil {
			if r.Left.EpochID == nil || r.Left.Card == nil || r.Left.Card.ID != g.identity.Public.ID || r.Left.Request.Body.LeaveNonce != r.Left.Nonce {
				return errors.New("prova de saída incoerente")
			}
			parent, err := g.findEpoch(tx, r, *r.Left.EpochID)
			if err != nil {
				return err
			}
			if parent == nil {
				return errors.New("saída sem época")
			}
			if err = groups.VerifyLeave(*r.Left.Request, r.Anchor, *parent, *r.Left.Card); err != nil {
				return err
			}
		} else if r.Left.Card != nil {
			return errors.New("cartão sem saída")
		}
	}
	if f := r.Frozen; f != nil {
		switch f.Reason {
		case "forked":
			if f.First == nil || f.Second == nil || f.Resource != "" || f.Observed != nil {
				return errors.New("campos de conflito inválidos")
			}
			if err := groups.VerifyEpoch(*f.First, r.Anchor); err != nil {
				return err
			}
			if err := groups.VerifyEpoch(*f.Second, r.Anchor); err != nil {
				return err
			}
			if f.First.ID == f.Second.ID || f.First.Body.Number != f.Second.Body.Number || !same(f.First.Body.Previous, f.Second.Body.Previous) {
				return errors.New("prova de conflito inválida")
			}
		case "capacity":
			if r.Head == nil || f.Observed == nil || f.First != nil || f.Second != nil {
				return errors.New("campos de capacidade inválidos")
			}
			switch f.Resource {
			case "header":
				_, err := groups.VerifyEpochLink(r.Anchor, *r.Head, *f.Observed)
				if err != nil {
					return err
				}
			case "snapshot":
				if err := groups.VerifyEpoch(*f.Observed, r.Anchor); err != nil {
					return err
				}
				e, err := g.header(tx, r, f.Observed.Body.Number)
				if err != nil {
					return err
				}
				if e == nil || e.ID != f.Observed.ID {
					return errors.New("suspensão sem época retida")
				}
			default:
				return errors.New("recurso de capacidade inválido")
			}
		default:
			return errors.New("suspensão inválida")
		}
	}
	return nil
}
func (g *Registry) view(tx *groupstore.Tx, r *record) (View, error) {
	v := View{ID: r.Anchor.ID, Creator: r.Anchor.Body.Creator, Title: r.Label, Head: r.Head, LocallyLeft: r.Left != nil, StopEvidence: []EvidenceID{}}
	if r.Consent != nil {
		v.PendingConsent = ptr(r.Consent.ID)
	}
	switch {
	case r.Frozen != nil:
		v.Status = r.Frozen.Reason
	case r.Head != nil && r.Head.Body.State == "closed":
		v.Status = "closed"
	case r.Left != nil:
		v.Status = "left"
	case r.Head == nil:
		v.Status = "awaiting-proof"
	case r.Admitted == nil:
		v.Status = "removed"
		if r.Consent != nil || !r.EverJoined {
			v.Status = "joining"
		}
	case r.Admitted.CardHash != g.cardHash:
		v.Status = "card-changed"
	default:
		v.Status = "awaiting-snapshot"
		if *r.CheckedThrough == r.Head.Body.Number {
			snapshot, err := g.snapshot(tx, r, r.Head)
			if err != nil {
				return v, err
			}
			if snapshot != nil {
				v.Status = "active"
			}
		}
	}
	if f := r.Frozen; f != nil {
		for _, e := range []*groups.GroupEpoch{f.First, f.Second, f.Observed} {
			if e != nil {
				v.StopEvidence = append(v.StopEvidence, EvidenceID{e.ID, e.Body.Number})
			}
		}
	}
	return v, nil
}
