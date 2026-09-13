package app

import (
	"errors"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupcontrol"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

type controlHolder struct {
	GroupID string
	Card    core.PublicIdentity
	Number  int
}
type groupSynchronizer struct {
	n                                   *Node
	seen, cooldown                      map[string]int64
	published                           map[string]string
	deferred, requestIDs                map[string]bool
	deferredOrder                       []string
	replay                              []string
	holders                             map[string]controlHolder
	providers                           map[string]int
	historyCursor                       map[string]int
	cursor, budget, sentBytes, requests int
	window                              int64
	processing                          bool
	received, applied, rejected, sent   int
}

func newGroupSynchronizer(n *Node) *groupSynchronizer {
	s := &groupSynchronizer{n: n}
	s.reset()
	return s
}
func (s *groupSynchronizer) reset() {
	s.seen = map[string]int64{}
	s.cooldown = map[string]int64{}
	s.published = map[string]string{}
	s.deferred = map[string]bool{}
	s.deferredOrder = nil
	s.requestIDs = map[string]bool{}
	s.replay = nil
	s.holders = map[string]controlHolder{}
	s.providers = map[string]int{}
	s.historyCursor = map[string]int{}
	s.processing = false
}
func (s *groupSynchronizer) ready() bool { return len(s.replay) == 0 }
func (s *groupSynchronizer) deferCarrier(id string) {
	if s.deferred[id] || len(s.deferred) >= 128 {
		return
	}
	if len(s.deferredOrder) >= 256 {
		kept := []string{}
		seen := map[string]bool{}
		for _, key := range s.deferredOrder {
			if s.deferred[key] && !seen[key] {
				kept = append(kept, key)
				seen[key] = true
			}
		}
		s.deferredOrder = kept
	}
	s.deferred[id] = true
	s.deferredOrder = append(s.deferredOrder, id)
}
func controlStamp(m map[string]int64, key string, value int64) {
	if _, ok := m[key]; !ok && len(m) >= 512 {
		old := ""
		for k, v := range m {
			if old == "" || v < m[old] || (v == m[old] && k < old) {
				old = k
			}
		}
		delete(m, old)
	}
	m[key] = value
}
func trimControlMap[T any](m map[string]T, limit int) {
	for len(m) >= limit {
		for key := range m {
			delete(m, key)
			break
		}
	}
}
func (s *groupSynchronizer) recover() {
	s.reset()
	if s.n.identity == nil {
		return
	}
	for _, m := range s.n.Store.List() {
		if m.Kind == "group-control" {
			for _, key := range m.Keys {
				if key.Reader == s.n.identity.Public.ID {
					s.replay = append(s.replay, m.ID)
					break
				}
			}
		}
	}
	if len(s.replay) > 0 {
		s.n.cancelGroupPacketsLocked(true)
	}
	s.drain()
}
func (s *groupSynchronizer) drain() bool {
	for i := 0; i < 16 && len(s.replay) > 0; i++ {
		id := s.replay[0]
		s.replay = s.replay[1:]
		bundle, err := s.n.Store.GetWithTouch(id, false)
		if err != nil {
			s.rejected++
			continue
		}
		s.receive(bundle, false)
	}
	return s.ready()
}
func (s *groupSynchronizer) windowAt(now int64) {
	if now-s.window >= 60000 {
		s.window = now
		s.budget = 0
		s.sentBytes = 0
		s.requests = 0
	}
}
func (s *groupSynchronizer) output(key string, makeBundle func() (core.Bundle, error), relayed bool, interval int64) error {
	n, now := s.n, time.Now().UnixMilli()
	if n.identity == nil || !n.connectedOutboxLocked() || (relayed && !n.config.Relay) || now-s.cooldown[key] < interval {
		return nil
	}
	s.windowAt(now)
	if s.budget >= 64 || s.sentBytes >= 4*1024*1024 {
		return nil
	}
	// Reserve work before any fallible factory/storage/network operation.
	s.budget++
	controlStamp(s.cooldown, key, now)
	var bundle core.Bundle
	var err error
	if id := s.published[key]; id != "" && n.Store.Has(id) {
		bundle, err = n.Store.GetWithTouch(id, false)
		if err != nil {
			delete(s.published, key)
		}
	}
	if bundle.Manifest.ID == "" || err != nil {
		bundle, err = makeBundle()
		if err != nil {
			return err
		}
	}
	data, err := core.Canonical(bundle)
	if err != nil {
		return err
	}
	for _, key := range bundle.Manifest.Keys {
		if contains(n.config.Blocked, key.Reader) {
			return nil
		}
	}
	if len(data) > groupcontrol.BundleLimit || s.sentBytes+len(data) > 4*1024*1024 {
		return nil
	}
	s.sentBytes += len(data)
	retained, err := s.retain(bundle, false)
	if err != nil {
		return err
	}
	if !retained {
		return nil
	}
	if _, ok := s.published[key]; !ok {
		trimControlMap(s.published, 256)
	}
	s.published[key] = bundle.Manifest.ID
	if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Normal, 2*time.Minute, relayed); err != nil {
		return err
	}
	s.sent++
	return nil
}
func (n *Node) controlRegistryLocked(fn func(*groupauthority.Registry) error) error {
	if n.identity == nil || n.privateDatabase == nil {
		return errors.New("estado privado indisponível")
	}
	err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		state, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if state == nil || state.Digest != n.privateDigest {
			return errors.New("estado privado desactualizado")
		}
		_, err = groupledger.Run(tx, *n.identity, func(_ *groupledger.Ledger, g *groupauthority.Registry) error { return fn(g) })
		return err
	})
	if err != nil {
		var input *groupcontrol.InputError
		if !errors.As(err, &input) {
			n.cancelGroupPacketsLocked(true)
			n.recoverGroupContentLocked()
		}
	}
	return err
}
func (n *Node) requireGroupReplayLocked() error {
	if n.groupSync != nil && !n.groupSync.processing && !n.groupSync.drain() {
		return errors.New("a verificar controlos de grupo recebidos; tente novamente")
	}
	if n.identity == nil {
		return errors.New("desbloqueie a identidade")
	}
	return nil
}
func (n *Node) groupReplayReadyLocked() bool { return n.groupSync == nil || n.groupSync.ready() }

