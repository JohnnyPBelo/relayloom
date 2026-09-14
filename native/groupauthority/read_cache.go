package groupauthority

import "github.com/JohnnyPBelo/relayloom/native/groups"

// The borrowed transaction is synchronous. No entry survives a generation
// change or the end of that transaction. Eight52KiB records bound retained data.
type verifiedRecords struct {
	generation uint64
	values     map[string]*record
	order      []string
}

func (c *verifiedRecords) remember(id string, value *record) {
	if len(c.order) >= 8 {
		delete(c.values, c.order[0])
		copy(c.order, c.order[1:])
		c.order[len(c.order)-1] = ""
		c.order = c.order[:len(c.order)-1]
	}
	c.values[id] = cloneAuthorityRecord(value)
	c.order = append(c.order, id)
}

func cloneAuthorityPointer[T any](value *T) *T {
	if value == nil {
		return nil
	}
	result := *value
	return &result
}

func cloneAuthorityEpoch(value *groups.GroupEpoch) *groups.GroupEpoch {
	result := cloneAuthorityPointer(value)
	if result != nil {
		result.Body.Previous = cloneAuthorityPointer(value.Body.Previous)
		if value.Body.Members != nil {
			result.Body.Members = make([]groups.MemberCommitment, len(value.Body.Members))
			copy(result.Body.Members, value.Body.Members)
		}
	}
	return result
}

// Preserve slices, pointers and raw strings, including the lone UTF-16
// surrogate representation supported by the canonical protocol. A plain
// encoding/json round-trip would silently replace those strings.
func cloneAuthorityRecord(value *record) *record {
	if value == nil {
		return nil
	}
	result := cloneAuthorityPointer(value)
	result.Head = cloneAuthorityEpoch(value.Head)
	result.Label = cloneAuthorityPointer(value.Label)
	result.Admitted = cloneAuthorityPointer(value.Admitted)
	result.CheckedThrough = cloneAuthorityPointer(value.CheckedThrough)
	result.Invitation = cloneAuthorityPointer(value.Invitation)
	result.InvitationParent = cloneAuthorityEpoch(value.InvitationParent)
	result.InvitationCard = cloneAuthorityPointer(value.InvitationCard)
	result.Consent = cloneAuthorityPointer(value.Consent)
	result.Left = cloneAuthorityPointer(value.Left)
	if result.Left != nil {
		result.Left.EpochID = cloneAuthorityPointer(value.Left.EpochID)
		result.Left.Request = cloneAuthorityPointer(value.Left.Request)
		result.Left.Card = cloneAuthorityPointer(value.Left.Card)
	}
	result.Frozen = cloneAuthorityPointer(value.Frozen)
	if result.Frozen != nil {
		result.Frozen.Observed = cloneAuthorityEpoch(value.Frozen.Observed)
		result.Frozen.First = cloneAuthorityEpoch(value.Frozen.First)
		result.Frozen.Second = cloneAuthorityEpoch(value.Frozen.Second)
	}
	return result
}
