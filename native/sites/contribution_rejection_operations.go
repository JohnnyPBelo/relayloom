package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

const RejectionStageBytes = 64 * 1024
const RejectionTotalStageBytes = 4 * 1024 * 1024

func rejectionOperationError() error { return errors.New("registo de recusa inválido") }
func rejectionIntentHash(owner, recipient, request any) string {
	bytes, _ := core.Canonical(map[string]any{"domain": "relayloom/contribution-rejection-intent/1", "owner": owner, "recipient": recipient, "request": request})
	return core.Hash(bytes)
}
func rejectionStageDescriptor(value any) (map[string]any, error) {
	p, err := object(value, "hash", "bytes")
	if err != nil {
		return nil, rejectionOperationError()
	}
	n, e := creationNumber(p["bytes"])
	if e != nil || n > RejectionStageBytes || !core.ValidAddress(docTextValue(p["hash"])) {
		return nil, rejectionOperationError()
	}
	return p, nil
}
func rejectionCard(value any) (core.PublicIdentity, error) {
	data, err := bounded(value, CertificateBytes)
	if err != nil {
		return core.PublicIdentity{}, err
	}
	return core.DecodePublicIdentity(data)
}
func ValidateRejectionOperation(value any, owner string, entry map[string]any) (map[string]any, error) {
	fields := []string{"owner", "recipient", "request", "fingerprint", "phase", "certificateId", "stage"}
	if m, ok := value.(map[string]any); ok {
		if _, found := m["transport"]; found {
			fields = append(fields, "transport")
		}
	}
	op, err := object(value, fields...)
	if err != nil {
		return nil, rejectionOperationError()
	}
	card, err := rejectionCard(op["owner"])
	if err != nil || card.ID != owner {
		return nil, rejectionOperationError()
	}
	recipient, err := rejectionCard(op["recipient"])
	if err != nil {
		return nil, err
	}
	q, err := ValidateContributionRejectionRequest(op["request"], card)
	if err != nil {
		return nil, err
	}
	decided, _ := contributionClock(q["decidedAt"])
	observed, observedErr := contributionClock(entry["observedAt"])
	verified := int64(0)
	if entry["verifiedAt"] != nil {
		var err error
		verified, err = contributionClock(entry["verifiedAt"])
		if err != nil {
			return nil, rejectionOperationError()
		}
	}
	proposalExpires, proposalErr := contributionClock(entry["expires"])
	expires, _ := contributionClock(q["expires"])
	if q["certificateId"] != entry["id"] || q["contributorId"] != entry["contributorId"] || q["contributorId"] != recipient.ID || q["operationId"] != entry["operationId"] || !creationEqual(q["target"], entry["target"]) || !creationEqual(q["proposalCreated"], entry["created"]) || !creationEqual(q["proposalExpires"], entry["expires"]) || observedErr != nil || proposalErr != nil || decided < observed || decided < verified || decided >= proposalExpires || expires != min(MaxSequence, decided+ContributionRejectionLifetimeMS) {
		return nil, rejectionOperationError()
	}
	if op["fingerprint"] != rejectionIntentHash(op["owner"], op["recipient"], q) {
		return nil, rejectionOperationError()
	}
	phase := docTextValue(op["phase"])
	if !docContains([]string{"prepared", "signed", "queued", "expired"}, phase) {
		return nil, rejectionOperationError()
	}
	if op["certificateId"] != nil && !core.ValidAddress(docTextValue(op["certificateId"])) {
		return nil, rejectionOperationError()
	}
	transport, hasTransport := op["transport"]
	if phase == "prepared" {
		if op["certificateId"] != nil || op["stage"] != nil || hasTransport {
			return nil, rejectionOperationError()
		}
	} else if phase == "expired" {
		if op["stage"] != nil {
			return nil, rejectionOperationError()
		}
	} else {
		if !core.ValidAddress(docTextValue(op["certificateId"])) {
			return nil, rejectionOperationError()
		}
		if _, err = rejectionStageDescriptor(op["stage"]); err != nil {
			return nil, err
		}
	}
	if hasTransport {
		t, e := object(transport, "bundleId", "bundleHash", "copied")
		if e != nil || (phase != "queued" && phase != "expired") || !core.ValidAddress(docTextValue(op["certificateId"])) {
			return nil, rejectionOperationError()
		}
		if !core.ValidAddress(docTextValue(t["bundleId"])) || !core.ValidAddress(docTextValue(t["bundleHash"])) {
			return nil, rejectionOperationError()
		}
		if _, ok := t["copied"].(bool); !ok {
			return nil, rejectionOperationError()
		}
	}
	if phase == "queued" && !hasTransport {
		return nil, rejectionOperationError()
	}
	return resourceClone(op)
}
func PrepareRejectionOperation(owner core.PublicIdentity, entry map[string]any, input any, reason string, now int64) (map[string]any, error) {
	p, err := VerifyContribution(input)
	if err != nil {
		return nil, err
	}
	b := p["body"].(map[string]any)
	if now < 0 || now > MaxSequence {
		return nil, rejectionOperationError()
	}
	q := map[string]any{"contributorId": b["contributor"].(map[string]any)["id"], "certificateId": p["id"], "operationId": b["operationId"], "target": b["target"], "proposalCreated": b["created"], "proposalExpires": b["expires"], "decidedAt": now, "reason": reason, "expires": min(MaxSequence, now+ContributionRejectionLifetimeMS)}
	return ValidateRejectionOperation(map[string]any{"owner": owner, "recipient": b["contributor"], "request": q, "fingerprint": rejectionIntentHash(owner, b["contributor"], q), "phase": "prepared", "certificateId": nil, "stage": nil}, owner.ID, entry)
}
func CheckRejectionOperationCertificate(value any, owner string, entry map[string]any, certificate any) (map[string]any, error) {
	op, err := ValidateRejectionOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	signed, err := VerifyContributionRejection(certificate)
	if err != nil {
		return nil, err
	}
	body := signed["body"].(map[string]any)
	q := map[string]any{}
	for _, k := range rejectionFields {
		q[k] = body[k]
	}
	if !creationEqual(body["owner"], op["owner"]) || !creationEqual(q, op["request"]) || (op["certificateId"] != nil && op["certificateId"] != signed["id"]) {
		return nil, rejectionOperationError()
	}
	return signed, nil
}
func rejectionOperationLive(op map[string]any, now int64) bool {
	expires, _ := contributionClock(op["request"].(map[string]any)["expires"])
	return now >= 0 && now <= MaxSequence && expires > now
}
func SignRejectionOperation(value any, owner string, entry map[string]any, certificate, proof any, now int64) (map[string]any, error) {
	op, err := ValidateRejectionOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	r, err := CheckRejectionOperationCertificate(op, owner, entry, certificate)
	if err != nil {
		return nil, err
	}
	p, err := rejectionStageDescriptor(proof)
	if err != nil {
		return nil, err
	}
	if op["phase"] != "prepared" || !rejectionOperationLive(op, now) {
		return nil, rejectionOperationError()
	}
	op["phase"], op["certificateId"], op["stage"] = "signed", r["id"], p
	return ValidateRejectionOperation(op, owner, entry)
}
func QueueRejectionOperation(value any, owner string, entry map[string]any, bundle, proof any, now int64) (map[string]any, error) {
	op, err := ValidateRejectionOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	p, err := rejectionStageDescriptor(proof)
	if err != nil {
		return nil, err
	}
	b, err := object(bundle, "id", "hash")
	if err != nil {
		return nil, err
	}
	if op["phase"] != "signed" || !rejectionOperationLive(op, now) || !core.ValidAddress(docTextValue(b["id"])) || !core.ValidAddress(docTextValue(b["hash"])) {
		return nil, rejectionOperationError()
	}
	op["phase"], op["stage"], op["transport"] = "queued", p, map[string]any{"bundleId": b["id"], "bundleHash": b["hash"], "copied": false}
	return ValidateRejectionOperation(op, owner, entry)
}
func CopyRejectionOperation(value any, owner string, entry map[string]any, id, hash string, now int64) (map[string]any, error) {
	op, err := ValidateRejectionOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	t, ok := op["transport"].(map[string]any)
	if op["phase"] != "queued" || !rejectionOperationLive(op, now) || !ok || t["bundleId"] != id || t["bundleHash"] != hash {
		return nil, rejectionOperationError()
	}
	t["copied"] = true
	return ValidateRejectionOperation(op, owner, entry)
}
func ExpireRejectionOperation(value any, owner string, entry map[string]any, now int64) (map[string]any, error) {
	op, err := ValidateRejectionOperation(value, owner, entry)
	if err != nil {
		return nil, err
	}
	if now < 0 || now > MaxSequence {
		return nil, rejectionOperationError()
	}
	if !rejectionOperationLive(op, now) {
		op["phase"], op["stage"] = "expired", nil
	}
	return ValidateRejectionOperation(op, owner, entry)
}
