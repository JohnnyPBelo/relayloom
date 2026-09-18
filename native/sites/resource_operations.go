package sites

import (
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const ResourceOperationLimit = 128
const ResourceRecordBytes = 1024 * 1024
const resourceCreationDomain = "relayloom/resource-creation/1"

func creationError() error { return errors.New("operação de recurso inválida") }
func creationNumber(v any) (int64, error) {
	n, err := docNumber(v)
	if err != nil || n < 1 || n > MaxSequence {
		return 0, creationError()
	}
	return n, nil
}
func creationReaders(value any, owner string) (any, error) {
	public, readers, err := resourceScope(value)
	if err != nil {
		return nil, err
	}
	if public {
		return "public", nil
	}
	if !docContains(readers, owner) {
		return nil, creationError()
	}
	result := make([]any, len(readers))
	for i, reader := range readers {
		result[i] = reader
	}
	return result, nil
}
func creationFingerprint(owner string, sequence int64, operation, payloadHash string, readers any, ttl int64) string {
	data, _ := core.Canonical(map[string]any{"domain": "relayloom/resource-creation-request/1", "ownerId": owner, "sequence": sequence, "operationId": operation, "payloadHash": payloadHash, "recipients": readers, "ttlMs": ttl})
	return core.Hash(data)
}
func creationEqual(a, b any) bool {
	aa, ae := core.Canonical(a)
	bb, be := core.Canonical(b)
	return ae == nil && be == nil && string(aa) == string(bb)
}
func creationClone(value any, limit int) (map[string]any, error) {
	data, err := core.Canonical(value)
	if err != nil || len(data) > limit {
		return nil, creationError()
	}
	clone, err := core.DecodeJSON(data, limit)
	if err != nil {
		return nil, err
	}
	m, ok := clone.(map[string]any)
	if !ok {
		return nil, creationError()
	}
	return m, nil
}
func ResourceCreationRequest(value any, owner string) (map[string]any, string, error) {
	q, err := object(value, "sequence", "operationId", "content", "recipients", "ttlMs")
	if err != nil || !core.ValidAddress(owner) || !operationPattern.MatchString(docTextValue(q["operationId"])) {
		return nil, "", creationError()
	}
	sequence, err := creationNumber(q["sequence"])
	if err != nil {
		return nil, "", err
	}
	ttl, err := creationNumber(q["ttlMs"])
	if err != nil || ttl < 1000 || ttl > 365*86400000 {
		return nil, "", creationError()
	}
	content, err := ParseResource(q["content"])
	if err != nil {
		return nil, "", err
	}
	readers, err := creationReaders(q["recipients"], owner)
	if err != nil {
		return nil, "", err
	}
	encoded, err := core.Canonical(content)
	if err != nil {
		return nil, "", err
	}
	request := map[string]any{"sequence": sequence, "operationId": q["operationId"], "content": content, "recipients": readers, "ttlMs": ttl}
	return request, creationFingerprint(owner, sequence, docTextValue(q["operationId"]), core.Hash(encoded), readers, ttl), nil
}
func InitialResourceRecord(owner string) (map[string]any, error) {
	if !core.ValidAddress(owner) {
		return nil, creationError()
	}
	return map[string]any{"domain": resourceCreationDomain, "ownerId": owner, "nextSequence": int64(1), "operations": []any{}}, nil
}

// ValidateResourceRecord returns an owned map. This local journal must be kept
// in signing-owned authenticated storage; it is not a network authorisation.
func ValidateResourceRecord(value any, owner string) (map[string]any, error) {
	r, err := object(value, "domain", "ownerId", "nextSequence", "operations")
	if err != nil || !core.ValidAddress(owner) || r["domain"] != resourceCreationDomain || r["ownerId"] != owner {
		return nil, creationError()
	}
	next, err := creationNumber(r["nextSequence"])
	if err != nil {
		return nil, err
	}
	ops, ok := r["operations"].([]any)
	if !ok || len(ops) != int(min(next-1, ResourceOperationLimit)) {
		return nil, creationError()
	}
	seen := map[string]bool{}
	for i, raw := range ops {
		op, err := object(raw, "sequence", "operationId", "fingerprint", "phase", "reference", "recipients", "ttlMs", "created", "expires", "bundleHash")
		if err != nil {
			return nil, err
		}
		seq, err := creationNumber(op["sequence"])
		id := docTextValue(op["operationId"])
		if err != nil || seq != next-int64(len(ops))+int64(i) || !operationPattern.MatchString(id) || seen[id] || !core.ValidAddress(docTextValue(op["fingerprint"])) || !core.ValidAddress(docTextValue(op["bundleHash"])) {
			return nil, creationError()
		}
		seen[id] = true
		ref, err := ParseResourceReference(op["reference"])
		if err != nil || ref["authorId"] != owner {
			return nil, creationError()
		}
		readers, err := creationReaders(op["recipients"], owner)
		if err != nil {
			return nil, err
		}
		created, a := creationNumber(op["created"])
		expires, b := creationNumber(op["expires"])
		ttl, c := creationNumber(op["ttlMs"])
		if a != nil || b != nil || c != nil || ttl < 1000 || ttl > 365*86400000 || expires-created != ttl {
			return nil, creationError()
		}
		phase := docTextValue(op["phase"])
		if !docContains([]string{"copy-pending", "ready", "expired"}, phase) || (phase == "copy-pending" && i != len(ops)-1) {
			return nil, creationError()
		}
		if op["fingerprint"] != creationFingerprint(owner, seq, id, docTextValue(ref["payloadHash"]), readers, ttl) {
			return nil, creationError()
		}
	}
	return creationClone(r, ResourceRecordBytes)
}
func LookupResourceOperation(value any, owner string, sequence int64, id string) (map[string]any, map[string]any, bool, error) {
	r, err := ValidateResourceRecord(value, owner)
	if err != nil {
		return nil, nil, false, err
	}
	if sequence < 1 || sequence > MaxSequence || !operationPattern.MatchString(id) {
		return nil, nil, false, creationError()
	}
	for _, raw := range r["operations"].([]any) {
		op := raw.(map[string]any)
		n, _ := creationNumber(op["sequence"])
		if n == sequence {
			if op["operationId"] != id {
				return nil, nil, false, creationError()
			}
			return r, op, false, nil
		}
	}
	next, _ := creationNumber(r["nextSequence"])
	return r, nil, sequence < next, nil
}
func PrepareResourceCreation(value any, owner string, input any, staged any) (map[string]any, map[string]any, error) {
	q, fingerprint, err := ResourceCreationRequest(input, owner)
	if err != nil {
		return nil, nil, err
	}
	sequence, _ := creationNumber(q["sequence"])
	id := docTextValue(q["operationId"])
	record, prior, retired, err := LookupResourceOperation(value, owner, sequence, id)
	if err != nil {
		return nil, nil, err
	}
	if prior != nil {
		if prior["fingerprint"] != fingerprint {
			return nil, nil, creationError()
		}
		return record, prior, nil
	}
	next, _ := creationNumber(record["nextSequence"])
	if retired || sequence != next || next >= MaxSequence {
		return nil, nil, creationError()
	}
	ops := record["operations"].([]any)
	for _, raw := range ops {
		op := raw.(map[string]any)
		if op["phase"] == "copy-pending" || op["operationId"] == id {
			return nil, nil, creationError()
		}
	}
	stage, err := object(staged, "reference", "created", "expires", "bundleHash", "recipients")
	if err != nil {
		return nil, nil, err
	}
	ref, err := ParseResourceReference(stage["reference"])
	if err != nil {
		return nil, nil, err
	}
	expected, err := DescribeResource(q["content"], map[string]any{"id": ref["bundleId"], "authorId": owner, "kind": "site-resource"})
	if err != nil || !creationEqual(ref, expected) {
		return nil, nil, creationError()
	}
	readers, err := creationReaders(stage["recipients"], owner)
	if err != nil || !creationEqual(readers, q["recipients"]) {
		return nil, nil, creationError()
	}
	op := map[string]any{"sequence": sequence, "operationId": id, "fingerprint": fingerprint, "phase": "copy-pending", "reference": ref, "recipients": q["recipients"], "ttlMs": q["ttlMs"], "created": stage["created"], "expires": stage["expires"], "bundleHash": stage["bundleHash"]}
	ops = append(ops, op)
	if len(ops) > ResourceOperationLimit {
		ops = ops[1:]
	}
	record["nextSequence"], record["operations"] = next+1, ops
	checked, err := ValidateResourceRecord(record, owner)
	if err != nil {
		return nil, nil, err
	}
	owned, err := creationClone(op, ResourceRecordBytes)
	return checked, owned, err
}
func ResourceCopyReady(value any, owner string, sequence int64, id, fingerprint, bundleHash string) (map[string]any, error) {
	record, op, _, err := LookupResourceOperation(value, owner, sequence, id)
	if err != nil {
		return nil, err
	}
	if op == nil || !docContains([]string{"copy-pending", "ready"}, docTextValue(op["phase"])) || op["fingerprint"] != fingerprint || op["bundleHash"] != bundleHash {
		return nil, creationError()
	}
	op["phase"] = "ready"
	return ValidateResourceRecord(record, owner)
}
func ExpireResourceCreation(value any, owner string, now int64) (map[string]any, error) {
	record, err := ValidateResourceRecord(value, owner)
	if err != nil {
		return nil, err
	}
	if now < 1 || now > MaxSequence {
		return nil, creationError()
	}
	for _, raw := range record["operations"].([]any) {
		op := raw.(map[string]any)
		expires, _ := creationNumber(op["expires"])
		if op["phase"] == "copy-pending" && expires <= now {
			op["phase"] = "expired"
		}
	}
	return record, nil
}
