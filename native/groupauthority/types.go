// Package groupauthority owns durable membership metadata. It does not by itself
// admit application content or make a separate outbox journal transactional.
package groupauthority

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

const (
	GroupLimit      = 64
	OperationLimit  = 256
	PageLimit       = 16
	PageBytes       = 256 * 1024
	CheckpointBytes = 52 * 1024
	OperationBytes  = 2 * 1024
)

type StopEvidence struct {
	Reason   string             `json:"reason"`
	Resource string             `json:"resource,omitempty"`
	Observed *groups.GroupEpoch `json:"observed,omitempty"`
	First    *groups.GroupEpoch `json:"first,omitempty"`
	Second   *groups.GroupEpoch `json:"second,omitempty"`
}
type admission struct {
	CardHash string `json:"cardHash"`
	EpochID  string `json:"epochId"`
}
type leftFence struct {
	EpochID *string              `json:"epochId"`
	Nonce   string               `json:"nonce"`
	Request *groups.GroupLeave   `json:"request"`
	Card    *core.PublicIdentity `json:"card"`
}
type record struct {
	Version          int                     `json:"version"`
	Anchor           groups.GroupAnchor      `json:"anchor"`
	Head             *groups.GroupEpoch      `json:"head"`
	Label            *string                 `json:"label"`
	EverJoined       bool                    `json:"everJoined"`
	Admitted         *admission              `json:"admitted"`
	CheckedThrough   *int                    `json:"checkedThrough"`
	Invitation       *groups.GroupInvitation `json:"invitation"`
	InvitationParent *groups.GroupEpoch      `json:"invitationParent"`
	InvitationCard   *core.PublicIdentity    `json:"invitationCard"`
	Consent          *groups.GroupConsent    `json:"consent"`
	Left             *leftFence              `json:"left"`
	Frozen           *StopEvidence           `json:"frozen"`
}
type EvidenceID struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
}
type View struct {
	ID             string              `json:"id"`
	Creator        core.PublicIdentity `json:"creator"`
	Title          *string             `json:"title"`
	Head           *groups.GroupEpoch  `json:"head"`
	Status         string              `json:"status"`
	PendingConsent *string             `json:"pendingConsent"`
	LocallyLeft    bool                `json:"locallyLeft"`
	StopEvidence   []EvidenceID        `json:"stopEvidence"`
}
type Registry struct {
	rejections *[]ProofRejection
	store      authorityStore
	identity   core.Identity
	cardHash   string
}
type authorityStore interface {
	View(func(*groupstore.Tx) error) error
	Update(func(*groupstore.Tx) error) error
}

func New(store *groupstore.Store, identity core.Identity) (*Registry, error) {
	return newRegistry(store, identity)
}
func newRegistry(store authorityStore, identity core.Identity) (*Registry, error) {
	cardHash, err := groups.MemberCardHash(identity.Public)
	if err != nil {
		return nil, err
	}
	err = store.View(func(tx *groupstore.Tx) error {
		owner, err := tx.Owner()
		if err != nil {
			return err
		}
		a, err := tx.Accounting()
		if err != nil {
			return err
		}
		if owner != identity.Public.ID || a.ReserveBytes != 4*1024*1024 {
			return errors.New("identidade ou reserva de autoridade inválida")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &Registry{store: store, identity: identity, cardHash: cardHash}, nil
}
func groupKey(id string) string              { return "group:" + id }
func headerKey(id string, number int) string { return fmt.Sprintf("epoch:%s:%04d", id, number) }
func snapshotKey(id, digest string) string   { return "snapshot:" + id + ":" + digest }
func integrity(err error) error {
	return fmt.Errorf("%w: autoridade: %v", groupstore.ErrIntegrity, err)
}
func require(ok bool, message string) error {
	if !ok {
		return errors.New(message)
	}
	return nil
}
func same(a, b any) bool {
	aa, e := core.Canonical(a)
	bb, f := core.Canonical(b)
	return e == nil && f == nil && bytes.Equal(aa, bb)
}
func ptr[T any](v T) *T { return &v }
func hasCard(e *groups.GroupEpoch, id, cardHash string) bool {
	if e != nil {
		for _, m := range e.Body.Members {
			if m.ID == id && m.CardHash == cardHash {
				return true
			}
		}
	}
	return false
}

// Decode through the bounded canonical parser before typed JSON. Fields holding
// arbitrary Unicode are restored via that parser, preserving its UTF-16 rules.
func decodeRecord(data []byte) (*record, error) {
	value, err := core.DecodeJSON(data, CheckpointBytes)
	if err != nil {
		return nil, err
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("checkpoint inválido")
	}
	var r record
	if err = json.Unmarshal(data, &r); err != nil {
		return nil, err
	}
	if title, ok := m["label"].(string); ok {
		r.Label = &title
	}
	raw, err := core.Canonical(m["anchor"])
	if err != nil {
		return nil, err
	}
	r.Anchor, err = groups.DecodeAnchor(raw)
	if err != nil {
		return nil, err
	}
	card := func(value any) (*core.PublicIdentity, error) {
		if value == nil {
			return nil, nil
		}
		b, e := core.Canonical(value)
		if e != nil {
			return nil, e
		}
		c, e := core.DecodePublicIdentity(b)
		return &c, e
	}
	r.InvitationCard, err = card(m["invitationCard"])
	if err != nil {
		return nil, err
	}
	if r.Left != nil {
		lm, ok := m["left"].(map[string]any)
		if !ok {
			return nil, errors.New("saída inválida")
		}
		r.Left.Card, err = card(lm["card"])
		if err != nil {
			return nil, err
		}
	}
	encoded, err := core.Canonical(r)
	if err != nil || !bytes.Equal(encoded, data) {
		return nil, errors.New("campos ou codificação do checkpoint inválidos")
	}
	return &r, nil
}