func (s *groupSynchronizer) receive(bundle core.Bundle, retry bool) {
	n := s.n
	if n.identity == nil || s.processing || bundle.Manifest.Kind != "group-control" {
		return
	}
	mine := false
	for _, key := range bundle.Manifest.Keys {
		mine = mine || key.Reader == n.identity.Public.ID
	}
	if !mine {
		return
	}
	if _, ok := s.seen[bundle.Manifest.ID]; ok && !retry && !s.deferred[bundle.Manifest.ID] && !s.requestIDs[bundle.Manifest.ID] {
		return
	}
	s.processing = true
	s.received++
	defer func() { controlStamp(s.seen, bundle.Manifest.ID, time.Now().UnixMilli()); s.processing = false }()
	identity := *n.identity
	c, err := groupcontrol.Open(bundle, identity)
	if err != nil {
		s.rejected++
		return
	}
	if c.To != "" && c.To != identity.Public.ID {
		return
	}
	if c.Action == "headers-request" || c.Action == "snapshot-request" {
		if !s.requestIDs[bundle.Manifest.ID] {
			trimControlMap(s.requestIDs, 512)
		}
		s.requestIDs[bundle.Manifest.ID] = true
		if !s.ready() {
			return
		}
		now, key := time.Now().UnixMilli(), "incoming:"+bundle.Manifest.Author.ID+":"+c.Action
		s.windowAt(now)
		if s.requests >= 64 || now-s.cooldown[key] < 1000 {
			return
		}
		s.requests++
		controlStamp(s.cooldown, key, now)
	}
	known := false
	if err = n.controlRegistryLocked(func(g *groupauthority.Registry) error {
		list, err := g.List()
		if err != nil {
			return err
		}
		for _, group := range list {
			known = known || group.ID == c.GroupID
		}
		return nil
	}); err != nil {
		s.rejected++
		return
	}
	if !known {
		return
	}
	blocked := contains(n.config.Blocked, bundle.Manifest.Author.ID)
	if c.Action == "headers-request" || c.Action == "snapshot-request" {
		if blocked {
			return
		}
		var material groupcontrol.Material
		var key string
		relayed := false
		err = n.controlRegistryLocked(func(g *groupauthority.Registry) error {
			anchor, err := g.Anchor(c.GroupID)
			if err != nil {
				return err
			}
			own := anchor.Body.Creator.ID == identity.Public.ID
			relayed = !own
			if !own && !n.config.Relay {
				return nil
			}
			if c.Action == "headers-request" {
				result, err := groupcontrol.RequestedHeaders(g, c, bundle.Manifest.Author)
				if err != nil {
					return err
				}
				material = groupcontrol.Material{Payload: map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": c.GroupID, "to": bundle.Manifest.Author.ID, "from": c.From, "headers": result.Headers, "head": result.Head}, Readers: []core.PublicIdentity{bundle.Manifest.Author}}
				encoded, err := core.Canonical(material.Payload)
				if err != nil {
					return err
				}
				key = core.Hash(encoded)
				return nil
			}
			result, err := groupcontrol.RequestedSnapshot(g, c, bundle.Manifest.Author, identity.Public)
			if err != nil {
				return err
			}
			material, err = groupcontrol.SnapshotMaterial(g, identity.Public, result.Epoch, result.Snapshot, bundle.Manifest.Author)
			key = "snapshot:" + c.GroupID + ":" + result.Epoch.ID + ":" + bundle.Manifest.Author.ID
			return err
		})
		if err != nil {
			s.rejected++
			return
		}
		if key != "" {
			if err = s.output(key, func() (core.Bundle, error) { return groupcontrol.Seal(identity, material.Payload, material.Readers) }, relayed, 10000); err != nil {
				s.rejected++
			}
		}
		return
	}
	if c.Action == "headers" {
		if len(c.Headers) > 0 {
			if _, err = n.groupCommandLocked(map[string]any{"action": "headers", "groupId": c.GroupID, "headers": c.Headers}); err != nil {
				s.rejected++
			}
		}
		if _, err = n.groupCommandLocked(map[string]any{"action": "headers", "groupId": c.GroupID, "headers": []any{c.Head}}); err != nil {
			s.rejected++
		}
		s.applied++
		return
	}
	if _, err = n.groupCommandLocked(map[string]any{"action": "headers", "groupId": c.GroupID, "headers": []any{c.Epoch}}); err != nil {
		s.rejected++
	}
	if blocked || n.identity == nil {
		return
	}
	var preview groupcontrol.SnapshotResult
	err = n.controlRegistryLocked(func(g *groupauthority.Registry) error {
		anchor, err := g.Anchor(c.GroupID)
		if err != nil {
			return err
		}
		preview, err = groupcontrol.SnapshotPreview(bundle, c, anchor)
		return err
	})
	if err != nil {
		s.rejected++
		return
	}
	holderKey := c.GroupID + ":" + bundle.Manifest.Author.ID
	if _, ok := s.holders[holderKey]; !ok {
		trimControlMap(s.holders, 256)
	}
	s.holders[holderKey] = controlHolder{c.GroupID, bundle.Manifest.Author, preview.Epoch.Body.Number}
	var prepared *groupcontrol.SnapshotResult
	err = n.controlRegistryLocked(func(g *groupauthority.Registry) error {
		info, err := g.SyncState(c.GroupID)
		if err != nil {
			return err
		}
		headers, err := g.Proofs(c.GroupID, preview.Epoch.Body.Number, 1)
		if err != nil {
			return err
		}
		if len(headers) == 0 || headers[0].ID != preview.Epoch.ID || (!info.Admitted && info.Consent == nil) {
			return nil
		}
		checked, err := groupcontrol.CheckedSnapshot(g, bundle, c)
		if err == nil {
			prepared = &checked
		}
		return err
	})
	if err != nil {
		s.rejected++
		return
	}
	if prepared == nil {
		s.deferCarrier(bundle.Manifest.ID)
		return
	}
	if _, err = n.groupCommandLocked(map[string]any{"action": "snapshot", "groupId": c.GroupID, "epochId": prepared.Epoch.ID, "snapshot": prepared.Snapshot}); err != nil {
		s.deferCarrier(bundle.Manifest.ID)
		return
	}
	delete(s.deferred, bundle.Manifest.ID)
	s.applied++
	if bundle.Manifest.Author.ID == identity.Public.ID {
		key := "snapshot:" + c.GroupID + ":" + prepared.Epoch.ID
		if c.To != "" {
			key += ":" + c.To
		}
		if _, ok := s.published[key]; !ok {
			trimControlMap(s.published, 256)
		}
		s.published[key] = bundle.Manifest.ID
	}
}

type groupControlPlan struct {
	Group         groupauthority.View
	Authorization groupcontrol.Authorization
	Provider      *core.PublicIdentity
	Wanted        *groups.GroupEpoch
	Publication   *groupcontrol.Material
	Historical    *groupcontrol.Material
}

type storedControl struct {
	Key      string
	Material groupcontrol.Material
}

func (s *groupSynchronizer) record(command map[string]any, value any) {
	if s.processing || !contains([]string{"create", "commit", "close"}, text(command["action"])) || s.n.identity == nil {
		return
	}
	result, ok := value.(map[string]any)
	if !ok {
		return
	}
	operation, ok := result["operation"].(groupauthority.Result)
	if !ok || operation.EpochID == nil {
		return
	}
	identity := *s.n.identity
	materials := []storedControl{}
	err := s.n.controlRegistryLocked(func(g *groupauthority.Registry) error {
		info, err := g.SyncState(operation.GroupID)
		if err != nil {
			return err
		}
		if info.Anchor.Body.Creator.ID != identity.Public.ID {
			return nil
		}
		var epoch *groups.GroupEpoch
		if info.View.Head != nil && info.View.Head.ID == *operation.EpochID {
			epoch = info.View.Head
		}
		for from := 0; epoch == nil && info.View.Head != nil && from <= info.View.Head.Body.Number; from += 16 {
			headers, err := g.Proofs(operation.GroupID, from, 16)
			if err != nil {
				return err
			}
			for _, header := range headers {
				if header.ID == *operation.EpochID {
					copy := header
					epoch = &copy
					break
				}
			}
		}
		if epoch == nil {
			return nil
		}
		snapshot, err := g.PrivateState(operation.GroupID, epoch.ID)
		if err != nil {
			return err
		}
		if snapshot != nil {
			material, err := groupcontrol.SnapshotMaterial(g, identity.Public, *epoch, *snapshot)
			if err != nil {
				return err
			}
			materials = append(materials, storedControl{"snapshot:" + operation.GroupID + ":" + epoch.ID, material})
		}
		if expected := text(command["expected"]); expected != "" {
			old, err := g.PrivateState(operation.GroupID, expected)
			if err != nil {
				return err
			}
			if old != nil {
				for _, card := range old.Members {
					if card.ID == identity.Public.ID || groupcontrol.HasCard(*epoch, card) {
						continue
					}
					payload := map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": operation.GroupID, "to": card.ID, "from": epoch.Body.Number, "headers": []groups.GroupEpoch{*epoch}, "head": *epoch}
					data, err := core.Canonical(payload)
					if err != nil {
						return err
					}
					materials = append(materials, storedControl{core.Hash(data), groupcontrol.Material{Payload: payload, Readers: []core.PublicIdentity{card}}})
				}
			}
		}
		return nil
	})
	if err != nil {
		s.rejected++
		return
	}
	for _, item := range materials {
		if err = s.cache(item.Key, item.Material, true); err != nil {
			s.rejected++
		}
	}
}
func (s *groupSynchronizer) cache(key string, material groupcontrol.Material, critical bool) error {
	n := s.n
	if n.identity == nil {
		return nil
	}
	if id := s.published[key]; id != "" && n.Store.Has(id) {
		return nil
	}
	for _, card := range material.Readers {
		if contains(n.config.Blocked, card.ID) {
			return nil
		}
	}
	bundle, err := groupcontrol.Seal(*n.identity, material.Payload, material.Readers)
	if err != nil {
		return err
	}
	retained, err := s.retain(bundle, critical)
	if err != nil {
		return err
	}
	if !retained {
		return nil
	}
	if _, ok := s.published[key]; !ok {
		trimControlMap(s.published, 256)
	}
	s.published[key] = bundle.Manifest.ID
	return s.output(key, func() (core.Bundle, error) { return bundle, nil }, false, 10000)
}

// Directed responses and locally recorded changes share the producer quota.
// Only a committed local change may replace older unpinned control objects.
func (s *groupSynchronizer) retain(bundle core.Bundle, critical bool) (bool, error) {
	n := s.n
	if n.identity == nil {
		return false, nil
	}
	if n.Store.Has(bundle.Manifest.ID) {
		return true, nil
	}
	encoded, err := core.Canonical(bundle)
	if err != nil {
		return false, err
	}
	size := int64(len(encoded))
	limit := min(int64(8*1024*1024), n.Store.Stats().Quota/4)
	if size > limit {
		return false, nil
	}
	estimate := func(m core.Manifest) int64 {
		data, _ := core.Canonical(m)
		total := int64(512 + len(data))
		for _, c := range m.Chunks {
			total += int64(80 + (c.Size+2)/3*4)
		}
		return total
	}
	retained := []core.Manifest{}
	bytes := int64(0)
	for _, m := range n.Store.List() {
		if m.Kind == "group-control" && m.Author.ID == n.identity.Public.ID {
			retained = append(retained, m)
			bytes += estimate(m)
		}
	}
	reserved := n.Store.Reservations()
	removals := []string{}
	for _, old := range retained {
		if bytes+size <= limit {
			break
		}
		if !critical {
			return false, nil
		}
		if n.Store.IsPinned(old.ID) || contains(reserved, old.ID) {
			continue
		}
		removals = append(removals, old.ID)
		bytes -= estimate(old)
	}
	if bytes+size > limit {
		return false, nil
	}
	if _, err = n.Store.Put(bundle, false); err != nil {
		return false, err
	}
	// Refused admission and failed writes must not discard older proofs first.
	for _, id := range removals {
		if n.Store.Has(id) {
			if err = n.Store.Remove(id); err != nil {
				return false, err
			}
		}
	}
	return true, nil
}

func (s *groupSynchronizer) tick() error {
	n := s.n
	if n.identity == nil {
		return nil
	}
	identity := *n.identity
	s.drain()
	if !s.ready() || !n.connectedOutboxLocked() {
		return nil
	}
	hasGroups := false
	if err := n.controlRegistryLocked(func(g *groupauthority.Registry) error { list, err := g.List(); hasGroups = len(list) > 0; return err }); err != nil {
		return err
	}
	if !hasGroups {
		return nil
	}
	pending := []string{}
	for len(s.deferredOrder) > 0 && len(pending) < 2 {
		id := s.deferredOrder[0]
		s.deferredOrder = s.deferredOrder[1:]
		if s.deferred[id] {
			pending = append(pending, id)
		}
	}
	for _, id := range pending {
		delete(s.deferred, id)
		if bundle, err := n.Store.GetWithTouch(id, false); err == nil {
			s.receive(bundle, true)
		}
	}
	known := n.Store.List()
	var plan *groupControlPlan
	err := n.controlRegistryLocked(func(g *groupauthority.Registry) error {
		list, err := g.List()
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return nil
		}
		group := list[s.cursor%len(list)]
		s.cursor++
		info, err := g.SyncState(group.ID)
		if err != nil {
			return err
		}
		var epoch *groups.GroupEpoch
		auth := groupcontrol.Authorization{}
		if info.Invitation != nil && info.InvitationParent != nil {
			epoch = info.InvitationParent
			auth = groupcontrol.Authorization{Number: epoch.Body.Number, ID: epoch.ID, Invitation: *info.Invitation}
		} else if group.Head != nil {
			for at := group.Head.Body.Number; at >= 0 && epoch == nil; at -= 16 {
				headers, err := g.Proofs(group.ID, max(0, at-15), min(16, at+1))
				if err != nil {
					return err
				}
				for i := len(headers) - 1; i >= 0; i-- {
					if groupcontrol.HasCard(headers[i], identity.Public) {
						copy := headers[i]
						epoch = &copy
						auth = groupcontrol.Authorization{Number: copy.Body.Number, ID: copy.ID}
						break
					}
				}
			}
		}
		if epoch == nil {
			return nil
		}
		var current *groups.GroupSnapshot
		if group.Head != nil {
			current, err = g.PrivateState(group.ID, group.Head.ID)
			if err != nil {
				return err
			}
		}
		cards := []core.PublicIdentity{info.Anchor.Body.Creator}
		if current != nil {
			cards = append(cards, current.Members...)
		}
		for _, manifest := range known {
			cards = append(cards, manifest.Author)
		}
		for _, holder := range s.holders {
			if holder.GroupID == group.ID {
				cards = append(cards, holder.Card)
			}
		}
		seen := map[string]bool{}
		providers := []core.PublicIdentity{}
		for _, card := range cards {
			holder, hasHolder := s.holders[group.ID+":"+card.ID]
			if card.ID != identity.Public.ID && !contains(n.config.Blocked, card.ID) && !seen[card.ID] && (card.ID == info.Anchor.Body.Creator.ID || groupcontrol.HasCard(*epoch, card) || (hasHolder && holder.Number >= epoch.Body.Number)) {
				seen[card.ID] = true
				providers = append(providers, card)
			}
		}
		result := &groupControlPlan{Group: group, Authorization: auth}
		if len(providers) > 0 {
			value := providers[s.providers[group.ID]%len(providers)]
			result.Provider = &value
		}
		s.providers[group.ID]++
		wanted := -1
		if info.Consent != nil && info.InvitationParent != nil && !info.Admitted {
			wanted = min(1023, info.InvitationParent.Body.Number+1)
		} else if info.CheckedThrough != nil && group.Head != nil && group.Status != "closed" && *info.CheckedThrough < group.Head.Body.Number {
			wanted = *info.CheckedThrough + 1
		}
		if wanted < 0 && group.Head != nil && groupcontrol.HasCard(*group.Head, identity.Public) && current == nil {
			wanted = group.Head.Body.Number
		}
		if wanted >= 0 {
			headers, err := g.Proofs(group.ID, wanted, 1)
			if err != nil {
				return err
			}
			if len(headers) > 0 && groupcontrol.HasCard(headers[0], identity.Public) {
				value := headers[0]
				result.Wanted = &value
			}
		}
		if result.Wanted == nil && group.Head != nil {
			missing := ""
			for _, summary := range n.summaries {
				content := summary.object.Content
				if text(content["conversation"]) != group.ID {
					continue
				}
				for _, field := range []string{"groupEpoch", "targetEpoch"} {
					id := text(content[field])
					if id == "" {
						continue
					}
					snapshot, err := g.PrivateState(group.ID, id)
					if err != nil {
						return err
					}
					if snapshot == nil {
						missing = id
						break
					}
				}
				if missing != "" {
					break
				}
			}
			for from := 0; missing != "" && from <= group.Head.Body.Number && result.Wanted == nil; from += 16 {
				headers, err := g.Proofs(group.ID, from, 16)
				if err != nil {
					return err
				}
				for _, header := range headers {
					if header.ID == missing && groupcontrol.HasCard(header, identity.Public) {
						copy := header
						result.Wanted = &copy
						break
					}
				}
			}
		}
		if current != nil && group.Head != nil && groupcontrol.HasCard(*group.Head, identity.Public) && (group.Status == "active" || group.Status == "closed") && (group.Creator.ID == identity.Public.ID || n.config.Relay) {
			for _, card := range current.Members {
				if contains(n.config.Blocked, card.ID) {
					plan = result
					return nil
				}
			}
			material, err := groupcontrol.SnapshotMaterial(g, identity.Public, *group.Head, *current)
			if err != nil {
				return err
			}
			result.Publication = &material
		}
		if group.Creator.ID == identity.Public.ID && group.Head != nil && (group.Status == "active" || group.Status == "closed") {
			cursor := s.historyCursor[group.ID]
			if cursor <= group.Head.Body.Number {
				s.historyCursor[group.ID] = cursor + 1
				headers, err := g.Proofs(group.ID, cursor, 1)
				if err != nil {
					return err
				}
				if len(headers) > 0 && s.published["snapshot:"+group.ID+":"+headers[0].ID] == "" {
					snapshot, err := g.PrivateState(group.ID, headers[0].ID)
					if err != nil {
						return err
					}
					if snapshot != nil {
						material, err := groupcontrol.SnapshotMaterial(g, identity.Public, headers[0], *snapshot)
						if err != nil {
							return err
						}
						result.Historical = &material
					}
				}
			}
		}
		plan = result
		return nil
	})
	if err != nil {
		return err
	}
	if plan == nil {
		return nil
	}
	if plan.Historical != nil {
		epoch, ok := plan.Historical.Payload["epoch"].(groups.GroupEpoch)
		if !ok {
			return errors.New("época interna do carrier inválida")
		}
		if err = s.cache("snapshot:"+plan.Group.ID+":"+epoch.ID, *plan.Historical, false); err != nil {
			return err
		}
	}
	if plan.Publication != nil {
		material := *plan.Publication
		if err = s.output("snapshot:"+plan.Group.ID+":"+plan.Group.Head.ID, func() (core.Bundle, error) { return groupcontrol.Seal(identity, material.Payload, material.Readers) }, plan.Group.Creator.ID != identity.Public.ID, 30000); err != nil {
			return err
		}
	}
	if plan.Provider != nil {
		auth := map[string]any{"number": plan.Authorization.Number, "id": plan.Authorization.ID}
		if plan.Authorization.Invitation != nil {
			auth["invitation"] = plan.Authorization.Invitation
		}
		from := 0
		if plan.Group.Head != nil {
			from = min(1023, plan.Group.Head.Body.Number+1)
		}
		request := map[string]any{"type": "group-control", "version": 1, "action": "headers-request", "groupId": plan.Group.ID, "to": plan.Provider.ID, "from": from, "count": 16, "authorization": auth}
		if plan.Wanted != nil {
			request = map[string]any{"type": "group-control", "version": 1, "action": "snapshot-request", "groupId": plan.Group.ID, "to": plan.Provider.ID, "number": plan.Wanted.Body.Number, "epochId": plan.Wanted.ID}
		}
		encoded, err := core.Canonical(request)
		if err != nil {
			return err
		}
		return s.output("request:"+core.Hash(encoded), func() (core.Bundle, error) {
			return groupcontrol.Seal(identity, request, []core.PublicIdentity{*plan.Provider})
		}, false, 10000)
	}
	return nil
}
