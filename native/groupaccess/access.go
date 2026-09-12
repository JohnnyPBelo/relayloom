// Package groupaccess evaluates verified group content inside one live authority
// transaction. Persisted accepted contexts must be authenticated by the caller.
package groupaccess

import (
	"bytes"
	"errors"
	"sort"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groups"
)

type Binding struct {
	Conversation string `json:"conversation"`
	Audience     string `json:"groupAudience"`
	Epoch        string `json:"groupEpoch,omitempty"`
	TargetEpoch  string `json:"targetEpoch,omitempty"`
}
type Candidate struct {
	ID      string              `json:"id"`
	Kind    string              `json:"kind"`
	Author  core.PublicIdentity `json:"author"`
	Readers []string            `json:"readers"`
	Public  bool                `json:"public"`
	Content map[string]any      `json:"content"`
}
type AcceptedContext struct {
	ID      string   `json:"id"`
	GroupID string   `json:"groupId"`
	EpochID string   `json:"epochId"`
	Author  string   `json:"author"`
	Kind    string   `json:"kind"`
	Readers []string `json:"readers"`
}
type Decision struct {
	Status     string           `json:"status"`
	Reason     string           `json:"reason,omitempty"`
	Context    *AcceptedContext `json:"context,omitempty"`
	Historical *bool            `json:"historical,omitempty"`
}
type RetryDecision struct {
	Allowed  bool   `json:"allowed"`
	Terminal bool   `json:"terminal"`
	Reason   string `json:"reason"`
}

func str(v any) string                    { s, _ := v.(string); return s }
func has(m map[string]any, k string) bool { _, ok := m[k]; return ok }
func one(value string, values ...string) bool {
	for _, s := range values {
		if value == s {
			return true
		}
	}
	return false
}
func equal(a, b any) bool {
	aa, e := core.Canonical(a)
	bb, f := core.Canonical(b)
	return e == nil && f == nil && bytes.Equal(aa, bb)
}
func sorted(values []string) []string {
	out := append([]string{}, values...)
	sort.Strings(out)
	return out
}
func invalid(reason string) Decision { return Decision{Status: "invalid", Reason: reason} }
func accepted(context AcceptedContext, historical bool) Decision {
	return Decision{Status: "accepted", Context: &context, Historical: &historical}
}
func HasBinding(v map[string]any) bool {
	return has(v, "groupEpoch") || has(v, "targetEpoch") || has(v, "groupAudience")
}
func ParseBinding(v map[string]any) (Binding, error) {
	b := Binding{Conversation: str(v["conversation"]), Audience: str(v["groupAudience"]), Epoch: str(v["groupEpoch"]), TargetEpoch: str(v["targetEpoch"])}
	kind := str(v["type"])
	if !core.ValidAddress(b.Conversation) || !one(b.Audience, "epoch", "target", "historical") || kind == "" {
		return b, errors.New("ligação de grupo inválida")
	}
	if b.Audience == "historical" {
		if has(v, "groupEpoch") || !core.ValidAddress(b.TargetEpoch) || !core.ValidAddress(str(v["target"])) || !one(kind, "receipt", "delivery", "delete") || len(v) != 5 {
			return b, errors.New("evento histórico de grupo inválido")
		}
		for _, k := range []string{"type", "conversation", "groupAudience", "target", "targetEpoch"} {
			if !has(v, k) {
				return b, errors.New("evento histórico de grupo inválido")
			}
		}
	} else {
		if !core.ValidAddress(b.Epoch) || !one(kind, "message", "edit", "reaction", "comment") {
			return b, errors.New("época de publicação inválida")
		}
		if b.Audience == "target" {
			target := str(v["target"])
			if kind == "message" {
				target = str(v["replyTo"])
			}
			if !core.ValidAddress(target) || !core.ValidAddress(b.TargetEpoch) {
				return b, errors.New("alvo de grupo inválido")
			}
		} else if kind != "message" || has(v, "targetEpoch") || has(v, "target") || has(v, "replyTo") {
			return b, errors.New("audiência de grupo inválida")
		}
	}
	return b, nil
}

type chain struct {
	state     groupauthority.View
	epochs    []groups.GroupEpoch
	snapshots map[string]*groups.GroupSnapshot
}
type Access struct {
	registry    *groupauthority.Registry
	local       core.PublicIdentity
	generation  uint64
	initialized bool
	ids         map[string]bool
	chains      map[string]*chain
}

