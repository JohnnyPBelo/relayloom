package groups

import (
	"bytes"
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func addresses(values ...string) bool {
	for _, value := range values {
		if !core.ValidAddress(value) {
			return false
		}
	}
	return true
}
func validNonce(value string) bool { _, err := decode64(value, 32, 44); return err == nil }
func equalCanonical(a, b any) bool {
	left, e1 := core.Canonical(a)
	right, e2 := core.Canonical(b)
	return e1 == nil && e2 == nil && bytes.Equal(left, right)
}
func VerifyAnchor(anchor GroupAnchor) error {
	b := anchor.Body
	if b.Domain != "relayloom/group-anchor/1" || b.MembershipAuthority != "creator-only" || !validNonce(b.Nonce) {
		return errors.New("versão ou autoridade de grupo inválida")
	}
	return verifyCertificate(anchor, b.Creator, CertificateBytes)
}
func VerifyEpoch(epoch GroupEpoch, anchor GroupAnchor) error {
	if err := VerifyAnchor(anchor); err != nil {
		return err
	}
	b := epoch.Body
	if b.Domain != "relayloom/group-epoch/1" || b.GroupID != anchor.ID || !addresses(b.GroupID, b.SnapshotHash) || b.Number < 0 || b.Number >= EpochLimit || (b.State != "open" && b.State != "closed") || (b.Number == EpochLimit-1 && b.State != "closed") {
		return errors.New("época de grupo inválida")
	}
	if (b.Number == 0 && b.Previous != nil) || (b.Number > 0 && (b.Previous == nil || !addresses(*b.Previous))) {
		return errors.New("antecessor de época inválido")
	}
	if len(b.Members) < 1 || len(b.Members) > MemberLimit {
		return errors.New("limite de membros excedido")
	}
	previous, creator := "", false
	for _, member := range b.Members {
		if !addresses(member.ID, member.CardHash) || member.ID <= previous {
			return errors.New("membros inválidos, repetidos ou fora de ordem")
		}
		previous = member.ID
		creator = creator || member.ID == anchor.Body.Creator.ID
	}
	if !creator {
		return errors.New("época não conserva o criador")
	}
	if b.Number == 0 && (b.State != "open" || len(b.Members) != 1 || b.Members[0].CardHash != cardHashVerified(anchor.Body.Creator)) {
		return errors.New("época inicial deve conter apenas o cartão original do criador")
	}
	return verifyCertificate(epoch, anchor.Body.Creator, HeaderBytes)
}
func VerifyInvitation(invite GroupInvitation, anchor GroupAnchor, parent GroupEpoch, invitee core.PublicIdentity) error {
	if err := VerifyEpoch(parent, anchor); err != nil {
		return err
	}
	if parent.Body.State != "open" {
		return errors.New("grupo encerrado")
	}
	cardHash, err := MemberCardHash(invitee)
	if err != nil {
		return err
	}
	b := invite.Body
	if b.Domain != "relayloom/group-invitation/1" || b.GroupID != anchor.ID || b.ParentEpochID != parent.ID || b.InviteeID != invitee.ID || b.InviteeCardHash != cardHash || !addresses(b.GroupID, b.ParentEpochID, b.InviteeID, b.InviteeCardHash) || !validNonce(b.InvitationNonce) {
		return errors.New("convite não corresponde ao grupo, época ou cartão")
	}
	return verifyCertificate(invite, anchor.Body.Creator, CertificateBytes)
}
func verifyConsentBody(consent GroupConsent, member core.PublicIdentity) error {
	b := consent.Body
	cardHash, err := MemberCardHash(member)
	if err != nil {
		return err
	}
	if b.Domain != "relayloom/group-consent/1" || !addresses(b.GroupID, b.ParentEpochID, b.InvitationHash, b.CardHash) || b.CardHash != cardHash || !validNonce(b.JoinNonce) {
		return errors.New("consentimento inválido")
	}
	return verifyCertificate(consent, member, CertificateBytes)
}
func VerifyConsent(consent GroupConsent, anchor GroupAnchor, parent GroupEpoch, member core.PublicIdentity) error {
	if err := VerifyEpoch(parent, anchor); err != nil {
		return err
	}
	if parent.Body.State != "open" || consent.Body.GroupID != anchor.ID || consent.Body.ParentEpochID != parent.ID {
		return errors.New("consentimento de outro grupo ou época")
	}
	return verifyConsentBody(consent, member)
}
func VerifyLeave(leave GroupLeave, anchor GroupAnchor, parent GroupEpoch, member core.PublicIdentity) error {
	if err := VerifyEpoch(parent, anchor); err != nil {
		return err
	}
	cardHash, err := MemberCardHash(member)
	if err != nil {
		return err
	}
	b := leave.Body
	if b.Domain != "relayloom/group-leave/1" || parent.Body.State != "open" || member.ID == anchor.Body.Creator.ID || b.GroupID != anchor.ID || b.ParentEpochID != parent.ID || b.MemberID != member.ID || b.CardHash != cardHash || !validNonce(b.LeaveNonce) {
		return errors.New("pedido de saída inválido")
	}
	present := false
	for _, current := range parent.Body.Members {
		present = present || current.ID == member.ID && current.CardHash == cardHash
	}
	if !present {
		return errors.New("pedido de saída sem participação actual")
	}
	return verifyCertificate(leave, member, CertificateBytes)
}
func validateSnapshot(state GroupSnapshot) error {
	if state.Domain != "relayloom/group-state/1" || !addresses(state.GroupID) || !validNonce(state.Salt) || utf16Length(state.Title) > 256 || len(state.Members) < 1 || len(state.Members) > MemberLimit || state.Joins == nil || len(state.Joins) > MemberLimit {
		return errors.New("estado de grupo inválido")
	}
	previous := ""
	cards := make(map[string]core.PublicIdentity, len(state.Members))
	for _, card := range state.Members {
		hash, err := MemberCardHash(card)
		if err != nil {
			return err
		}
		if card.ID <= previous {
			return errors.New("cartões repetidos ou fora de ordem")
		}
		previous = card.ID
		cards[hash] = card
	}
	previous = ""
	for _, consent := range state.Joins {
		card, exists := cards[consent.Body.CardHash]
		if !exists || consent.Body.GroupID != state.GroupID || consent.Body.CardHash <= previous {
			return errors.New("consentimentos repetidos ou sem cartão correspondente")
		}
		if err := verifyConsentBody(consent, card); err != nil {
			return err
		}
		previous = consent.Body.CardHash
	}
	_, err := canonical(state, SnapshotBytes)
	return err
}
func VerifySnapshot(state GroupSnapshot, anchor GroupAnchor, epoch GroupEpoch) error {
	if err := VerifyEpoch(epoch, anchor); err != nil {
		return err
	}
	if err := validateSnapshot(state); err != nil {
		return err
	}
	data, err := core.Canonical(state)
	if err != nil {
		return err
	}
	if state.GroupID != anchor.ID || core.Hash(data) != epoch.Body.SnapshotHash {
		return errors.New("estado não corresponde ao compromisso assinado")
	}
	roster := make([]MemberCommitment, 0, len(state.Members))
	for _, card := range state.Members {
		roster = append(roster, MemberCommitment{card.ID, cardHashVerified(card)})
	}
	if !equalCanonical(roster, epoch.Body.Members) {
		return errors.New("estado altera os cartões aprovados")
	}
	if epoch.Body.Number == 0 && len(state.Joins) != 0 {
		return errors.New("época inicial contém consentimentos")
	}
	if epoch.Body.Number > 0 && epoch.Body.State == "open" {
		for _, consent := range state.Joins {
			if consent.Body.ParentEpochID != *epoch.Body.Previous {
				return errors.New("consentimento de outra transição")
			}
		}
	}
	return nil
}
func VerifyEpochLink(anchor GroupAnchor, parent, next GroupEpoch) (TransitionKind, error) {
	if err := VerifyEpoch(parent, anchor); err != nil {
		return "", err
	}
	if err := VerifyEpoch(next, anchor); err != nil {
		return "", err
	}
	if parent.Body.State != "open" || next.Body.Number != parent.Body.Number+1 || next.Body.Previous == nil || *next.Body.Previous != parent.ID {
		return "", errors.New("cadeia de épocas descontínua ou encerrada")
	}
	if next.Body.State == "closed" {
		if !equalCanonical(parent.Body.Members, next.Body.Members) || parent.Body.SnapshotHash != next.Body.SnapshotHash {
			return "", errors.New("encerramento deve conservar o estado histórico")
		}
		return Restrictive, nil
	}
	current := make(map[string]string, len(next.Body.Members))
	for _, member := range next.Body.Members {
		current[member.ID] = member.CardHash
	}
	for _, member := range parent.Body.Members {
		if current[member.ID] != member.CardHash {
			return Restrictive, nil
		}
	}
	return Nonrestrictive, nil
}
func ClassifyEpochPath(anchor GroupAnchor, path []GroupEpoch) (TransitionKind, error) {
	if len(path) < 1 || len(path) > EpochLimit {
		return "", errors.New("caminho de épocas fora dos limites")
	}
	if err := VerifyEpoch(path[0], anchor); err != nil {
		return "", err
	}
	kind := Nonrestrictive
	for i := 1; i < len(path); i++ {
		link, err := VerifyEpochLink(anchor, path[i-1], path[i])
		if err != nil {
			return "", err
		}
		if link == Restrictive {
			kind = Restrictive
		}
	}
	return kind, nil
}
func VerifyTransition(anchor GroupAnchor, parent GroupEpoch, before GroupSnapshot, next GroupEpoch, after GroupSnapshot) (TransitionKind, error) {
	if err := VerifySnapshot(before, anchor, parent); err != nil {
		return "", err
	}
	return VerifySnapshotTransition(anchor, parent, next, after)
}

// VerifySnapshotTransition needs an anchored parent header, not its old private snapshot or reading keys.
func VerifySnapshotTransition(anchor GroupAnchor, parent GroupEpoch, next GroupEpoch, after GroupSnapshot) (TransitionKind, error) {
	kind, err := VerifyEpochLink(anchor, parent, next)
	if err != nil {
		return "", err
	}
	if err = VerifySnapshot(after, anchor, next); err != nil {
		return "", err
	}
	if next.Body.State == "closed" {
		return kind, nil
	}
	oldCards := make(map[string]string, len(parent.Body.Members))
	for _, member := range parent.Body.Members {
		oldCards[member.ID] = member.CardHash
	}
	consents := make(map[string]GroupConsent, len(after.Joins))
	for _, consent := range after.Joins {
		consents[consent.Body.CardHash] = consent
	}
	changed := 0
	for _, card := range after.Members {
		hash := cardHashVerified(card)
		if oldCards[card.ID] == hash {
			continue
		}
		changed++
		consent, exists := consents[hash]
		if !exists {
			return "", errors.New("falta consentimento do membro")
		}
		if err = VerifyConsent(consent, anchor, parent, card); err != nil {
			return "", err
		}
	}
	if changed != len(after.Joins) {
		return "", errors.New("a alteração exige exactamente os consentimentos dos novos cartões")
	}
	return kind, nil
}
