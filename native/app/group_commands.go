package app

import (
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

// Called with the application mutex held. No result or network side effect
// escapes before the outer profile transaction commits. This is management;
// dynamic message admission and control-carrier synchronization follow separately.
func (n *Node) groupCommandLocked(body map[string]any) (any, error) {
	if n.identity == nil || n.privateDatabase == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	if !contains([]string{"list", "state", "operation", "proofs", "private-state", "headers", "snapshot", "remember", "leave"}, text(body["action"])) {
		if err := n.requireGroupReplayLocked(); err != nil {
			return nil, err
		}
	}
	update := n.updateGroupState
	if update == nil {
		update = n.privateDatabase.Update
	}
	var result any
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	var decisions map[string]groupRetry
	err = update(func(tx *groupstore.Tx) error {
		current, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if current == nil || current.Digest != n.privateDigest {
			return errors.New("o estado privado mudou; volte a lê-lo antes de gerir o grupo")
		}
		_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, g *groupauthority.Registry) error {
			var err error
			result, err = executeGroupCommand(g, n.identity.Public, body)
			if err != nil {
				return err
			}
			decisions, err = reconcileGroupOutbox(l, next.Outbox)
			return err
		})
		return err
	})
	if err != nil {
		// A failed response can follow a successful SQL commit. Recover through
		// the signed binding, never by restoring an earlier private JSON file.
		identity := *n.identity
		_ = n.privateDatabase.Close()
		database, recovered, digest, readErr := openPrivateProfile(n.Dir, identity)
		if readErr == nil {
			n.privateDatabase, n.private, n.privateDigest = database, recovered, digest
			if err := n.restoreGroupHoldsLocked(); err != nil {
				_ = n.lockPrivateLocked()
			}
		} else {
			_ = n.lockPrivateLocked()
		}
		return nil, err
	}
	n.private, n.groupRetries = next, decisions
	if err := n.restoreGroupHoldsLocked(); err != nil {
		n.recoverGroupContentLocked()
		return nil, err
	}
	n.groupSync.record(body, result)
	return result, nil
}

func executeGroupCommand(g *groupauthority.Registry, identity core.PublicIdentity, body map[string]any) (any, error) {
	action, err := fieldString(body, "action")
	if err != nil {
		return nil, err
	}
	id, operation, expected := text(body["groupId"]), text(body["operationId"]), text(body["expected"])
	var result groupauthority.Result
	switch action {
	case "list":
		list, err := g.List()
		return map[string]any{"groups": list, "limits": map[string]int{"groups": groupauthority.GroupLimit, "operations": groupauthority.OperationLimit}, "management": true, "messaging": false}, err
	case "state":
		state, err := g.State(id)
		return map[string]any{"group": state}, err
	case "operation":
		status, err := g.OperationStatus(operation)
		return map[string]any{"operation": status}, err
	case "create":
		title, err := fieldString(body, "title")
		if err != nil {
			return nil, err
		}
		result, err = g.Create(operation, title)
		if err != nil {
			return nil, err
		}
	case "invite":
		card, err := publicIdentity(body["card"])
		if err != nil {
			return nil, err
		}
		result, err = g.Invite(operation, id, expected, card)
		if err != nil {
			return nil, err
		}
	case "remember":
		raw, err := core.Canonical(body["anchor"])
		if err != nil {
			return nil, err
		}
		anchor, err := groups.DecodeAnchor(raw)
		if err != nil {
			return nil, err
		}
		raw, err = core.Canonical(body["parent"])
		if err != nil {
			return nil, err
		}
		parent, err := groups.DecodeEpoch(raw, anchor)
		if err != nil {
			return nil, err
		}
		raw, err = core.Canonical(body["invitation"])
		if err != nil {
			return nil, err
		}
		invitation, err := groups.DecodeInvitation(raw, anchor, parent, identity)
		if err != nil {
			return nil, err
		}
		result, err = g.RememberInvitation(operation, anchor, parent, invitation)
		if err != nil {
			return nil, err
		}
	case "accept":
		result, err = g.Accept(operation, id, expected)
	case "commit":
		var update groups.Update
		update, err = parseGroupUpdate(body)
		if err == nil {
			result, err = g.Commit(operation, id, expected, update)
		}
	case "close":
		result, err = g.Close(operation, id, expected)
	case "leave":
		result, err = g.Leave(operation, id)
	case "headers":
		raw, err := core.Canonical(body["headers"])
		if err != nil {
			return nil, err
		}
		observed, err := g.ObserveRawHeaders(id, raw)
		return map[string]any{"observation": observed}, err
	case "snapshot":
		raw, err := core.Canonical(body["snapshot"])
		if err != nil {
			return nil, err
		}
		snapshot, err := groups.ParseSnapshot(raw)
		if err != nil {
			return nil, err
		}
		state, err := g.ObserveSnapshot(id, text(body["epochId"]), snapshot)
		return map[string]any{"group": state}, err
	case "resume":
		state, err := g.ResumeCapacity(id)
		return map[string]any{"group": state}, err
	case "proofs":
		from, err := number(body["from"])
		if err != nil || from < 0 || from >= groups.EpochLimit {
			return nil, errors.New("pedido de provas fora dos limites")
		}
		count := int64(groupauthority.PageLimit)
		if value, exists := body["count"]; exists {
			count, err = number(value)
			if err != nil || count < 1 || count > groupauthority.PageLimit {
				return nil, errors.New("pedido de provas fora dos limites")
			}
		}
		anchor, err := g.Anchor(id)
		if err != nil {
			return nil, err
		}
		headers, err := g.Proofs(id, int(from), int(count))
		return map[string]any{"anchor": anchor, "headers": headers}, err
	case "private-state":
		snapshot, err := g.PrivateState(id, text(body["epochId"]))
		return map[string]any{"snapshot": snapshot}, err
	default:
		return nil, errors.New("acção de grupo desconhecida")
	}
	if err != nil {
		return nil, err
	}
	state, err := g.State(result.GroupID)
	return map[string]any{"operation": result, "group": state}, err
}

func parseGroupUpdate(body map[string]any) (groups.Update, error) {
	var result groups.Update
	title, err := fieldString(body, "title")
	if err != nil {
		return result, err
	}
	roster, err := members(body["members"])
	if err != nil {
		return result, err
	}
	items, ok := body["joins"].([]any)
	if !ok || len(items) > groups.MemberLimit {
		return result, errors.New("consentimentos fora dos limites")
	}
	joins := make([]groups.GroupConsent, 0, len(items))
	for _, item := range items {
		raw, err := core.Canonical(item)
		if err != nil {
			return result, err
		}
		consent, err := groups.ParseConsent(raw)
		if err != nil {
			return result, err
		}
		joins = append(joins, consent)
	}
	return groups.Update{Title: title, Members: roster, Joins: joins}, nil
}
