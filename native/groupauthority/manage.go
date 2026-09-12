package groupauthority

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sort"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func reserveGroup(tx *groupstore.Tx) error {
	keys, err := tx.Keys("group:")
	if err != nil {
		return err
	}
	return require(len(keys) < GroupLimit, "limite de 64 grupos lembrados; saídas e conflitos conservam a protecção")
}
func putValue(tx *groupstore.Tx, key string, value any) error {
	data, err := core.Canonical(value)
	if err != nil {
		return err
	}
	return tx.Put(key, data, groupstore.Data)
}
func (g *Registry) owner(r *record, expected string, checked bool) error {
	if r.Anchor.Body.Creator.ID != g.identity.Public.ID || r.Anchor.Body.Creator.SignKey != g.identity.Public.SignKey {
		return errors.New("só o criador pode alterar os membros")
	}
	if r.Frozen != nil || r.Head == nil || r.Head.Body.State != "open" || r.Head.ID != expected {
		return errors.New("grupo suspenso, encerrado ou época desactualizada")
	}
	if checked && (r.CheckedThrough == nil || *r.CheckedThrough != r.Head.Body.Number) {
		return errors.New("é necessário verificar todos os estados intermédios")
	}
	return nil
}
func (g *Registry) Create(id, title string) (Result, error) {
	return g.operation(id, "create", map[string]any{"title": title}, func(tx *groupstore.Tx) (Result, error) {
		if err := reserveGroup(tx); err != nil {
			return Result{}, err
		}
		created, err := groups.CreateGroup(g.identity, title)
		if err != nil {
			return Result{}, err
		}
		r := &record{Version: 1, Anchor: created.Anchor, Head: &created.Epoch, Label: ptr(created.Snapshot.Title), EverJoined: true, Admitted: &admission{g.cardHash, created.Epoch.ID}, CheckedThrough: ptr(0)}
		if err = putValue(tx, headerKey(r.Anchor.ID, 0), created.Epoch); err != nil {
			return Result{}, err
		}
		if err = putValue(tx, snapshotKey(r.Anchor.ID, created.Epoch.Body.SnapshotHash), created.Snapshot); err != nil {
			return Result{}, err
		}
		if err = g.save(tx, r); err != nil {
			return Result{}, err
		}
		return Result{r.Anchor.ID, ptr(created.Epoch.ID), nil}, nil
	})
}
func (g *Registry) Invite(id, groupID, expected string, invitee core.PublicIdentity) (Result, error) {
	cardHash, err := groups.MemberCardHash(invitee)
	if err != nil {
		return Result{}, err
	}
	return g.operation(id, "invite", map[string]any{"groupId": groupID, "expected": expected, "cardHash": cardHash}, func(tx *groupstore.Tx) (Result, error) {
		r, err := g.record(tx, groupID)
		if err != nil {
			return Result{}, err
		}
		if err = g.owner(r, expected, true); err != nil {
			return Result{}, err
		}
		if hasCard(r.Head, invitee.ID, cardHash) {
			return Result{}, errors.New("este cartão já faz parte da época")
		}
		invitation, err := groups.CreateInvitation(g.identity, r.Anchor, *r.Head, invitee)
		return Result{groupID, ptr(expected), invitation}, err
	})
}
func (g *Registry) RememberInvitation(id string, anchor groups.GroupAnchor, parent groups.GroupEpoch, invitation groups.GroupInvitation) (Result, error) {
	if err := groups.VerifyAnchor(anchor); err != nil {
		return Result{}, err
	}
	if err := groups.VerifyEpoch(parent, anchor); err != nil {
		return Result{}, err
	}
	if err := groups.VerifyInvitation(invitation, anchor, parent, g.identity.Public); err != nil {
		return Result{}, err
	}
	return g.operation(id, "remember-invitation", map[string]any{"groupId": anchor.ID, "invitationId": invitation.ID}, func(tx *groupstore.Tx) (Result, error) {
		_, exists, err := tx.Get(groupKey(anchor.ID))
		if err != nil {
			return Result{}, err
		}
		var r *record
		if exists {
			r, err = g.record(tx, anchor.ID)
			if err != nil {
				return Result{}, err
			}
		} else {
			if err = reserveGroup(tx); err != nil {
				return Result{}, err
			}
			r = &record{Version: 1, Anchor: anchor}
		}
		if r.Frozen != nil || (r.Head != nil && r.Head.Body.State == "closed") {
			return Result{}, errors.New("grupo suspenso ou encerrado")
		}
		r.Invitation = &invitation
		r.InvitationParent = &parent
		r.InvitationCard = ptr(g.identity.Public)
		r.Consent = nil
		if err = g.save(tx, r); err != nil {
			return Result{}, err
		}
		return Result{anchor.ID, ptr(parent.ID), invitation}, nil
	})
}
func (g *Registry) Accept(id, groupID, expected string) (Result, error) {
	return g.operation(id, "accept", map[string]any{"groupId": groupID, "expected": expected}, func(tx *groupstore.Tx) (Result, error) {
		r, err := g.record(tx, groupID)
		if err != nil {
			return Result{}, err
		}
		if r.Frozen != nil || r.Head == nil || r.Head.Body.State != "open" || r.Head.ID != expected || r.Invitation == nil {
			return Result{}, errors.New("faltam o convite ou a cadeia actual verificada")
		}
		if hasCard(r.Head, g.identity.Public.ID, g.cardHash) {
			return Result{}, errors.New("este cartão ainda pertence à época")
		}
		consent, err := groups.AcceptInvitation(g.identity, r.Anchor, *r.Head, *r.Invitation)
		if err != nil {
			return Result{}, err
		}
		r.Consent = &consent
		if err = g.save(tx, r); err != nil {
			return Result{}, err
		}
		return Result{groupID, ptr(expected), consent}, nil
	})
}
func (g *Registry) Commit(id, groupID, expected string, update groups.Update) (Result, error) {
	if len(update.Members) < 1 || len(update.Members) > groups.MemberLimit || update.Joins == nil || len(update.Joins) > groups.MemberLimit {
		return Result{}, errors.New("alteração de membros fora dos limites")
	}
	members := make([]string, 0, len(update.Members))
	joins := make([]string, 0, len(update.Joins))
	for _, member := range update.Members {
		h, err := groups.MemberCardHash(member)
		if err != nil {
			return Result{}, err
		}
		members = append(members, h)
	}
	for _, join := range update.Joins {
		joins = append(joins, join.ID)
	}
	sort.Strings(members)
	sort.Strings(joins)
	input := map[string]any{"groupId": groupID, "expected": expected, "title": update.Title, "members": members, "joins": joins}
	return g.operation(id, "commit", input, func(tx *groupstore.Tx) (Result, error) {
		r, err := g.record(tx, groupID)
		if err != nil {
			return Result{}, err
		}
		if err = g.owner(r, expected, true); err != nil {
			return Result{}, err
		}
		before, err := g.snapshot(tx, r, r.Head)
		if err != nil {
			return Result{}, err
		}
		if before == nil {
			return Result{}, errors.New("falta o estado privado da época actual")
		}
		next, err := groups.CreateSuccessor(g.identity, r.Anchor, *r.Head, *before, update)
		if err != nil {
			return Result{}, err
		}
		if _, err = g.append(tx, r, next.Epoch); err != nil {
			return Result{}, err
		}
		if r.Frozen != nil {
			return Result{}, errors.New("capacidade esgotada ao preparar a alteração local")
		}
		if err = putValue(tx, snapshotKey(groupID, next.Epoch.Body.SnapshotHash), next.Snapshot); err != nil {
			return Result{}, err
		}
		r.Label = ptr(next.Snapshot.Title)
		if err = g.applyOwnConsent(tx, r, &next.Epoch, &next.Snapshot); err != nil {
			return Result{}, err
		}
		if err = g.advanceChecked(tx, r); err != nil {
			return Result{}, err
		}
		if err = g.save(tx, r); err != nil {
			return Result{}, err
		}
		return Result{groupID, ptr(next.Epoch.ID), nil}, nil
	})
}
func (g *Registry) Close(id, groupID, expected string) (Result, error) {
	return g.operation(id, "close", map[string]any{"groupId": groupID, "expected": expected}, func(tx *groupstore.Tx) (Result, error) {
		r, err := g.record(tx, groupID)
		if err != nil {
			return Result{}, err
		}
		if err = g.owner(r, expected, false); err != nil {
			return Result{}, err
		}
		next, err := groups.CloseGroup(g.identity, r.Anchor, *r.Head)
		if err != nil {
			return Result{}, err
		}
		if _, err = g.append(tx, r, next); err != nil {
			return Result{}, err
		}
		if r.Frozen != nil {
			return Result{}, errors.New("capacidade esgotada ao encerrar")
		}
		if err = g.advanceChecked(tx, r); err != nil {
			return Result{}, err
		}
		if err = g.save(tx, r); err != nil {
			return Result{}, err
		}
		return Result{groupID, ptr(next.ID), nil}, nil
	})
}
func (g *Registry) Leave(id, groupID string) (Result, error) {
	return g.operation(id, "leave", map[string]any{"groupId": groupID}, func(tx *groupstore.Tx) (Result, error) {
		r, err := g.record(tx, groupID)
		if err != nil {
			return Result{}, err
		}
		if r.Anchor.Body.Creator.ID == g.identity.Public.ID {
			return Result{}, errors.New("o criador encerra o grupo")
		}
		if r.Left == nil {
			r.Left = &leftFence{}
			if r.Head != nil {
				r.Left.EpochID = ptr(r.Head.ID)
			}
			if r.Head != nil && r.Head.Body.State == "open" && hasCard(r.Head, g.identity.Public.ID, g.cardHash) {
				leave, err := groups.CreateLeave(g.identity, r.Anchor, *r.Head)
				if err != nil {
					return Result{}, err
				}
				r.Left.Request = &leave
				r.Left.Nonce = leave.Body.LeaveNonce
				r.Left.Card = ptr(g.identity.Public)
			} else {
				nonce := make([]byte, 32)
				if _, err = rand.Read(nonce); err != nil {
					return Result{}, err
				}
				r.Left.Nonce = base64.StdEncoding.EncodeToString(nonce)
			}
		}
		r.Admitted = nil
		r.CheckedThrough = nil
		r.Invitation = nil
		r.InvitationParent = nil
		r.InvitationCard = nil
		r.Consent = nil
		if err = g.save(tx, r); err != nil {
			return Result{}, err
		}
		var cert any
		if r.Left.Request != nil {
			cert = *r.Left.Request
		}
		return Result{groupID, r.Left.EpochID, cert}, nil
	})
}
