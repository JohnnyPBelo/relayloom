package app

import (
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupcontrol"
	"github.com/JohnnyPBelo/relayloom/native/groupnotice"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

type noticeParent struct {
	Cursor int
	Found  *int
}
type noticeSynchronizer struct {
	n                                 *Node
	seen                              map[string]int64
	parents                           map[string]noticeParent
	processing                        bool
	outgoingCursor, groupCursor, turn int
	received, stored, rejected        int
}

func newNoticeSynchronizer(n *Node) *noticeSynchronizer {
	s := &noticeSynchronizer{n: n}
	s.reset()
	return s
}
func (s *noticeSynchronizer) reset() {
	s.seen = map[string]int64{}
	s.parents = map[string]noticeParent{}
	s.processing = false
}
func (n *Node) noticeRegistryLocked(fn func(*groupauthority.Registry, *groupnotice.Journal) error) error {
	return n.controlStateLocked(func(g *groupauthority.Registry, tx *groupstore.Tx) error {
		j, err := groupnotice.New(tx, n.identity.Public)
		if err != nil {
			return err
		}
		return fn(g, j)
	})
}
func (s *noticeSynchronizer) mayPublish(value groupnotice.Notice) (bool, error) {
	if s.n.identity == nil {
		return false, nil
	}
	allowed := false
	err := s.n.noticeRegistryLocked(func(g *groupauthority.Registry, j *groupnotice.Journal) error {
		views, err := g.List()
		if err != nil {
			return err
		}
		var view *groupauthority.View
		for _, v := range views {
			if v.ID == value.Anchor.ID {
				copy := v
				view = &copy
				break
			}
		}
		if view == nil || contains([]string{"closed", "forked", "capacity"}, view.Status) {
			return nil
		}
		if value.Kind == "invitation" {
			if view.Creator.ID != s.n.identity.Public.ID || view.Status != "active" || view.Head == nil || view.Head.ID != value.Parent.ID {
				return nil
			}
			entries, err := j.List(groupnotice.Outgoing)
			if err != nil {
				return err
			}
			for _, e := range entries {
				n, err := groupnotice.Parse(e.Notice)
				if err != nil {
					return err
				}
				allowed = allowed || n.ID == value.ID
			}
			return nil
		}
		info, err := g.SyncState(view.ID)
		if err != nil {
			return err
		}
		if value.Kind == "consent" {
			allowed = !info.Admitted && !view.LocallyLeft && info.Consent != nil && info.Consent.ID == value.ID && view.Head != nil && view.Head.ID == value.Parent.ID
		} else {
			allowed = view.LocallyLeft && info.Leave != nil && info.Leave.ID == value.ID && view.Head != nil && groupcontrol.HasCard(*view.Head, value.Member)
		}
		return nil
	})
	return allowed, err
}
func (s *noticeSynchronizer) receive(bundle core.Bundle) {
	n := s.n
	if n.identity == nil || s.processing {
		return
	}
	if _, seen := s.seen[bundle.Manifest.ID]; seen {
		return
	}
	mine := false
	for _, k := range bundle.Manifest.Keys {
		mine = mine || k.Reader == n.identity.Public.ID
	}
	if !mine {
		return
	}
	s.processing = true
	s.received++
	defer func() { s.processing = false; controlStamp(s.seen, bundle.Manifest.ID, time.Now().UnixMilli()) }()
	err := func() error {
		notice, err := groupnotice.Open(bundle, *n.identity)
		if err != nil {
			return err
		}
		_, recipient := notice.Parties()
		if recipient.ID != n.identity.Public.ID {
			return nil
		}
		known := false
		if err = n.controlRegistryLocked(func(g *groupauthority.Registry) error {
			views, e := g.List()
			for _, v := range views {
				known = known || v.ID == notice.Anchor.ID
			}
			return e
		}); err != nil {
			return err
		}
		if known {
			if _, err = n.groupCommandLocked(map[string]any{"action": "headers", "groupId": notice.Anchor.ID, "headers": []groups.GroupEpoch{notice.Parent}}); err != nil {
				return err
			}
		}
		if contains(n.config.Blocked, bundle.Manifest.Author.ID) || notice.Kind != "invitation" && !known {
			return nil
		}
		return n.noticeRegistryLocked(func(g *groupauthority.Registry, j *groupnotice.Journal) error {
			views, err := g.List()
			if err != nil {
				return err
			}
			for _, v := range views {
				if v.ID == notice.Anchor.ID && (contains([]string{"closed", "forked"}, v.Status) || v.Head != nil && v.Head.Body.Number >= notice.Parent.Body.Number && v.Head.ID != notice.Parent.ID) {
					return nil
				}
			}
			status, err := j.Save(groupnotice.Incoming, notice)
			if status == "stored" {
				s.stored++
			}
			return err
		})
	}()
	if err != nil {
		s.rejected++
	}
}
func (s *noticeSynchronizer) record(body map[string]any, result any) {
	if s.processing {
		return
	}
	action := text(body["action"])
	err := func() error {
		if action == "commit" || action == "close" {
			data, ok := result.(map[string]any)
			if !ok {
				return nil
			}
			operation, ok := data["operation"].(groupauthority.Result)
			if !ok {
				return nil
			}
			if err := s.n.noticeRegistryLocked(func(g *groupauthority.Registry, j *groupnotice.Journal) error {
				view, err := g.State(operation.GroupID)
				if err != nil {
					return err
				}
				entries, err := j.List(groupnotice.Outgoing)
				if err != nil {
					return err
				}
				for _, e := range entries {
					notice, err := groupnotice.Parse(e.Notice)
					if err != nil {
						return err
					}
					if notice.Anchor.ID == view.ID && (view.Status != "active" || view.Head == nil || notice.Parent.ID != view.Head.ID) {
						if _, err = j.Retire(groupnotice.Outgoing, notice.ID); err != nil {
							return err
						}
					}
				}
				return nil
			}); err != nil {
				return err
			}
		}
		if contains([]string{"invite", "accept", "leave", "notice-open"}, action) {
			return s.tick()
		}
		return nil
	}()
	if err != nil {
		s.rejected++
	}
}
func (s *noticeSynchronizer) parent(g *groupauthority.Registry, view groupauthority.View, id string) (*groups.GroupEpoch, error) {
	if view.Head == nil {
		return nil, nil
	}
	if view.Head.ID == id {
		return view.Head, nil
	}
	key := view.ID + ":" + id
	progress, ok := s.parents[key]
	if !ok {
		progress = noticeParent{Cursor: view.Head.Body.Number}
	}
	if progress.Found != nil {
		page, err := g.Proofs(view.ID, *progress.Found, 1)
		if err != nil {
			return nil, err
		}
		if len(page) > 0 && page[0].ID == id {
			return &page[0], nil
		}
		return nil, nil
	}
	if progress.Cursor < 0 {
		return nil, nil
	}
	start := max(0, progress.Cursor-15)
	page, err := g.Proofs(view.ID, start, min(16, progress.Cursor+1))
	if err != nil {
		return nil, err
	}
	progress.Cursor = start - 1
	var found *groups.GroupEpoch
	for _, e := range page {
		if e.ID == id {
			copy := e
			found = &copy
			number := e.Body.Number
			progress.Found = &number
			break
		}
	}
	if _, exists := s.parents[key]; !exists {
		trimControlMap(s.parents, 128)
	}
	s.parents[key] = progress
	return found, nil
}
func (s *noticeSynchronizer) tick() error {
	n := s.n
	if n.identity == nil || s.processing || !n.groupSync.ready() || !n.connectedOutboxLocked() {
		return nil
	}
	identity := *n.identity
	candidates := []groupnotice.Notice{}
	err := n.noticeRegistryLocked(func(g *groupauthority.Registry, j *groupnotice.Journal) error {
		views, err := g.List()
		if err != nil {
			return err
		}
		out, err := j.List(groupnotice.Outgoing)
		if err != nil {
			return err
		}
		at := s.outgoingCursor % max(1, len(out))
		s.outgoingCursor++
		if len(out) > 0 {
			item, err := groupnotice.Parse(out[at].Notice)
			if err != nil {
				return err
			}
			valid := false
			for _, v := range views {
				valid = valid || (item.Kind == "invitation" && v.ID == item.Anchor.ID && v.Status == "active" && v.Head != nil && v.Head.ID == item.Parent.ID)
			}
			if valid {
				candidates = append(candidates, item)
			} else {
				if _, err = j.Retire(groupnotice.Outgoing, item.ID); err != nil {
					return err
				}
			}
		}
		at = s.groupCursor % max(1, len(views))
		s.groupCursor++
		if len(views) == 0 {
			return nil
		}
		view := views[at]
		if view.Creator.ID == identity.Public.ID || contains([]string{"closed", "forked", "capacity"}, view.Status) {
			return nil
		}
		info, err := g.SyncState(view.ID)
		if err != nil {
			return err
		}
		add := func(kind string, parent groups.GroupEpoch, member core.PublicIdentity, certificate any, invitation *groups.GroupInvitation) error {
			raw := map[string]any{"type": "group-notice", "version": 1, "kind": kind, "anchor": info.Anchor, "parent": parent, "member": member, "certificate": certificate}
			if invitation != nil {
				raw["invitation"] = *invitation
			}
			value, err := groupnotice.Parse(raw)
			if err == nil {
				candidates = append(candidates, value)
			}
			return err
		}
		if info.Consent != nil && info.Invitation != nil && info.InvitationCard != nil && info.InvitationParent != nil && !info.Admitted && !view.LocallyLeft && view.Head != nil && view.Head.ID == info.InvitationParent.ID {
			if err = add("consent", *info.InvitationParent, *info.InvitationCard, *info.Consent, info.Invitation); err != nil {
				return err
			}
		}
		if info.Leave != nil && info.LeaveCard != nil && view.LocallyLeft && view.Head != nil && view.Head.Body.State == "open" && groupcontrol.HasCard(*view.Head, *info.LeaveCard) {
			parent, err := s.parent(g, view, info.Leave.Body.ParentEpochID)
			if err != nil {
				return err
			}
			if parent != nil {
				return add("leave", *parent, *info.LeaveCard, *info.Leave, nil)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	eligible := []groupnotice.Notice{}
	for _, value := range candidates {
		_, recipient := value.Parties()
		if !contains(n.config.Blocked, recipient.ID) {
			eligible = append(eligible, value)
		}
	}
	if len(eligible) == 0 {
		return nil
	}
	notice := eligible[s.turn%len(eligible)]
	s.turn++
	return n.groupSync.output("notice:"+notice.ID, func() (core.Bundle, error) { return groupnotice.Seal(identity, notice) }, false, 15000)
}
func (n *Node) cancelStaleNoticesLocked() {
	if n.identity == nil || n.noticeSync == nil {
		return
	}
	identity := *n.identity
	// The router invokes its predicate while holding r.mu. Recovery can cancel
	// router packets, so all storage/authority work must finish before that lock.
	allowed := map[string]bool{}
	certificates := map[string]bool{}
	for _, manifest := range n.Store.List() {
		if manifest.Kind != "group-notice" || manifest.Author.ID != identity.Public.ID {
			continue
		}
		bundle, err := n.Store.GetWithTouch(manifest.ID, false)
		if err != nil {
			continue
		}
		notice, err := groupnotice.Open(bundle, identity)
		if err != nil {
			continue
		}
		permitted, known := certificates[notice.ID]
		if !known {
			var err error
			permitted, err = n.noticeSync.mayPublish(notice)
			permitted = err == nil && permitted
			certificates[notice.ID] = permitted
		}
		allowed[manifest.ID] = permitted
	}
	n.Router.CancelLocal(func(payload any) bool {
		raw, err := core.Canonical(payload)
		if err != nil {
			return false
		}
		value, err := core.DecodeJSON(raw, 8*1024*1024)
		if err != nil {
			return false
		}
		m, ok := value.(map[string]any)
		if !ok || m["type"] != "bundle" {
			return false
		}
		b, ok := m["bundle"].(map[string]any)
		if !ok {
			return false
		}
		manifest, _ := b["manifest"].(map[string]any)
		author, _ := manifest["author"].(map[string]any)
		if manifest["kind"] != "group-notice" || author["id"] != identity.Public.ID {
			return false
		}
		id := text(manifest["id"])
		return !allowed[id]
	})
}
