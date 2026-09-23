package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

const ContributionOperationLimit = 128
const ContributionRecordBytes = 1024 * 1024
const ContributionQueueLimit = 32
const ContributionQueueBytes = 32 * 1024 * 1024
const ContributionStageBytes = 6*1024*1024 + 16384
const contributionCreationDomain = "relayloom/contribution-creation/1"

func contributionJournalError() error { return errors.New("registo de proposta inválido") }
func contributionClock(value any) (int64, error) {
	n, e := docNumber(value)
	if e != nil || n < 0 || n > MaxSequence {
		return 0, contributionJournalError()
	}
	return n, nil
}
func contributionPending(op map[string]any) bool {
	return op["phase"] == "prepared" || op["phase"] == "signed"
}

// Requests contain locator, values and publication consent, never a caller ACL.
func ContributionCreationRequest(value any, owner string) (map[string]any, string, error) {
	q, err := object(value, "sequence", "operationId", "snapshotId", "pageId", "formId", "values", "publicationScope", "ttlMs")
	if err != nil || !core.ValidAddress(owner) || !contributionOperationPattern.MatchString(docTextValue(q["operationId"])) {
		return nil, "", contributionJournalError()
	}
	sequence, e1 := creationNumber(q["sequence"])
	ttl, e2 := creationNumber(q["ttlMs"])
	if e1 != nil || e2 != nil || ttl < 1000 || ttl > ContributionLifetimeMS {
		return nil, "", contributionJournalError()
	}
	locator, err := ParseContributionFormLookup(map[string]any{"action": "form", "snapshotId": q["snapshotId"], "pageId": q["pageId"], "formId": q["formId"]})
	if err != nil {
		return nil, "", err
	}
	values, err := ParseContributionValues(q["values"])
	if err != nil {
		return nil, "", err
	}
	scope, err := creationReaders(q["publicationScope"], owner)
	if err != nil {
		return nil, "", err
	}
	normalized, err := creationClone(map[string]any{"sequence": sequence, "operationId": q["operationId"], "snapshotId": locator["snapshotId"], "pageId": locator["pageId"], "formId": locator["formId"], "values": values, "publicationScope": scope, "ttlMs": ttl}, ContributionBytes)
	if err != nil {
		return nil, "", err
	}
	encoded, err := core.Canonical(map[string]any{"domain": "relayloom/contribution-creation-request/1", "ownerId": owner, "request": normalized})
	if err != nil {
		return nil, "", err
	}
	return normalized, core.Hash(encoded), nil
}
func InitialContributionRecord(owner string) (map[string]any, error) {
	if !core.ValidAddress(owner) {
		return nil, contributionJournalError()
	}
	return map[string]any{"domain": contributionCreationDomain, "ownerId": owner, "nextSequence": int64(1), "operations": []any{}}, nil
}

