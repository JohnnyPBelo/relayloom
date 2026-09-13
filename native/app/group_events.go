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
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func currentGroupEvent(kind string) bool {
	return kind == "edit" || kind == "reaction" || kind == "comment"
}

// Original verified bytes plus a durable local admission determine the target;
// caller-provided summaries, keys and contacts cannot grant signing authority.
func (n *Node) commitGroupEventLocked(input Content, recipients any, ttl int64) (core.Bundle, error) {
	var bundle core.Bundle
	if ttl != 0 && (ttl < 1000 || ttl > core.MaxTTL) {
		return bundle, errors.New("prazo inválido")
	}
	if err := validateContent(input); err != nil {
		return bundle, err
	}
	binding, err := groupaccess.ParseBinding(input)
	if err != nil {
		return bundle, err
	}
	kind := text(input["type"])
	if (!currentGroupEvent(kind) && kind != "delete") || text(recipients) == "public" {
		return bundle, errors.New("evento privado de grupo inválido")
	}
	requested, err := stringsList(recipients, 64, true)
	if err != nil {
		return bundle, err
	}
	requested = append(requested, n.identity.Public.ID)
	historical := kind == "delete"
	expectedAudience := "target"
	if historical {
		expectedAudience = "historical"
	}
	if binding.Audience != expectedAudience {
		return bundle, errors.New("audiência de evento inválida")
	}
	fields := []string{"type", "target", "conversation", "targetEpoch", "groupAudience"}
	if !historical {
		fields = append(fields, "groupEpoch")
		if kind == "reaction" {
			fields = append(fields, "emoji", "value")
		} else {
			fields = append(fields, "text")
		}
	}
	for field := range input {
		if !contains(fields, field) {
			return bundle, errors.New("campos do evento de grupo inválidos")
		}
	}
	if !historical && kind != "reaction" && trimmed(text(input["text"])) == "" {
		return bundle, errors.New("texto do evento inválido")
	}
	if kind == "reaction" {
		if _, ok := input["value"].(bool); !ok || trimmed(text(input["emoji"])) == "" {
			return bundle, errors.New("reacção inválida")
		}
	}
	original, err := n.Store.GetWithTouch(text(input["target"]), false)
	if err != nil {
		return bundle, err
	}
	targetObject, err := n.displayLocked(original)
	if err != nil {
		return bundle, err
	}
	targetBinding, err := groupaccess.ParseBinding(targetObject.Content)
	if err != nil {
		return bundle, err
	}
	if targetObject.Public || targetObject.Kind != "message" || targetBinding.Conversation != binding.Conversation || targetBinding.Epoch != binding.TargetEpoch || !contains(targetObject.Readers, n.identity.Public.ID) || ((historical || kind == "edit") && targetObject.Author.ID != n.identity.Public.ID) {
		return bundle, errors.New("sem autoridade para alterar este alvo de grupo")
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
			return errors.New("o estado privado mudou antes do evento")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, g *groupauthority.Registry) error {
			target, err := l.Accepted(original.Manifest.ID)
			if err != nil {
				return err
			}
			if target == nil || target.Context.Kind != "message" || target.Context.Author != targetObject.Author.ID || target.Context.GroupID != binding.Conversation || target.Context.EpochID != binding.TargetEpoch || target.Expires != targetObject.Expires || !equalIDs(target.Context.Readers, targetObject.Readers) {
				return errors.New("o evento exige um alvo localmente admitido")
			}
			epoch := binding.Epoch
			if historical {
				epoch = binding.TargetEpoch
			} else {
				state, err := g.State(binding.Conversation)
				if err != nil {
					return err
				}
				if state.Status != "active" || state.Head == nil || state.Head.ID != epoch {
					return errors.New("o grupo mudou; reveja a audiência antes de publicar")
				}
			}
			snapshot, err := g.PrivateState(binding.Conversation, epoch)
			if err != nil {
				return err
			}
			if snapshot == nil {
				return errors.New("falta confirmar o estado privado do grupo")
			}
			cards := []core.PublicIdentity{}
			for _, card := range snapshot.Members {
				if contains(targetObject.Readers, card.ID) {
					cards = append(cards, card)
				}
			}
			ids := memberIDs(cards)
			unique := []string{}
			for _, id := range requested {
				if !contains(unique, id) {
					unique = append(unique, id)
				}
			}
			if !contains(ids, n.identity.Public.ID) || !equalIDs(ids, unique) {
				return errors.New("destinatários diferentes da audiência autorizada")
			}
			for _, id := range ids {
				if contains(n.config.Blocked, id) {
					return errors.New("há um destinatário bloqueado")
				}
			}
			remaining := targetObject.Expires - time.Now().UnixMilli()
			if remaining <= 0 {
				return errors.New("o conteúdo original expirou")
			}
			if ttl == 0 {
				ttl = remaining
			}
			bundle, err = core.CreateBundle(*n.identity, kind, input, cards, false, max(1000, min(ttl, remaining)))
			if err != nil {
				return err
			}
			if err = core.VerifyBundle(bundle); err != nil {
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
			if err = validateContent(Content(verified)); err != nil {
				return err
			}
			a, err := core.Canonical(input)
			if err != nil {
				return err
			}
			b, err := core.Canonical(verified)
			if err != nil {
				return err
			}
			if !bytes.Equal(a, b) {
				return errors.New("evento assinado incoerente")
			}
			encoded, err := core.Canonical(bundle)
			if err != nil {
				return err
			}
			result, err := l.Consider(groupaccess.Candidate{ID: bundle.Manifest.ID, Kind: kind, Author: n.identity.Public, Readers: ids, Content: verified}, bundle.Manifest.Expires, int64(len(encoded)), protected, time.Now().UnixMilli())
			if err != nil {
				return err
			}
			if result.Decision.Status != "accepted" {
				return errors.New("autoridade do evento não confirmada")
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

func (n *Node) publishGroupEventLocked(content Content, recipients any, ttl int64) (DisplayObject, error) {
	if n.identity == nil || n.privateDatabase == nil {
		return DisplayObject{}, errors.New("desbloqueie a identidade")
	}
	if _, err := n.objectsLocked(); err != nil {
		return DisplayObject{}, err
	}
	bundle, err := n.commitGroupEventLocked(content, recipients, ttl)
	if err != nil {
		return DisplayObject{}, err
	}
	if _, err = n.Store.Put(bundle, false); err != nil {
		return DisplayObject{}, err
	}
	accepted, err := n.observeGroupLocked(bundle.Manifest.ID, n.protectedGroupContentLocked())
	if err != nil {
		return DisplayObject{}, err
	}
	if !accepted {
		return DisplayObject{}, errors.New("o evento não pôde ser admitido")
	}
	if err = n.reconcileGroupSendsLocked(); err != nil {
		return DisplayObject{}, err
	}
	allowed, err := n.maySeedLocked(bundle.Manifest)
	if err != nil {
		return DisplayObject{}, err
	}
	if !allowed {
		return DisplayObject{}, errors.New("o grupo já não autoriza este evento")
	}
	if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Normal, 2*time.Minute, false); err != nil {
		return DisplayObject{}, err
	}
	result, err := n.displayLocked(bundle)
	if err != nil {
		return DisplayObject{}, err
	}
	return *result, nil
}

func (n *Node) localGroupEventsLocked(manifests map[string]core.Manifest) []DisplayObject {
	events := []DisplayObject{}
	for _, manifest := range manifests {
		if manifest.Author.ID != n.identity.Public.ID || manifest.PublicKey != nil || !currentGroupEvent(manifest.Kind) {
			continue
		}
		bundle, err := n.Store.GetWithTouch(manifest.ID, false)
		if err != nil {
			continue
		}
		value, err := n.displayLocked(bundle)
		if err != nil || !groupaccess.HasBinding(value.Content) {
			continue
		}
		if _, err = groupaccess.ParseBinding(value.Content); err != nil {
			continue
		}
		events = append(events, *value)
	}
	return events
}

func eventSeeds(l *groupledger.Ledger, events []DisplayObject, blocked []string, access *groupaccess.Access) (map[string]bool, error) {
	allowed := map[string]bool{}
	for _, event := range events {
		accepted, err := l.Accepted(event.ID)
		if err != nil {
			return nil, err
		}
		if accepted == nil || accepted.Context.Kind != event.Kind || accepted.Context.Author != event.Author.ID || accepted.Context.GroupID != text(event.Content["conversation"]) || accepted.Context.EpochID != text(event.Content["groupEpoch"]) || accepted.Expires != event.Expires || !equalIDs(accepted.Context.Readers, event.Readers) {
			continue
		}
		deny := false
		for _, id := range event.Readers {
			if contains(blocked, id) {
				deny = true
			}
		}
		if deny {
			continue
		}
		target, err := l.Accepted(text(event.Content["target"]))
		if err != nil {
			return nil, err
		}
		var targetContext *groupaccess.AcceptedContext
		if target != nil {
			targetContext = &target.Context
		}
		decision, err := access.Decide(groupaccess.Candidate{ID: event.ID, Kind: event.Kind, Author: event.Author, Readers: event.Readers, Content: event.Content}, &accepted.Context, targetContext)
		if err != nil {
			return nil, err
		}
		if decision.Status != "accepted" {
			continue
		}
		authority, err := l.RetryAuthority(accepted.Context.GroupID, accepted.Context.EpochID)
		if err != nil {
			return nil, err
		}
		if authority.Allowed {
			allowed[event.ID] = true
		}
	}
	return allowed, nil
}
