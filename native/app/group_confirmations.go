package app

import (
	"bytes"
	"errors"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

// Minimal historical facts use verified original bytes and local admission,
// never HTTP-provided contexts or global contacts. Commit precedes transmission.
func (n *Node) commitGroupConfirmationLocked(id, kind string) (core.Bundle, error) {
	var bundle core.Bundle
	if n.identity == nil || (kind != "delivery" && kind != "receipt") {
		return bundle, errors.New("confirmação inválida")
	}
	original, err := n.Store.GetWithTouch(id, false)
	if err != nil {
		return bundle, err
	}
	message, err := n.displayLocked(original)
	if err != nil {
		return bundle, err
	}
	binding, err := groupaccess.ParseBinding(message.Content)
	if err != nil {
		return bundle, err
	}
	if message.Kind != "message" || binding.Epoch == "" || message.Public || message.Author.ID == n.identity.Public.ID || !contains(message.Readers, n.identity.Public.ID) {
		return bundle, errors.New("esta mensagem não pode ser confirmada por esta identidade")
	}
	for _, reader := range message.Readers {
		if contains(n.config.Blocked, reader) {
			return bundle, errors.New("destinatário bloqueado")
		}
	}
	cards, err := members(message.Content["members"])
	if err != nil || !equalIDs(memberIDs(cards), message.Readers) {
		return bundle, errors.New("cartões da confirmação não correspondem ao original")
	}
	protected := n.protectedGroupContentLocked()
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
			return errors.New("o estado privado mudou antes da confirmação")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, _ *groupauthority.Registry) error {
			target, err := l.Accepted(id)
			if err != nil {
				return err
			}
			if target == nil || target.Context.Kind != "message" || target.Context.Author != message.Author.ID || target.Context.GroupID != binding.Conversation || target.Context.EpochID != binding.Epoch || target.Expires != message.Expires || !equalIDs(target.Context.Readers, message.Readers) {
				return errors.New("a confirmação exige uma mensagem localmente admitida")
			}
			content := Content{"type": kind, "target": id, "conversation": binding.Conversation, "targetEpoch": binding.Epoch, "groupAudience": "historical"}
			bundle, err = core.CreateBundle(*n.identity, kind, content, cards, false, max(1000, message.Expires-time.Now().UnixMilli()))
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
				return errors.New("confirmação assinada incoerente")
			}
			encoded, err := core.Canonical(bundle)
			if err != nil {
				return err
			}
			result, err := l.Consider(groupaccess.Candidate{ID: bundle.Manifest.ID, Kind: kind, Author: bundle.Manifest.Author, Readers: message.Readers, Content: verified}, bundle.Manifest.Expires, int64(len(encoded)), protected, time.Now().UnixMilli())
			if err != nil {
				return err
			}
			if result.Decision.Status != "accepted" {
				return errors.New("falta confirmar a autoridade histórica do grupo")
			}
			return nil
		})
		return err
	})
	if err != nil {
		n.recoverGroupContentLocked()
	}
	return bundle, err
}
