package sites

import (
	"encoding/base64"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"sort"
)

const ContributionRejectionBytes = 8192
const ContributionRejectionReasonUnits = 512
const ContributionRejectionLifetimeMS int64 = 30 * 86400000

var rejectionFields = []string{"contributorId", "certificateId", "operationId", "target", "proposalCreated", "proposalExpires", "decidedAt", "reason", "expires"}

func ParseContributionRejectionReason(value any) (string, error) {
	reason, ok := value.(string)
	if !ok || docLength(reason) > ContributionRejectionReasonUnits {
		return "", rejectionError()
	}
	return reason, nil
}
func rejectionError() error { return errors.New("recusa de proposta inválida") }
func rejectionBody(value any) (map[string]any, core.PublicIdentity, error) {
	var none core.PublicIdentity
	fields := append([]string{"domain", "owner"}, rejectionFields...)
	b, err := object(value, fields...)
	if err != nil || b["domain"] != "relayloom/site-contribution-rejection/1" {
		return nil, none, rejectionError()
	}
	card, err := bounded(b["owner"], CertificateBytes)
	if err != nil {
		return nil, none, err
	}
	owner, err := core.DecodePublicIdentity(card)
	if err != nil {
		return nil, none, err
	}
	if !core.ValidAddress(docTextValue(b["contributorId"])) || !core.ValidAddress(docTextValue(b["certificateId"])) || !contributionOperationPattern.MatchString(docTextValue(b["operationId"])) {
		return nil, none, rejectionError()
	}
	target, err := contributionTarget(b["target"])
	if err != nil {
		return nil, none, err
	}
	actualOwner, _, _ := ParseAddress(docTextValue(target["site"]))
	if actualOwner != owner.ID {
		return nil, none, rejectionError()
	}
	times := map[string]int64{}
	for _, k := range []string{"proposalCreated", "proposalExpires", "decidedAt", "expires"} {
		n, err := contributionClock(b[k])
		if err != nil {
			return nil, none, err
		}
		times[k] = n
	}
	pc, pe, decided, expires := times["proposalCreated"], times["proposalExpires"], times["decidedAt"], times["expires"]
	if pe <= pc || pe-pc > ContributionLifetimeMS || pc-decided > ContributionClockSkewMS || expires <= decided || expires-decided > ContributionRejectionLifetimeMS {
		return nil, none, rejectionError()
	}
	if _, err := ParseContributionRejectionReason(b["reason"]); err != nil {
		return nil, none, rejectionError()
	}
	if _, err = bounded(b, ContributionRejectionBytes); err != nil {
		return nil, none, err
	}
	return b, owner, nil
}

// VerifyContributionRejection authenticates an explicit refusal. It asserts no
// verification of the source, includes no proposal values, and grants neither
// site edit authority nor an extension of a visitor's grant. A late refusal is
// still historical, without becoming a new grant or authorizing transport.
func VerifyContributionRejection(value any) (map[string]any, error) {
	cert, err := object(value, "body", "id", "signature")
	if err != nil {
		return nil, rejectionError()
	}
	body, owner, err := rejectionBody(cert["body"])
	if err != nil {
		return nil, err
	}
	data, err := bounded(body, ContributionRejectionBytes)
	if err != nil {
		return nil, err
	}
	id, signature := docTextValue(cert["id"]), docTextValue(cert["signature"])
	if !core.ValidAddress(id) || id != core.Hash(data) || len(signature) != 88 {
		return nil, rejectionError()
	}
	bytes, err := base64.StdEncoding.Strict().DecodeString(signature)
	if err != nil || len(bytes) != 64 || base64.StdEncoding.EncodeToString(bytes) != signature {
		return nil, rejectionError()
	}
	if err = core.VerifyCertificateData(owner, data, bytes); err != nil {
		return nil, err
	}
	if _, err = bounded(cert, ContributionRejectionBytes); err != nil {
		return nil, err
	}
	return resourceClone(cert)
}

// A signing-owned journal must authorize this internal operation; no RPC exposes it.
func CreateContributionRejection(identity core.Identity, input any) (map[string]any, error) {
	q, err := object(input, rejectionFields...)
	if err != nil {
		return nil, rejectionError()
	}
	body := map[string]any{"domain": "relayloom/site-contribution-rejection/1", "owner": identity.Public}
	for k, v := range q {
		body[k] = v
	}
	if _, _, err = rejectionBody(body); err != nil {
		return nil, err
	}
	data, err := bounded(body, ContributionRejectionBytes)
	if err != nil {
		return nil, err
	}
	signature, err := core.SignCertificateData(identity, data)
	if err != nil {
		return nil, err
	}
	return VerifyContributionRejection(map[string]any{"body": body, "id": core.Hash(data), "signature": base64.StdEncoding.EncodeToString(signature)})
}
func MatchContributionRejection(value, proposalValue any) (map[string]any, error) {
	rejection, err := VerifyContributionRejection(value)
	if err != nil {
		return nil, err
	}
	proposal, err := VerifyContribution(proposalValue)
	if err != nil {
		return nil, err
	}
	r, b := rejection["body"].(map[string]any), proposal["body"].(map[string]any)
	if r["certificateId"] != proposal["id"] || r["contributorId"] != b["contributor"].(map[string]any)["id"] || r["operationId"] != b["operationId"] || !creationEqual(r["target"], b["target"]) || !creationEqual(r["proposalCreated"], b["created"]) || !creationEqual(r["proposalExpires"], b["expires"]) {
		return nil, rejectionError()
	}
	return rejection, nil
}
func ParseContributionRejectionContent(input any) (map[string]any, error) {
	m, err := object(input, "type", "rejection")
	if err != nil || m["type"] != "site-contribution-rejection" {
		return nil, rejectionError()
	}
	cert, err := VerifyContributionRejection(m["rejection"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"type": "site-contribution-rejection", "rejection": cert}, nil
}

// Caller must authenticate/decrypt the outer bundle and enforce live policy.
func MatchContributionRejectionEnvelope(bundle core.Bundle, plaintext any) (map[string]any, error) {
	content, err := ParseContributionRejectionContent(plaintext)
	if err != nil {
		return nil, err
	}
	b := content["rejection"].(map[string]any)["body"].(map[string]any)
	owner := b["owner"].(map[string]any)
	expected := []string{docTextValue(owner["id"])}
	if b["contributorId"] != owner["id"] {
		expected = append(expected, docTextValue(b["contributorId"]))
	}
	sort.Strings(expected)
	created, _ := contributionClock(b["decidedAt"])
	expires, _ := contributionClock(b["expires"])
	m := bundle.Manifest
	if m.Kind != "site-contribution-rejection" || !creationEqual(m.Author, owner) || m.PublicKey != nil || !creationEqual(readersOf(bundle), expected) || m.Created != created || m.Expires != expires {
		return nil, rejectionError()
	}
	return content, nil
}

func ValidateContributionRejectionRequest(input any, owner core.PublicIdentity) (map[string]any, error) {
	q, err := object(input, rejectionFields...)
	if err != nil {
		return nil, rejectionError()
	}
	b := map[string]any{"domain": "relayloom/site-contribution-rejection/1", "owner": owner}
	for k, v := range q {
		b[k] = v
	}
	if _, _, err = rejectionBody(b); err != nil {
		return nil, err
	}
	return resourceClone(q)
}