// This is a signing-owned local record, not a permission certificate on the wire.
func ValidateContributionRecord(value any, owner string) (map[string]any, error) {
	r, err := object(value, "domain", "ownerId", "nextSequence", "operations")
	if err != nil || !core.ValidAddress(owner) || r["domain"] != contributionCreationDomain || r["ownerId"] != owner {
		return nil, contributionJournalError()
	}
	next, err := creationNumber(r["nextSequence"])
	if err != nil {
		return nil, err
	}
	ops, ok := r["operations"].([]any)
	if !ok || len(ops) != int(min(next-1, ContributionOperationLimit)) {
		return nil, contributionJournalError()
	}
	seen := map[string]bool{}
	active, queued := 0, 0
	var queuedBytes int64
	for i, raw := range ops {
		fields := []string{"sequence", "operationId", "fingerprint", "phase", "target", "schemaHash", "created", "expires", "certificateId"}
		if m, ok := raw.(map[string]any); ok {
			for _, key := range []string{"transport", "receipt", "rejection"} {
				if _, present := m[key]; present {
					fields = append(fields, key)
				}
			}
		}
		op, err := object(raw, fields...)
		if err != nil {
			return nil, err
		}
		seq, err := creationNumber(op["sequence"])
		id := docTextValue(op["operationId"])
		if err != nil || seq != next-int64(len(ops))+int64(i) || !contributionOperationPattern.MatchString(id) || seen[id] || !core.ValidAddress(docTextValue(op["fingerprint"])) || !core.ValidAddress(docTextValue(op["schemaHash"])) {
			return nil, contributionJournalError()
		}
		seen[id] = true
		created, e1 := contributionClock(op["created"])
		expires, e2 := contributionClock(op["expires"])
		phase := docTextValue(op["phase"])
		if e1 != nil || e2 != nil || expires <= created || expires-created > ContributionLifetimeMS || !docContains([]string{"prepared", "signed", "queued", "cancelled", "expired", "received", "rejected"}, phase) {
			return nil, contributionJournalError()
		}
		if _, err = contributionTarget(op["target"]); err != nil {
			return nil, err
		}
		cert := op["certificateId"]
		if cert != nil && !core.ValidAddress(docTextValue(cert)) {
			return nil, contributionJournalError()
		}
		if phase == "prepared" && cert != nil || phase == "signed" && cert == nil {
			return nil, contributionJournalError()
		}
		transport, present := op["transport"]
		if present {
			if contributionPending(op) || cert == nil {
				return nil, contributionJournalError()
			}
			t, err := object(transport, "bundleId", "bundleHash", "bytes", "copied")
			if err != nil {
				return nil, err
			}
			size, err := creationNumber(t["bytes"])
			_, boolean := t["copied"].(bool)
			if err != nil || size > ContributionStageBytes || !boolean || !core.ValidAddress(docTextValue(t["bundleId"])) || !core.ValidAddress(docTextValue(t["bundleHash"])) {
				return nil, contributionJournalError()
			}
		}
		if receipt, present := op["receipt"]; present {
			if _, err = bindContributionReceipt(op, owner, receipt); err != nil {
				return nil, err
			}
			if !docContains([]string{"received", "rejected", "cancelled", "expired"}, phase) {
				return nil, creationError()
			}
		}
		if rejection, present := op["rejection"]; present {
			if _, err = bindContributionRejection(op, owner, rejection); err != nil {
				return nil, err
			}
			if !docContains([]string{"rejected", "cancelled", "expired"}, phase) {
				return nil, creationError()
			}
		}
		if phase == "rejected" && op["rejection"] == nil {
			return nil, creationError()
		}
		if phase == "received" && op["receipt"] == nil {
			return nil, creationError()
		}
		if phase == "queued" {
			if !present {
				return nil, contributionJournalError()
			}
			t := transport.(map[string]any)
			size, _ := creationNumber(t["bytes"])
			queued++
			queuedBytes += size
		}
		if contributionPending(op) {
			active++
		}
	}
	if active > 1 || queued > ContributionQueueLimit || queuedBytes > ContributionQueueBytes {
		return nil, contributionJournalError()
	}
	return creationClone(r, ContributionRecordBytes)
}
func LookupContributionOperation(value any, owner string, sequence int64, id string) (map[string]any, map[string]any, bool, error) {
	record, err := ValidateContributionRecord(value, owner)
	if err != nil {
		return nil, nil, false, err
	}
	if sequence < 1 || sequence > MaxSequence || !contributionOperationPattern.MatchString(id) {
		return nil, nil, false, contributionJournalError()
	}
	var found map[string]any
	for _, raw := range record["operations"].([]any) {
		op := raw.(map[string]any)
		seq, _ := creationNumber(op["sequence"])
		if seq == sequence && op["operationId"] != id || op["operationId"] == id && seq != sequence {
			return nil, nil, false, contributionJournalError()
		}
		if seq == sequence {
			found = op
		}
	}
	next, _ := creationNumber(record["nextSequence"])
	return record, found, sequence < next && found == nil, nil
}
func PrepareContributionIntent(value any, owner string, input any, context ContributionFormContext, now int64) (map[string]any, map[string]any, error) {
	q, fingerprint, err := ContributionCreationRequest(input, owner)
	if err != nil {
		return nil, nil, err
	}
	seq, _ := creationNumber(q["sequence"])
	id := docTextValue(q["operationId"])
	record, prior, retired, err := LookupContributionOperation(value, owner, seq, id)
	if err != nil {
		return nil, nil, err
	}
	if prior != nil {
		if prior["fingerprint"] != fingerprint {
			return nil, nil, contributionJournalError()
		}
		return record, prior, nil
	}
	next, _ := creationNumber(record["nextSequence"])
	if retired || seq != next || next >= MaxSequence {
		return nil, nil, contributionJournalError()
	}
	ops := record["operations"].([]any)
	for _, raw := range ops {
		if contributionPending(raw.(map[string]any)) {
			return nil, nil, contributionJournalError()
		}
	}
	if len(ops) >= ContributionOperationLimit && ops[0].(map[string]any)["phase"] == "queued" {
		return nil, nil, contributionJournalError()
	}
	if err = AuthorizeContributionContext(context, owner, now); err != nil {
		return nil, nil, err
	}
	target, err := contributionTarget(context.Target)
	if err != nil {
		return nil, nil, err
	}
	for _, k := range []string{"snapshotId", "pageId", "formId"} {
		if q[k] != target[k] {
			return nil, nil, contributionJournalError()
		}
	}
	if _, err = MatchContributionValues(context.Form, context.Table, q["values"]); err != nil {
		return nil, nil, err
	}
	siteOwner, _, _ := ParseAddress(docTextValue(target["site"]))
	public, readers, err := resourceScope(q["publicationScope"])
	if err != nil || !public && !docContains(readers, siteOwner) {
		return nil, nil, contributionJournalError()
	}
	ttl, _ := creationNumber(q["ttlMs"])
	expires := min(now+ttl, context.SnapshotExpires)
	if expires < 0 || expires > MaxSequence || expires-now < 1000 {
		return nil, nil, contributionJournalError()
	}
	schema, err := ContributionSchemaHash(context.Form, context.Table)
	if err != nil {
		return nil, nil, err
	}
	targetCopy, err := resourceClone(target)
	if err != nil {
		return nil, nil, err
	}
	op := map[string]any{"sequence": seq, "operationId": id, "fingerprint": fingerprint, "phase": "prepared", "target": targetCopy, "schemaHash": schema, "created": now, "expires": expires, "certificateId": nil}
	ops = append(ops, op)
	if len(ops) > ContributionOperationLimit {
		ops = ops[len(ops)-ContributionOperationLimit:]
	}
	record["operations"] = ops
	record["nextSequence"] = next + 1
	record, err = ValidateContributionRecord(record, owner)
	if err != nil {
		return nil, nil, err
	}
	copy, err := creationClone(op, ContributionRecordBytes)
	return record, copy, err
}