func New(registry *groupauthority.Registry, local core.PublicIdentity) (*Access, error) {
	if _, err := registry.ScopeGeneration(); err != nil {
		return nil, err
	}
	return &Access{registry: registry, local: local}, nil
}
func (a *Access) chain(id string) (*chain, error) {
	generation, err := a.registry.ScopeGeneration()
	if err != nil {
		return nil, err
	}
	if !a.initialized || generation != a.generation {
		a.initialized = true
		a.generation = generation
		a.ids = nil
		a.chains = map[string]*chain{}
	}
	if a.ids == nil {
		list, err := a.registry.List()
		if err != nil {
			return nil, err
		}
		a.ids = map[string]bool{}
		for _, g := range list {
			a.ids[g.ID] = true
		}
	}
	if !a.ids[id] {
		return nil, nil
	}
	if existing := a.chains[id]; existing != nil {
		return existing, nil
	}
	state, err := a.registry.State(id)
	if err != nil {
		return nil, err
	}
	c := &chain{state: state, epochs: []groups.GroupEpoch{}, snapshots: map[string]*groups.GroupSnapshot{}}
	for from := 0; state.Head != nil && from <= state.Head.Body.Number; {
		page, err := a.registry.Proofs(id, from, 16)
		if err != nil {
			return nil, err
		}
		if len(page) == 0 || page[0].Body.Number != from {
			return nil, errors.New("cadeia de grupo incompleta")
		}
		c.epochs = append(c.epochs, page...)
		from = page[len(page)-1].Body.Number + 1
	}
	a.chains[id] = c
	return c, nil
}
func (a *Access) snapshot(c *chain, id string) (*groups.GroupSnapshot, error) {
	if s, ok := c.snapshots[id]; ok {
		return s, nil
	}
	s, err := a.registry.PrivateState(c.state.ID, id)
	if err != nil {
		return nil, err
	}
	c.snapshots[id] = s
	return s, nil
}
func find(c *chain, id string) *groups.GroupEpoch {
	for i := range c.epochs {
		if c.epochs[i].ID == id {
			return &c.epochs[i]
		}
	}
	return nil
}
func compatible(c *chain, original groups.GroupEpoch) bool {
	previous := original
	for _, next := range c.epochs {
		if next.Body.Number <= original.Body.Number {
			continue
		}
		if next.Body.Previous == nil || *next.Body.Previous != previous.ID || next.Body.Number != previous.Body.Number+1 || next.Body.State != "open" {
			return false
		}
		for _, old := range previous.Body.Members {
			found := false
			for _, member := range next.Body.Members {
				if member == old {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
		previous = next
	}
	return c.state.Head != nil && previous.ID == c.state.Head.ID
}
func (a *Access) Retry(groupID, epochID string) (RetryDecision, error) {
	c, err := a.chain(groupID)
	if err != nil {
		return RetryDecision{}, err
	}
	if c == nil {
		return RetryDecision{Reason: "group-not-enrolled"}, nil
	}
	terminal := map[string]string{"left": "group-left", "closed": "group-closed", "forked": "group-forked", "removed": "group-epoch-changed", "card-changed": "group-card-changed"}[c.state.Status]
	if terminal != "" {
		return RetryDecision{Terminal: true, Reason: terminal}, nil
	}
	original := find(c, epochID)
	if original != nil {
		member := false
		for _, card := range original.Body.Members {
			if card.ID == a.local.ID {
				member = true
			}
		}
		if !member {
			return RetryDecision{Terminal: true, Reason: "group-invalid-original-author"}, nil
		}
		if !compatible(c, *original) {
			return RetryDecision{Terminal: true, Reason: "group-epoch-changed"}, nil
		}
	}
	if c.state.Status != "active" || original == nil {
		return RetryDecision{Reason: "group-authority-unavailable"}, nil
	}
	return RetryDecision{Allowed: true}, nil
}
func (a *Access) Decide(candidate Candidate, prior, target *AcceptedContext) (Decision, error) {
	if _, err := a.registry.ScopeGeneration(); err != nil {
		return Decision{}, err
	}
	b, err := ParseBinding(candidate.Content)
	if err != nil {
		return invalid("invalid-group-binding"), nil
	}
	ids := map[string]bool{}
	for _, id := range candidate.Readers {
		if !core.ValidAddress(id) || ids[id] {
			return invalid("invalid-private-group-envelope"), nil
		}
		ids[id] = true
	}
	if !core.ValidAddress(candidate.ID) || candidate.Kind != str(candidate.Content["type"]) || candidate.Public || core.ValidateIdentity(candidate.Author) != nil || !ids[a.local.ID] || !ids[candidate.Author.ID] || len(ids) > 64 {
		return invalid("invalid-private-group-envelope"), nil
	}
	c, err := a.chain(b.Conversation)
	if err != nil {
		return Decision{}, err
	}
	if c == nil {
		return Decision{Status: "awaiting-proof", Reason: "group-not-enrolled"}, nil
	}
	epochID := b.Epoch
	if epochID == "" {
		epochID = b.TargetEpoch
	}
	epoch := find(c, epochID)
	if epoch == nil {
		return Decision{Status: "awaiting-proof", Reason: "unknown-epoch"}, nil
	}
	if epoch.Body.State != "open" {
		return invalid("closed-publishing-epoch"), nil
	}
	snapshot, err := a.snapshot(c, epochID)
	if err != nil {
		return Decision{}, err
	}
	if snapshot == nil {
		return Decision{Status: "awaiting-proof", Reason: "missing-private-snapshot"}, nil
	}
	cards := append([]core.PublicIdentity{}, snapshot.Members...)
	if b.Audience != "epoch" {
		targetID := str(candidate.Content["target"])
		if candidate.Kind == "message" {
			targetID = str(candidate.Content["replyTo"])
		}
		if target == nil || target.ID != targetID || target.GroupID != b.Conversation || target.EpochID != b.TargetEpoch || !one(target.Kind, "message", "post", "alert") {
			return invalid("unaccepted-group-target"), nil
		}
		originalSnapshot, err := a.snapshot(c, target.EpochID)
		if err != nil {
			return Decision{}, err
		}
		if find(c, target.EpochID) == nil || originalSnapshot == nil {
			return invalid("invalid-original-readers"), nil
		}
		for _, id := range target.Readers {
			found := false
			for _, card := range originalSnapshot.Members {
				if card.ID == id {
					found = true
				}
			}
			if !found {
				return invalid("invalid-original-readers"), nil
			}
		}
		if b.Audience == "historical" {
			cards = append([]core.PublicIdentity{}, originalSnapshot.Members...)
			if candidate.Kind == "delete" {
				if candidate.Author.ID != target.Author {
					return invalid("invalid-historical-author"), nil
				}
			} else if candidate.Author.ID == target.Author || target.Kind != "message" {
				return invalid("invalid-historical-author"), nil
			}
		} else if candidate.Kind == "edit" && candidate.Author.ID != target.Author {
			return invalid("edit-does-not-own-target"), nil
		}
		filtered := []core.PublicIdentity{}
		for _, card := range cards {
			for _, id := range target.Readers {
				if card.ID == id {
					filtered = append(filtered, card)
					break
				}
			}
		}
		cards = filtered
	}
	var author *core.PublicIdentity
	readers := []string{}
	for i, card := range cards {
		readers = append(readers, card.ID)
		if card.ID == candidate.Author.ID {
			author = &cards[i]
		}
	}
	if author == nil {
		return invalid("wrong-epoch-audience"), nil
	}
	approved, e := groups.MemberCardHash(*author)
	actual, f := groups.MemberCardHash(candidate.Author)
	if e != nil || f != nil || approved != actual || !equal(sorted(readers), sorted(candidate.Readers)) {
		return invalid("wrong-epoch-audience"), nil
	}
	if candidate.Kind == "message" && !equal(candidate.Content["members"], cards) {
		return invalid("wrong-pinned-member-cards"), nil
	}
	context := AcceptedContext{ID: candidate.ID, GroupID: b.Conversation, EpochID: epochID, Author: candidate.Author.ID, Kind: candidate.Kind, Readers: sorted(candidate.Readers)}
	if prior != nil {
		if !equal(prior, context) {
			return invalid("accepted-context-mismatch"), nil
		}
		return accepted(context, true), nil
	}
	if b.Audience == "historical" {
		return accepted(context, true), nil
	}
	if c.state.Status != "active" {
		return Decision{Status: "quarantine", Reason: "group-" + c.state.Status}, nil
	}
	if !compatible(c, *epoch) {
		return Decision{Status: "quarantine", Reason: "restrictive-successor"}, nil
	}
	return accepted(context, epoch.ID != c.state.Head.ID), nil
}
