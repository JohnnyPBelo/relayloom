// Package groups implements the signed membership certificates described in
// docs/GROUP-EPOCHS.md. A verified certificate is not proof of a globally latest
// head, and this package does not itself provide persistence or group admission.
package groups

import "github.com/JohnnyPBelo/relayloom/native/core"

const (
	MemberLimit      = 64
	EpochLimit       = 1024
	CertificateBytes = 2048
	HeaderBytes      = 16384
	SnapshotBytes    = 524288
)

type Certificate[T any] struct {
	Body      T      `json:"body"`
	ID        string `json:"id"`
	Signature string `json:"signature"`
}
type AnchorBody struct {
	Domain              string              `json:"domain"`
	Creator             core.PublicIdentity `json:"creator"`
	Nonce               string              `json:"nonce"`
	MembershipAuthority string              `json:"membershipAuthority"`
}
type GroupAnchor = Certificate[AnchorBody]
type MemberCommitment struct {
	ID       string `json:"id"`
	CardHash string `json:"cardHash"`
}
type EpochBody struct {
	Domain       string             `json:"domain"`
	GroupID      string             `json:"groupId"`
	Number       int                `json:"number"`
	Previous     *string            `json:"previous"`
	State        string             `json:"state"`
	Members      []MemberCommitment `json:"members"`
	SnapshotHash string             `json:"snapshotHash"`
}
type GroupEpoch = Certificate[EpochBody]
type InvitationBody struct {
	Domain          string `json:"domain"`
	GroupID         string `json:"groupId"`
	ParentEpochID   string `json:"parentEpochId"`
	InviteeID       string `json:"inviteeId"`
	InviteeCardHash string `json:"inviteeCardHash"`
	InvitationNonce string `json:"invitationNonce"`
}
type GroupInvitation = Certificate[InvitationBody]
type ConsentBody struct {
	Domain         string `json:"domain"`
	GroupID        string `json:"groupId"`
	ParentEpochID  string `json:"parentEpochId"`
	InvitationHash string `json:"invitationHash"`
	CardHash       string `json:"cardHash"`
	JoinNonce      string `json:"joinNonce"`
}
type GroupConsent = Certificate[ConsentBody]
type LeaveBody struct {
	Domain        string `json:"domain"`
	GroupID       string `json:"groupId"`
	ParentEpochID string `json:"parentEpochId"`
	MemberID      string `json:"memberId"`
	CardHash      string `json:"cardHash"`
	LeaveNonce    string `json:"leaveNonce"`
}
type GroupLeave = Certificate[LeaveBody]
type GroupSnapshot struct {
	Domain  string                `json:"domain"`
	GroupID string                `json:"groupId"`
	Salt    string                `json:"salt"`
	Title   string                `json:"title"`
	Members []core.PublicIdentity `json:"members"`
	Joins   []GroupConsent        `json:"joins"`
}
type AnchoredGroup struct {
	Anchor   GroupAnchor   `json:"anchor"`
	Epoch    GroupEpoch    `json:"epoch"`
	Snapshot GroupSnapshot `json:"snapshot"`
}
type Successor struct {
	Epoch    GroupEpoch    `json:"epoch"`
	Snapshot GroupSnapshot `json:"snapshot"`
}
type Update struct {
	Title   string
	Members []core.PublicIdentity
	Joins   []GroupConsent
}
type TransitionKind string

const (
	Nonrestrictive TransitionKind = "nonrestrictive"
	Restrictive    TransitionKind = "restrictive"
)