type ContributionHandle struct {
	Sequence    int64  `json:"sequence"`
	OperationID string `json:"operationId"`
	Fingerprint string `json:"fingerprint"`
}

func contributionHandle(op map[string]any) ContributionHandle {
	seq, _ := creationNumber(op["sequence"])
	return ContributionHandle{seq, docTextValue(op["operationId"]), docTextValue(op["fingerprint"])}
}
func contributionJournalHandle(value any, owner string, h ContributionHandle) (map[string]any, map[string]any, error) {
	record, op, _, err := LookupContributionOperation(value, owner, h.Sequence, h.OperationID)
	if err != nil {
		return nil, nil, err
	}
	if op == nil || op["fingerprint"] != h.Fingerprint {
		return nil, nil, contributionJournalError()
	}
	return record, op, nil
}
func CheckContributionCertificateBinding(value any, owner string, h ContributionHandle, input any, certificate any) (map[string]any, error) {
	_, op, err := contributionJournalHandle(value, owner, h)
	if err != nil {
		return nil, err
	}
	q, fingerprint, err := ContributionCreationRequest(input, owner)
	if err != nil {
		return nil, err
	}
	seq, _ := creationNumber(q["sequence"])
	if fingerprint != op["fingerprint"] || seq != h.Sequence || q["operationId"] != h.OperationID {
		return nil, contributionJournalError()
	}
	cert, err := VerifyContribution(certificate)
	if err != nil {
		return nil, err
	}
	b := cert["body"].(map[string]any)
	card := b["contributor"].(map[string]any)
	if card["id"] != owner || b["operationId"] != h.OperationID || !creationEqual(b["target"], op["target"]) || b["schemaHash"] != op["schemaHash"] || !creationEqual(b["created"], op["created"]) || !creationEqual(b["expires"], op["expires"]) || !creationEqual(b["values"], q["values"]) || !creationEqual(b["publicationScope"], q["publicationScope"]) {
		return nil, contributionJournalError()
	}
	if op["certificateId"] != nil && op["certificateId"] != cert["id"] {
		return nil, contributionJournalError()
	}
	return cert, nil
}
func SignContributionIntent(value any, owner string, h ContributionHandle, input any, certificate any) (map[string]any, map[string]any, error) {
	record, op, err := contributionJournalHandle(value, owner, h)
	if err != nil {
		return nil, nil, err
	}
	cert, err := CheckContributionCertificateBinding(value, owner, h, input, certificate)
	if err != nil {
		return nil, nil, err
	}
	if op["phase"] != "prepared" && (op["phase"] != "signed" || op["certificateId"] != cert["id"]) {
		return nil, nil, contributionJournalError()
	}
	op["phase"] = "signed"
	op["certificateId"] = cert["id"]
	record, err = ValidateContributionRecord(record, owner)
	if err != nil {
		return nil, nil, err
	}
	copy, err := creationClone(op, ContributionRecordBytes)
	return record, copy, err
}
func ExpireContributionIntent(value any, owner string, now int64) (map[string]any, error) {
	record, err := ValidateContributionRecord(value, owner)
	if err != nil {
		return nil, err
	}
	if now < 0 || now > MaxSequence {
		return nil, contributionJournalError()
	}
	for _, raw := range record["operations"].([]any) {
		op := raw.(map[string]any)
		expires, _ := contributionClock(op["expires"])
		if (contributionPending(op) || op["phase"] == "queued") && expires <= now {
			op["phase"] = "expired"
		}
	}
	return ValidateContributionRecord(record, owner)
}
func CancelContributionIntent(value any, owner string, h ContributionHandle) (map[string]any, error) {
	record, op, err := contributionJournalHandle(value, owner, h)
	if err != nil {
		return nil, err
	}
	if !contributionPending(op) && op["phase"] != "queued" && op["phase"] != "cancelled" {
		return nil, contributionJournalError()
	}
	op["phase"] = "cancelled"
	return ValidateContributionRecord(record, owner)
}

