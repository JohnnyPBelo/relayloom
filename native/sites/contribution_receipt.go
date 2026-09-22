package sites

import (
	"encoding/base64"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"sort"
)

const ContributionReceiptBytes = 8192
const ContributionReceiptLifetimeMS int64 = 30 * 86400000

var receiptFields = []string{"contributorId", "certificateId", "operationId", "target", "proposalCreated", "proposalExpires", "verifiedAt", "created", "expires"}

func receiptError() error { return errors.New("recibo de proposta inválido") }
func receiptBody(value any) (map[string]any, core.PublicIdentity, error) {
	var none core.PublicIdentity
	fields := append([]string{"domain", "owner"}, receiptFields...)
	b, err := object(value, fields...)
	if err != nil || b["domain"] != "relayloom/site-contribution-receipt/1" {
		return nil, none, receiptError()
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
		return nil, none, receiptError()
	}
	target, err := contributionTarget(b["target"])
	if err != nil {
		return nil, none, err
	}
	actualOwner, _, _ := ParseAddress(docTextValue(target["site"]))
	if actualOwner != owner.ID {
		return nil, none, receiptError()
	}
	times := map[string]int64{}
	for _, k := range []string{"proposalCreated", "proposalExpires", "verifiedAt", "created", "expires"} {
		n, err := contributionClock(b[k])
		if err != nil {
			return nil, none, err
		}
		times[k] = n
	}
	pc, pe, verified, created, expires := times["proposalCreated"], times["proposalExpires"], times["verifiedAt"], times["created"], times["expires"]
	if pe <= pc || pe-pc > ContributionLifetimeMS || verified >= pe || pc-verified > ContributionClockSkewMS || created != verified || expires <= created || expires-created > ContributionReceiptLifetimeMS {
		return nil, none, receiptError()
	}
	if _, err = bounded(b, ContributionReceiptBytes); err != nil {
		return nil, none, err
	}
	return b, owner, nil
}

// VerifyContributionReceipt authenticates a historical attestation. It grants no
// site edit authority, transport permission or extension of a visitor's grant.
func VerifyContributionReceipt(value any) (map[string]any, error) {
	cert, err := object(value, "body", "id", "signature")
	if err != nil {
		return nil, receiptError()
	}
	body, owner, err := receiptBody(cert["body"])
	if err != nil {
		return nil, err
	}
	data, err := bounded(body, ContributionReceiptBytes)
	if err != nil {
		return nil, err
	}
	id, signature := docTextValue(cert["id"]), docTextValue(cert["signature"])
	if !core.ValidAddress(id) || id != core.Hash(data) || len(signature) != 88 {
		return nil, receiptError()
	}
	bytes, err := base64.StdEncoding.Strict().DecodeString(signature)
	if err != nil || len(bytes) != 64 || base64.StdEncoding.EncodeToString(bytes) != signature {
		return nil, receiptError()
	}
	if err = core.VerifyCertificateData(owner, data, bytes); err != nil {
		return nil, err
	}
	if _, err = bounded(cert, ContributionReceiptBytes); err != nil {
		return nil, err
	}
	return resourceClone(cert)
}

// A signing-owned journal must authorize this internal operation; no RPC exposes it.
func CreateContributionReceipt(identity core.Identity, input any) (map[string]any, error) {
	q, err := object(input, receiptFields...)
	if err != nil {
		return nil, receiptError()
	}
	body := map[string]any{"domain": "relayloom/site-contribution-receipt/1", "owner": identity.Public}
	for k, v := range q {
		body[k] = v
	}
	if _, _, err = receiptBody(body); err != nil {
		return nil, err
	}
	data, err := bounded(body, ContributionReceiptBytes)
	if err != nil {
		return nil, err
	}
	signature, err := core.SignCertificateData(identity, data)
	if err != nil {
		return nil, err
	}
	return VerifyContributionReceipt(map[string]any{"body": body, "id": core.Hash(data), "signature": base64.StdEncoding.EncodeToString(signature)})
}
func MatchContributionReceipt(value, proposalValue any) (map[string]any, error) {
	receipt, err := VerifyContributionReceipt(value)
	if err != nil {
		return nil, err
	}
	proposal, err := VerifyContribution(proposalValue)
	if err != nil {
		return nil, err
	}
	r, b := receipt["body"].(map[string]any), proposal["body"].(map[string]any)
	if r["certificateId"] != proposal["id"] || r["contributorId"] != b["contributor"].(map[string]any)["id"] || r["operationId"] != b["operationId"] || !creationEqual(r["target"], b["target"]) || !creationEqual(r["proposalCreated"], b["created"]) || !creationEqual(r["proposalExpires"], b["expires"]) {
		return nil, receiptError()
	}
	return receipt, nil
}
func ParseContributionReceiptContent(input any) (map[string]any, error) {
	m, err := object(input, "type", "receipt")
	if err != nil || m["type"] != "site-contribution-receipt" {
		return nil, receiptError()
	}
	cert, err := VerifyContributionReceipt(m["receipt"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"type": "site-contribution-receipt", "receipt": cert}, nil
}

// Caller must authenticate/decrypt the outer bundle and enforce live policy.
func MatchContributionReceiptEnvelope(bundle core.Bundle, plaintext any) (map[string]any, error) {
	content, err := ParseContributionReceiptContent(plaintext)
	if err != nil {
		return nil, err
	}
	b := content["receipt"].(map[string]any)["body"].(map[string]any)
	owner := b["owner"].(map[string]any)
	expected := []string{docTextValue(owner["id"])}
	if b["contributorId"] != owner["id"] {
		expected = append(expected, docTextValue(b["contributorId"]))
	}
	sort.Strings(expected)
	created, _ := contributionClock(b["created"])
	expires, _ := contributionClock(b["expires"])
	m := bundle.Manifest
	if m.Kind != "site-contribution-receipt" || !creationEqual(m.Author, owner) || m.PublicKey != nil || !creationEqual(readersOf(bundle), expected) || m.Created != created || m.Expires != expires {
		return nil, receiptError()
	}
	return content, nil
}
