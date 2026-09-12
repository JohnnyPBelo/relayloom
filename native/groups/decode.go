package groups

import (
	"encoding/json"
	"errors"
	"math"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func object(value any, keys ...string) (map[string]any, error) {
	m, ok := value.(map[string]any)
	if !ok || len(m) != len(keys) {
		return nil, errors.New("campos de grupo inválidos")
	}
	for _, key := range keys {
		if _, exists := m[key]; !exists {
			return nil, errors.New("campo de grupo ausente")
		}
	}
	return m, nil
}
func texts(m map[string]any, keys ...string) ([]string, error) {
	values := make([]string, len(keys))
	for i, key := range keys {
		value, ok := m[key].(string)
		if !ok {
			return nil, errors.New("texto de grupo inválido")
		}
		values[i] = value
	}
	return values, nil
}
func array(value any, minimum, maximum int) ([]any, error) {
	values, ok := value.([]any)
	if !ok || len(values) < minimum || len(values) > maximum {
		return nil, errors.New("lista de grupo fora dos limites")
	}
	return values, nil
}
func decodeCard(value any) (core.PublicIdentity, error) {
	data, err := canonical(value, CertificateBytes)
	if err != nil {
		return core.PublicIdentity{}, err
	}
	card, err := core.DecodePublicIdentity(data)
	if err != nil {
		return card, err
	}
	return card, core.ValidateIdentity(card)
}
func parseCertificate[T any](value any, body func(any) (T, error)) (Certificate[T], error) {
	var empty Certificate[T]
	m, err := object(value, "body", "id", "signature")
	if err != nil {
		return empty, err
	}
	values, err := texts(m, "id", "signature")
	if err != nil {
		return empty, err
	}
	b, err := body(m["body"])
	if err != nil {
		return empty, err
	}
	return Certificate[T]{Body: b, ID: values[0], Signature: values[1]}, nil
}
func decodeCertificate[T any](data []byte, maximum int, body func(any) (T, error)) (Certificate[T], error) {
	value, err := core.DecodeJSON(data, maximum)
	if err != nil {
		return Certificate[T]{}, err
	}
	return parseCertificate(value, body)
}
func parseAnchor(value any) (AnchorBody, error) {
	var empty AnchorBody
	m, err := object(value, "domain", "creator", "nonce", "membershipAuthority")
	if err != nil {
		return empty, err
	}
	v, err := texts(m, "domain", "nonce", "membershipAuthority")
	if err != nil {
		return empty, err
	}
	creator, err := decodeCard(m["creator"])
	if err != nil {
		return empty, err
	}
	return AnchorBody{Domain: v[0], Creator: creator, Nonce: v[1], MembershipAuthority: v[2]}, nil
}
func parseEpoch(value any) (EpochBody, error) {
	var empty EpochBody
	m, err := object(value, "domain", "groupId", "number", "previous", "state", "members", "snapshotHash")
	if err != nil {
		return empty, err
	}
	v, err := texts(m, "domain", "groupId", "state", "snapshotHash")
	if err != nil {
		return empty, err
	}
	number, ok := m["number"].(json.Number)
	if !ok {
		return empty, errors.New("número de época inválido")
	}
	f, err := number.Float64()
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) || f < 0 || f >= EpochLimit {
		return empty, errors.New("número de época inválido")
	}
	var previous *string
	if m["previous"] != nil {
		p, ok := m["previous"].(string)
		if !ok {
			return empty, errors.New("antecessor inválido")
		}
		previous = &p
	}
	raw, err := array(m["members"], 1, MemberLimit)
	if err != nil {
		return empty, err
	}
	members := make([]MemberCommitment, 0, len(raw))
	for _, item := range raw {
		member, err := object(item, "id", "cardHash")
		if err != nil {
			return empty, err
		}
		fields, err := texts(member, "id", "cardHash")
		if err != nil {
			return empty, err
		}
		members = append(members, MemberCommitment{ID: fields[0], CardHash: fields[1]})
	}
	return EpochBody{Domain: v[0], GroupID: v[1], Number: int(f), Previous: previous, State: v[2], Members: members, SnapshotHash: v[3]}, nil
}
func parseInvitation(value any) (InvitationBody, error) {
	var empty InvitationBody
	m, err := object(value, "domain", "groupId", "parentEpochId", "inviteeId", "inviteeCardHash", "invitationNonce")
	if err != nil {
		return empty, err
	}
	v, err := texts(m, "domain", "groupId", "parentEpochId", "inviteeId", "inviteeCardHash", "invitationNonce")
	if err != nil {
		return empty, err
	}
	return InvitationBody{v[0], v[1], v[2], v[3], v[4], v[5]}, nil
}
func parseConsent(value any) (ConsentBody, error) {
	var empty ConsentBody
	m, err := object(value, "domain", "groupId", "parentEpochId", "invitationHash", "cardHash", "joinNonce")
	if err != nil {
		return empty, err
	}
	v, err := texts(m, "domain", "groupId", "parentEpochId", "invitationHash", "cardHash", "joinNonce")
	if err != nil {
		return empty, err
	}
	return ConsentBody{v[0], v[1], v[2], v[3], v[4], v[5]}, nil
}
func parseLeave(value any) (LeaveBody, error) {
	var empty LeaveBody
	m, err := object(value, "domain", "groupId", "parentEpochId", "memberId", "cardHash", "leaveNonce")
	if err != nil {
		return empty, err
	}
	v, err := texts(m, "domain", "groupId", "parentEpochId", "memberId", "cardHash", "leaveNonce")
	if err != nil {
		return empty, err
	}
	return LeaveBody{v[0], v[1], v[2], v[3], v[4], v[5]}, nil
}
func parseSnapshot(value any) (GroupSnapshot, error) {
	var empty GroupSnapshot
	m, err := object(value, "domain", "groupId", "salt", "title", "members", "joins")
	if err != nil {
		return empty, err
	}
	v, err := texts(m, "domain", "groupId", "salt", "title")
	if err != nil {
		return empty, err
	}
	raw, err := array(m["members"], 1, MemberLimit)
	if err != nil {
		return empty, err
	}
	members := make([]core.PublicIdentity, 0, len(raw))
	for _, item := range raw {
		card, err := decodeCard(item)
		if err != nil {
			return empty, err
		}
		members = append(members, card)
	}
	rawJoins, err := array(m["joins"], 0, MemberLimit)
	if err != nil {
		return empty, err
	}
	joins := make([]GroupConsent, 0, len(rawJoins))
	for _, item := range rawJoins {
		consent, err := parseCertificate(item, parseConsent)
		if err != nil {
			return empty, err
		}
		joins = append(joins, consent)
	}
	return GroupSnapshot{Domain: v[0], GroupID: v[1], Salt: v[2], Title: v[3], Members: members, Joins: joins}, nil
}