func QueueContributionIntent(value any, owner string, h ContributionHandle, input any) (map[string]any, map[string]any, error) {
	record, op, err := contributionJournalHandle(value, owner, h)
	if err != nil {
		return nil, nil, err
	}
	descriptor, err := object(input, "bundleId", "bundleHash", "bytes")
	if err != nil {
		return nil, nil, err
	}
	if op["phase"] == "queued" {
		current := op["transport"].(map[string]any)
		if !creationEqual(map[string]any{"bundleId": current["bundleId"], "bundleHash": current["bundleHash"], "bytes": current["bytes"]}, descriptor) {
			return nil, nil, contributionJournalError()
		}
		return record, op, nil
	}
	if op["phase"] != "signed" || !core.ValidAddress(docTextValue(op["certificateId"])) {
		return nil, nil, contributionJournalError()
	}
	op["phase"] = "queued"
	op["transport"] = map[string]any{"bundleId": descriptor["bundleId"], "bundleHash": descriptor["bundleHash"], "bytes": descriptor["bytes"], "copied": false}
	record, err = ValidateContributionRecord(record, owner)
	if err != nil {
		return nil, nil, err
	}
	result, err := creationClone(op, ContributionRecordBytes)
	return record, result, err
}
func MarkContributionCopied(value any, owner string, h ContributionHandle, bundleHash string) (map[string]any, map[string]any, error) {
	record, op, err := contributionJournalHandle(value, owner, h)
	if err != nil {
		return nil, nil, err
	}
	if op["phase"] != "queued" {
		return nil, nil, contributionJournalError()
	}
	transport := op["transport"].(map[string]any)
	if transport["bundleHash"] != bundleHash {
		return nil, nil, contributionJournalError()
	}
	transport["copied"] = true
	record, err = ValidateContributionRecord(record, owner)
	if err != nil {
		return nil, nil, err
	}
	result, err := creationClone(op, ContributionRecordBytes)
	return record, result, err
}

