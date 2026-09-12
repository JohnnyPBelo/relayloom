package groups

import (
	"errors"
	"sort"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func owner(identity core.Identity, anchor GroupAnchor) error {
	if err := VerifyAnchor(anchor); err != nil {
		return err
	}
	if identity.Public.ID != anchor.Body.Creator.ID || identity.Public.SignKey != anchor.Body.Creator.SignKey {
		return errors.New("só o criador pode alterar os membros")
	}
	return nil
}
func CreateAnchor(identity core.Identity) (GroupAnchor, error) {
	n, err := nonce()
	if err != nil {
		return GroupAnchor{}, err
	}
	anchor, err := signCertificate(AnchorBody{Domain: "relayloom/group-anchor/1", Creator: identity.Public, Nonce: n, MembershipAuthority: "creator-only"}, identity, CertificateBytes)
	if err == nil {
		err = VerifyAnchor(anchor)
	}
	return anchor, err
}
func makeSnapshot(groupID, title string, members []core.PublicIdentity, joins []GroupConsent) (GroupSnapshot, error) {
	salt, err := nonce()
	if err != nil {
		return GroupSnapshot{}, err
	}
	state := GroupSnapshot{Domain: "relayloom/group-state/1", GroupID: groupID, Salt: salt, Title: title, Members: append([]core.PublicIdentity{}, members...), Joins: append([]GroupConsent{}, joins...)}
	sort.Slice(state.Members, func(i, j int) bool { return state.Members[i].ID < state.Members[j].ID })
	sort.Slice(state.Joins, func(i, j int) bool { return state.Joins[i].Body.CardHash < state.Joins[j].Body.CardHash })
	return state, validateSnapshot(state)
}
func commitments(state GroupSnapshot) []MemberCommitment {
	members := make([]MemberCommitment, 0, len(state.Members))
	for _, card := range state.Members {
		members = append(members, MemberCommitment{card.ID, cardHashVerified(card)})
	}
	return members
}
func CreateGroup(identity core.Identity, title string) (AnchoredGroup, error) {
	var empty AnchoredGroup
	anchor, err := CreateAnchor(identity)
	if err != nil {
		return empty, err
	}
	state, err := makeSnapshot(anchor.ID, title, []core.PublicIdentity{identity.Public}, nil)
	if err != nil {
		return empty, err
	}
	data, err := core.Canonical(state)
	if err != nil {
		return empty, err
	}
	epoch, err := signCertificate(EpochBody{Domain: "relayloom/group-epoch/1", GroupID: anchor.ID, Number: 0, Previous: nil, State: "open", Members: commitments(state), SnapshotHash: core.Hash(data)}, identity, HeaderBytes)
	if err != nil {
		return empty, err
	}
	if err = VerifySnapshot(state, anchor, epoch); err != nil {
		return empty, err
	}
	return AnchoredGroup{anchor, epoch, state}, nil
}
func CreateInvitation(identity core.Identity, anchor GroupAnchor, parent GroupEpoch, invitee core.PublicIdentity) (GroupInvitation, error) {
	var empty GroupInvitation
	if err := owner(identity, anchor); err != nil {
		return empty, err
	}
	hash, err := MemberCardHash(invitee)
	if err != nil {
		return empty, err
	}
	n, err := nonce()
	if err != nil {
		return empty, err
	}
	body := InvitationBody{Domain: "relayloom/group-invitation/1", GroupID: anchor.ID, ParentEpochID: parent.ID, InviteeID: invitee.ID, InviteeCardHash: hash, InvitationNonce: n}
	cert, err := signCertificate(body, identity, CertificateBytes)
	if err == nil {
		err = VerifyInvitation(cert, anchor, parent, invitee)
	}
	return cert, err
}
func AcceptInvitation(identity core.Identity, anchor GroupAnchor, parent GroupEpoch, invite GroupInvitation) (GroupConsent, error) {
	var empty GroupConsent
	if err := VerifyInvitation(invite, anchor, parent, identity.Public); err != nil {
		return empty, err
	}
	n, err := nonce()
	if err != nil {
		return empty, err
	}
	body := ConsentBody{Domain: "relayloom/group-consent/1", GroupID: anchor.ID, ParentEpochID: parent.ID, InvitationHash: invite.ID, CardHash: cardHashVerified(identity.Public), JoinNonce: n}
	cert, err := signCertificate(body, identity, CertificateBytes)
	if err == nil {
		err = VerifyConsent(cert, anchor, parent, identity.Public)
	}
	return cert, err
}

// Local leave fencing is the caller's durable transaction; this request alone
// never edits the roster or grants authority to another member.
func CreateLeave(identity core.Identity, anchor GroupAnchor, parent GroupEpoch) (GroupLeave, error) {
	n, err := nonce()
	if err != nil {
		return GroupLeave{}, err
	}
	hash, err := MemberCardHash(identity.Public)
	if err != nil {
		return GroupLeave{}, err
	}
	body := LeaveBody{Domain: "relayloom/group-leave/1", GroupID: anchor.ID, ParentEpochID: parent.ID, MemberID: identity.Public.ID, CardHash: hash, LeaveNonce: n}
	cert, err := signCertificate(body, identity, CertificateBytes)
	if err == nil {
		err = VerifyLeave(cert, anchor, parent, identity.Public)
	}
	return cert, err
}
func CreateSuccessor(identity core.Identity, anchor GroupAnchor, parent GroupEpoch, before GroupSnapshot, update Update) (Successor, error) {
	var empty Successor
	if err := owner(identity, anchor); err != nil {
		return empty, err
	}
	if err := VerifySnapshot(before, anchor, parent); err != nil {
		return empty, err
	}
	after, err := makeSnapshot(anchor.ID, update.Title, update.Members, update.Joins)
	if err != nil {
		return empty, err
	}
	data, err := core.Canonical(after)
	if err != nil {
		return empty, err
	}
	previous := parent.ID
	body := EpochBody{Domain: "relayloom/group-epoch/1", GroupID: anchor.ID, Number: parent.Body.Number + 1, Previous: &previous, State: "open", Members: commitments(after), SnapshotHash: core.Hash(data)}
	epoch, err := signCertificate(body, identity, HeaderBytes)
	if err != nil {
		return empty, err
	}
	if _, err = VerifyTransition(anchor, parent, before, epoch, after); err != nil {
		return empty, err
	}
	return Successor{epoch, after}, nil
}
func CloseGroup(identity core.Identity, anchor GroupAnchor, parent GroupEpoch) (GroupEpoch, error) {
	var empty GroupEpoch
	if err := owner(identity, anchor); err != nil {
		return empty, err
	}
	if err := VerifyEpoch(parent, anchor); err != nil {
		return empty, err
	}
	body := parent.Body
	body.Number++
	body.State = "closed"
	previous := parent.ID
	body.Previous = &previous
	body.Members = append([]MemberCommitment{}, body.Members...)
	epoch, err := signCertificate(body, identity, HeaderBytes)
	if err != nil {
		return empty, err
	}
	if _, err = VerifyEpochLink(anchor, parent, epoch); err != nil {
		return empty, err
	}
	return epoch, nil
}