// Decode entry points retain exact schema/UTF-16 handling through core.DecodeJSON
// and verify signatures before returning a usable certificate.
func DecodeAnchor(data []byte) (GroupAnchor, error) {
	cert, err := decodeCertificate(data, CertificateBytes, parseAnchor)
	if err == nil {
		err = VerifyAnchor(cert)
	}
	if err != nil {
		return GroupAnchor{}, err
	}
	return cert, nil
}
func DecodeEpoch(data []byte, anchor GroupAnchor) (GroupEpoch, error) {
	cert, err := decodeCertificate(data, HeaderBytes, parseEpoch)
	if err == nil {
		err = VerifyEpoch(cert, anchor)
	}
	if err != nil {
		return GroupEpoch{}, err
	}
	return cert, nil
}
func DecodeInvitation(data []byte, anchor GroupAnchor, parent GroupEpoch, member core.PublicIdentity) (GroupInvitation, error) {
	cert, err := decodeCertificate(data, CertificateBytes, parseInvitation)
	if err == nil {
		err = VerifyInvitation(cert, anchor, parent, member)
	}
	if err != nil {
		return GroupInvitation{}, err
	}
	return cert, nil
}
func DecodeConsent(data []byte, anchor GroupAnchor, parent GroupEpoch, member core.PublicIdentity) (GroupConsent, error) {
	cert, err := decodeCertificate(data, CertificateBytes, parseConsent)
	if err == nil {
		err = VerifyConsent(cert, anchor, parent, member)
	}
	if err != nil {
		return GroupConsent{}, err
	}
	return cert, nil
}
func DecodeLeave(data []byte, anchor GroupAnchor, parent GroupEpoch, member core.PublicIdentity) (GroupLeave, error) {
	cert, err := decodeCertificate(data, CertificateBytes, parseLeave)
	if err == nil {
		err = VerifyLeave(cert, anchor, parent, member)
	}
	if err != nil {
		return GroupLeave{}, err
	}
	return cert, nil
}
func DecodeSnapshot(data []byte, anchor GroupAnchor, epoch GroupEpoch) (GroupSnapshot, error) {
	value, err := core.DecodeJSON(data, SnapshotBytes)
	if err != nil {
		return GroupSnapshot{}, err
	}
	state, err := parseSnapshot(value)
	if err == nil {
		err = VerifySnapshot(state, anchor, epoch)
	}
	if err != nil {
		return GroupSnapshot{}, err
	}
	return state, nil
}