func bindContributionReceipt(op map[string]any, owner string, input any) (map[string]any, error) {
	receipt, err := VerifyContributionReceipt(input)
	if err != nil {
		return nil, err
	}
	r := receipt["body"].(map[string]any)
	transport, ok := op["transport"].(map[string]any)
	target := op["target"].(map[string]any)
	siteOwner, _, _ := ParseAddress(docTextValue(target["site"]))
	if !ok || transport["copied"] != true || op["certificateId"] == nil || r["certificateId"] != op["certificateId"] || r["contributorId"] != owner || r["operationId"] != op["operationId"] || !creationEqual(r["target"], target) || !creationEqual(r["proposalCreated"], op["created"]) || !creationEqual(r["proposalExpires"], op["expires"]) || r["owner"].(map[string]any)["id"] != siteOwner {
		return nil, creationError()
	}
	return receipt, nil
}
func ReceiveContributionReceipt(value any, owner string, input any, now int64) (map[string]any, map[string]any, bool, error) {
	record, err := ValidateContributionRecord(value, owner)
	if err != nil {
		return nil, nil, false, err
	}
	receipt, err := VerifyContributionReceipt(input)
	if err != nil {
		return nil, nil, false, err
	}
	body := receipt["body"].(map[string]any)
	created, _ := contributionClock(body["created"])
	expires, _ := contributionClock(body["expires"])
	if now < 0 || now > MaxSequence || expires <= now || created-now > ContributionClockSkewMS {
		return nil, nil, false, creationError()
	}
	var op map[string]any
	for _, raw := range record["operations"].([]any) {
		candidate := raw.(map[string]any)
		if candidate["operationId"] == body["operationId"] {
			op = candidate
			break
		}
	}
	if op == nil {
		return nil, nil, false, creationError()
	}
	if _, err = bindContributionReceipt(op, owner, receipt); err != nil {
		return nil, nil, false, err
	}
	if op["receipt"] != nil {
		return record, op, false, nil
	}
	if !docContains([]string{"queued", "rejected", "cancelled", "expired"}, docTextValue(op["phase"])) {
		return nil, nil, false, creationError()
	}
	op["receipt"] = receipt
	if op["phase"] == "queued" {
		op["phase"] = "received"
	}
	next, err := ValidateContributionRecord(record, owner)
	if err != nil {
		return nil, nil, false, err
	}
	for _, raw := range next["operations"].([]any) {
		candidate := raw.(map[string]any)
		if candidate["operationId"] == op["operationId"] {
			return next, candidate, true, nil
		}
	}
	return nil, nil, false, creationError()
}

func bindContributionRejection(op map[string]any, owner string, input any) (map[string]any, error) {
	rejection, err := VerifyContributionRejection(input)
	if err != nil {
		return nil, err
	}
	r := rejection["body"].(map[string]any)
	transport, ok := op["transport"].(map[string]any)
	target := op["target"].(map[string]any)
	siteOwner, _, _ := ParseAddress(docTextValue(target["site"]))
	if !ok || transport["copied"] != true || op["certificateId"] == nil || r["certificateId"] != op["certificateId"] || r["contributorId"] != owner || r["operationId"] != op["operationId"] || !creationEqual(r["target"], target) || !creationEqual(r["proposalCreated"], op["created"]) || !creationEqual(r["proposalExpires"], op["expires"]) || r["owner"].(map[string]any)["id"] != siteOwner {
		return nil, creationError()
	}
	return rejection, nil
}
func ReceiveContributionRejection(value any, owner string, input any, now int64) (map[string]any, map[string]any, bool, error) {
	record, err := ValidateContributionRecord(value, owner)
	if err != nil {
		return nil, nil, false, err
	}
	rejection, err := VerifyContributionRejection(input)
	if err != nil {
		return nil, nil, false, err
	}
	body := rejection["body"].(map[string]any)
	created, _ := contributionClock(body["decidedAt"])
	expires, _ := contributionClock(body["expires"])
	if now < 0 || now > MaxSequence || expires <= now || created-now > ContributionClockSkewMS {
		return nil, nil, false, creationError()
	}
	var op map[string]any
	for _, raw := range record["operations"].([]any) {
		candidate := raw.(map[string]any)
		if candidate["operationId"] == body["operationId"] {
			op = candidate
			break
		}
	}
	if op == nil {
		return nil, nil, false, creationError()
	}
	if _, err = bindContributionRejection(op, owner, rejection); err != nil {
		return nil, nil, false, err
	}
	if op["rejection"] != nil {
		return record, op, false, nil
	}
	if !docContains([]string{"queued", "received", "cancelled", "expired"}, docTextValue(op["phase"])) {
		return nil, nil, false, creationError()
	}
	op["rejection"] = rejection
	if op["phase"] == "queued" || op["phase"] == "received" {
		op["phase"] = "rejected"
	}
	next, err := ValidateContributionRecord(record, owner)
	if err != nil {
		return nil, nil, false, err
	}
	for _, raw := range next["operations"].([]any) {
		candidate := raw.(map[string]any)
		if candidate["operationId"] == op["operationId"] {
			return next, candidate, true, nil
		}
	}
	return nil, nil, false, creationError()
}
