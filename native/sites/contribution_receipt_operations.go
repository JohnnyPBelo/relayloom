package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

const ReceiptStageBytes = 64 * 1024
const ReceiptTotalStageBytes = 4 * 1024 * 1024

func receiptOperationError() error { return errors.New("registo de recibo inválido") }
func receiptIntentHash(owner, recipient, request any) string {
	bytes, _ := core.Canonical(map[string]any{"domain": "relayloom/contribution-receipt-intent/1", "owner": owner, "recipient": recipient, "request": request})
	return core.Hash(bytes)
}
func receiptStageDescriptor(value any) (map[string]any, error) {
	p, err := object(value, "hash", "bytes")
	if err != nil {
		return nil, receiptOperationError()
	}
	n, e := creationNumber(p["bytes"])
	if e != nil || n > ReceiptStageBytes || !core.ValidAddress(docTextValue(p["hash"])) {
		return nil, receiptOperationError()
	}
	return p, nil
}
func receiptCard(value any) (core.PublicIdentity, error) {
	data, err := bounded(value, CertificateBytes)
	if err != nil {
		return core.PublicIdentity{}, err
	}
	return core.DecodePublicIdentity(data)
}
func ValidateReceiptOperation(value any, owner string, entry map[string]any) (map[string]any, error) {
	fields := []string{"owner", "recipient", "request", "fingerprint", "phase", "certificateId", "stage"}
	if m, ok := value.(map[string]any); ok {
		if _, found := m["transport"]; found {
			fields = append(fields, "transport")
		}
	}
	op, err := object(value, fields...)
	if err != nil {
		return nil, receiptOperationError()
	}
	card, err := receiptCard(op["owner"])
	if err != nil || card.ID != owner {
		return nil, receiptOperationError()
	}
	recipient, err := receiptCard(op["recipient"])
	if err != nil {
		return nil, err
	}
	q, err := ValidateContributionReceiptRequest(op["request"], card)
	if err != nil {
		return nil, err
	}
	verified, _ := contributionClock(q["verifiedAt"])
	expires, _ := contributionClock(q["expires"])
	if q["certificateId"] != entry["id"] || q["contributorId"] != entry["contributorId"] || q["contributorId"] != recipient.ID || q["operationId"] != entry["operationId"] || !creationEqual(q["target"], entry["target"]) || !creationEqual(q["proposalCreated"], entry["created"]) || !creationEqual(q["proposalExpires"], entry["expires"]) || !creationEqual(q["verifiedAt"], entry["verifiedAt"]) || expires != min(MaxSequence, verified+ContributionReceiptLifetimeMS) {
		return nil, receiptOperationError()
	}
	if op["fingerprint"] != receiptIntentHash(op["owner"], op["recipient"], q) {
		return nil, receiptOperationError()
	}
	phase := docTextValue(op["phase"])
	if !docContains([]string{"prepared", "signed", "queued", "expired"}, phase) {
		return nil, receiptOperationError()
	}
	if op["certificateId"] != nil && !core.ValidAddress(docTextValue(op["certificateId"])) {
		return nil, receiptOperationError()
	}
	transport, hasTransport := op["transport"]
	if phase == "prepared" {
		if op["certificateId"] != nil || op["stage"] != nil || hasTransport {
			return nil, receiptOperationError()
		}
	} else if phase == "expired" {
		if op["stage"] != nil {
			return nil, receiptOperationError()
		}
	} else {
		if !core.ValidAddress(docTextValue(op["certificateId"])) {
			return nil, receiptOperationError()
		}
		if _, err = receiptStageDescriptor(op["stage"]); err != nil {
			return nil, err
		}
	}
	if hasTransport {
		t, e := object(transport, "bundleId", "bundleHash", "copied")
		if e != nil || (phase != "queued" && phase != "expired") || !core.ValidAddress(docTextValue(op["certificateId"])) {
			return nil, receiptOperationError()
		}
		if !core.ValidAddress(docTextValue(t["bundleId"])) || !core.ValidAddress(docTextValue(t["bundleHash"])) {
			return nil, receiptOperationError()
		}
		if _, ok := t["copied"].(bool); !ok {
			return nil, receiptOperationError()
		}
	}
	if phase == "queued" && !hasTransport {
		return nil, receiptOperationError()
	}
	return resourceClone(op)
}
func PrepareReceiptOperation(owner core.PublicIdentity, entry map[string]any, input any) (map[string]any, error) {
	p, err := VerifyContribution(input)
	if err != nil {
		return nil, err
	}
	b := p["body"].(map[string]any)
	verified, err := contributionClock(entry["verifiedAt"])
	if err != nil {
		return nil, receiptOperationError()
	}
	q := map[string]any{"contributorId": b["contributor"].(map[string]any)["id"], "certificateId": p["id"], "operationId": b["operationId"], "target": b["target"], "proposalCreated": b["created"], "proposalExpires": b["expires"], "verifiedAt": verified, "created": verified, "expires": min(MaxSequence, verified+ContributionReceiptLifetimeMS)}
	return ValidateReceiptOperation(map[string]any{"owner": owner, "recipient": b["contributor"], "request": q, "fingerprint": receiptIntentHash(owner, b["contributor"], q), "phase": "prepared", "certificateId": nil, "stage": nil}, owner.ID, entry)
}
func CheckReceiptOperationCertificate(value any, owner string, entry map[string]any, certificate any) (map[string]any, error) {
	op, err := ValidateReceiptOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	signed, err := VerifyContributionReceipt(certificate)
	if err != nil {
		return nil, err
	}
	body := signed["body"].(map[string]any)
	q := map[string]any{}
	for _, k := range receiptFields {
		q[k] = body[k]
	}
	if !creationEqual(body["owner"], op["owner"]) || !creationEqual(q, op["request"]) || (op["certificateId"] != nil && op["certificateId"] != signed["id"]) {
		return nil, receiptOperationError()
	}
	return signed, nil
}
func receiptOperationLive(op map[string]any, now int64) bool {
	expires, _ := contributionClock(op["request"].(map[string]any)["expires"])
	return now >= 0 && now <= MaxSequence && expires > now
}
func SignReceiptOperation(value any, owner string, entry map[string]any, certificate, proof any, now int64) (map[string]any, error) {
	op, err := ValidateReceiptOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	r, err := CheckReceiptOperationCertificate(op, owner, entry, certificate)
	if err != nil {
		return nil, err
	}
	p, err := receiptStageDescriptor(proof)
	if err != nil {
		return nil, err
	}
	if op["phase"] != "prepared" || !receiptOperationLive(op, now) {
		return nil, receiptOperationError()
	}
	op["phase"], op["certificateId"], op["stage"] = "signed", r["id"], p
	return ValidateReceiptOperation(op, owner, entry)
}
func QueueReceiptOperation(value any, owner string, entry map[string]any, bundle, proof any, now int64) (map[string]any, error) {
	op, err := ValidateReceiptOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	p, err := receiptStageDescriptor(proof)
	if err != nil {
		return nil, err
	}
	b, err := object(bundle, "id", "hash")
	if err != nil {
		return nil, err
	}
	if op["phase"] != "signed" || !receiptOperationLive(op, now) || !core.ValidAddress(docTextValue(b["id"])) || !core.ValidAddress(docTextValue(b["hash"])) {
		return nil, receiptOperationError()
	}
	op["phase"], op["stage"], op["transport"] = "queued", p, map[string]any{"bundleId": b["id"], "bundleHash": b["hash"], "copied": false}
	return ValidateReceiptOperation(op, owner, entry)
}
func CopyReceiptOperation(value any, owner string, entry map[string]any, id, hash string, now int64) (map[string]any, error) {
	op, err := ValidateReceiptOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	t, ok := op["transport"].(map[string]any)
	if op["phase"] != "queued" || !receiptOperationLive(op, now) || !ok || t["bundleId"] != id || t["bundleHash"] != hash {
		return nil, receiptOperationError()
	}
	t["copied"] = true
	return ValidateReceiptOperation(op, owner, entry)
}
func ExpireReceiptOperation(value any, owner string, entry map[string]any, now int64) (map[string]any, error) {
	op, err := ValidateReceiptOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	if now < 0 || now > MaxSequence {
		return nil, receiptOperationError()
	}
	if !receiptOperationLive(op, now) {
		op["phase"], op["stage"] = "expired", nil
	}
	return ValidateReceiptOperation(op, owner, entry)
}
