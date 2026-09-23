package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

const ContributionInboxEntries = 256
const ContributionInboxPending = 64
const ContributionInboxPerContributor = 32
const ContributionInboxConflicts = 4
const ContributionInboxRecordBytes = 1024 * 1024
const ContributionInboxProofBytes = 6*1024*1024 + 16384
const ContributionInboxTotalBytes = 32 * 1024 * 1024
const ContributionInboxRetentionMS int64 = 30 * 86400000
const contributionInboxDomain = "relayloom/contribution-inbox/1"

func inboxError() error               { return errors.New("inbox de propostas inválida") }
func inboxRetain(expires int64) int64 { return min(MaxSequence, expires+ContributionInboxRetentionMS) }
func inboxDescriptor(value any) (map[string]any, error) {
	p, err := object(value, "bundleId", "envelopeHash", "digest", "bytes")
	if err != nil {
		return nil, inboxError()
	}
	n, err := creationNumber(p["bytes"])
	if err != nil || n > ContributionInboxProofBytes {
		return nil, inboxError()
	}
	for _, k := range []string{"bundleId", "envelopeHash", "digest"} {
		if !core.ValidAddress(docTextValue(p[k])) {
			return nil, inboxError()
		}
	}
	return p, nil
}

// Local signing-owned evidence, never peer authority or owner approval.
func ValidateContributionInbox(value any, owner string) (map[string]any, error) {
	r, err := object(value, "domain", "ownerId", "revision", "entries")
	if err != nil || !core.ValidAddress(owner) || r["domain"] != contributionInboxDomain || r["ownerId"] != owner {
		return nil, inboxError()
	}
	if _, err = contributionClock(r["revision"]); err != nil {
		return nil, inboxError()
	}
	entries, ok := r["entries"].([]any)
	if !ok || len(entries) > ContributionInboxEntries {
		return nil, inboxError()
	}
	seen, operations := map[string]bool{}, map[string]bool{}
	authors := map[string]int{}
	pending := 0
	var total, receiptBytes, rejectionBytes int64
	for _, raw := range entries {
		fields := []string{"id", "contributorId", "operationId", "target", "created", "expires", "observedAt", "retainUntil", "phase", "verifiedAt", "expiredAt", "proof", "conflicts", "conflictOverflow"}
		if row, ok := raw.(map[string]any); ok {
			if _, present := row["rejection"]; present {
				fields = append(fields, "rejection")
			}
			if _, present := row["receipt"]; present {
				fields = append(fields, "receipt")
			}
			if _, present := row["dismissedAt"]; present {
				fields = append(fields, "dismissedAt")
			}
		}
		e, err := object(raw, fields...)
		if err != nil {
			return nil, inboxError()
		}
		id, author, operation := docTextValue(e["id"]), docTextValue(e["contributorId"]), docTextValue(e["operationId"])
		key := author + ":" + operation
		if !core.ValidAddress(id) || !core.ValidAddress(author) || !contributionOperationPattern.MatchString(operation) || seen[id] || operations[key] {
			return nil, inboxError()
		}
		seen[id] = true
		operations[key] = true
		target, err := contributionTarget(e["target"])
		if err != nil {
			return nil, err
		}
		recipient, _, err := ParseAddress(docTextValue(target["site"]))
		if err != nil || recipient != owner {
			return nil, inboxError()
		}
		created, e1 := contributionClock(e["created"])
		expires, e2 := contributionClock(e["expires"])
		observed, e3 := contributionClock(e["observedAt"])
		if e1 != nil || e2 != nil || e3 != nil || expires <= created || expires-created > ContributionLifetimeMS || observed >= expires || created-observed > ContributionClockSkewMS {
			return nil, inboxError()
		}
		phase := docTextValue(e["phase"])
		if !docContains([]string{"missing-source", "verified-candidate", "expired", "dismissed", "rejected"}, phase) {
			return nil, inboxError()
		}
		if e["verifiedAt"] != nil {
			verified, err := contributionClock(e["verifiedAt"])
			if err != nil || verified < observed || verified >= expires {
				return nil, inboxError()
			}
		}
		if phase == "missing-source" && e["verifiedAt"] != nil || phase == "verified-candidate" && e["verifiedAt"] == nil {
			return nil, inboxError()
		}
		if phase == "dismissed" {
			dismissed, err := contributionClock(e["dismissedAt"])
			verified := int64(0)
			if e["verifiedAt"] != nil {
				verified, _ = contributionClock(e["verifiedAt"])
			}
			if err != nil || dismissed < observed || dismissed < verified || dismissed >= expires || e["proof"] != nil || e["expiredAt"] != nil {
				return nil, inboxError()
			}
		} else if _, present := e["dismissedAt"]; present {
			return nil, inboxError()
		}
		if phase == "rejected" {
			op, err := ValidateRejectionOperation(e["rejection"], owner, e)
			if err != nil || e["proof"] != nil || e["expiredAt"] != nil {
				return nil, inboxError()
			}
			if stage, ok := op["stage"].(map[string]any); ok {
				n, _ := creationNumber(stage["bytes"])
				rejectionBytes += n
			}
		} else if _, present := e["rejection"]; present {
			return nil, inboxError()
		}
		if phase == "dismissed" || phase == "rejected" {
			// Only bounded metadata remains; pending/proof quota is released.
		} else if phase == "expired" {
			expired, err := contributionClock(e["expiredAt"])
			if err != nil || expired < expires || e["proof"] != nil {
				return nil, inboxError()
			}
		} else {
			if e["expiredAt"] != nil {
				return nil, inboxError()
			}
			p, err := inboxDescriptor(e["proof"])
			if err != nil {
				return nil, err
			}
			n, _ := creationNumber(p["bytes"])
			total += n
			pending++
			authors[author]++
		}
		if raw, present := e["receipt"]; present {
			op, err := ValidateReceiptOperation(raw, owner, e)
			if err != nil {
				return nil, err
			}
			if stage, ok := op["stage"].(map[string]any); ok {
				n, _ := creationNumber(stage["bytes"])
				receiptBytes += n
			}
		}
		conflicts, ok := e["conflicts"].([]any)
		overflow, boolean := e["conflictOverflow"].(bool)
		if !ok || len(conflicts) > ContributionInboxConflicts || !boolean || overflow && len(conflicts) != ContributionInboxConflicts {
			return nil, inboxError()
		}
		maximum := expires
		for _, raw := range conflicts {
			c, err := object(raw, "id", "expires")
			if err != nil {
				return nil, err
			}
			id := docTextValue(c["id"])
			expiry, err := contributionClock(c["expires"])
			if err != nil || !core.ValidAddress(id) || seen[id] {
				return nil, inboxError()
			}
			seen[id] = true
			maximum = max(maximum, expiry)
		}
		retain, err := contributionClock(e["retainUntil"])
		if err != nil || retain < inboxRetain(maximum) || !overflow && retain != inboxRetain(maximum) {
			return nil, inboxError()
		}
	}
	if pending > ContributionInboxPending || total > ContributionInboxTotalBytes || receiptBytes > ReceiptTotalStageBytes || rejectionBytes > RejectionTotalStageBytes {
		return nil, inboxError()
	}
	for _, count := range authors {
		if count > ContributionInboxPerContributor {
			return nil, inboxError()
		}
	}
	return creationClone(r, ContributionInboxRecordBytes)
}
func InitialContributionInbox(owner string) (map[string]any, error) {
	return ValidateContributionInbox(map[string]any{"domain": contributionInboxDomain, "ownerId": owner, "revision": int64(0), "entries": []any{}}, owner)
}
func advanceInbox(r map[string]any) (map[string]any, error) {
	revision, err := contributionClock(r["revision"])
	if err != nil || revision >= MaxSequence {
		return nil, inboxError()
	}
	r["revision"] = revision + 1
	return ValidateContributionInbox(r, docTextValue(r["ownerId"]))
}
func inboxEntry(r map[string]any, id string) map[string]any {
	for _, raw := range r["entries"].([]any) {
		e := raw.(map[string]any)
		if e["id"] == id {
			return e
		}
	}
	return nil
}
func CheckInboxCertificate(entry map[string]any, certificate any, owner string) (map[string]any, error) {
	p, err := VerifyContribution(certificate)
	if err != nil {
		return nil, err
	}
	b := p["body"].(map[string]any)
	target := b["target"].(map[string]any)
	recipient, _, _ := ParseAddress(docTextValue(target["site"]))
	author := b["contributor"].(map[string]any)
	if recipient != owner || entry["id"] != p["id"] || entry["contributorId"] != author["id"] || entry["operationId"] != b["operationId"] || !creationEqual(entry["created"], b["created"]) || !creationEqual(entry["expires"], b["expires"]) || !creationEqual(entry["target"], target) {
		return nil, inboxError()
	}
	return p, nil
}
func ObserveContributionInbox(value any, owner string, certificate any, proof any, now int64) (map[string]any, map[string]any, string, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, nil, "", err
	}
	p, err := VerifyContribution(certificate)
	if err != nil {
		return nil, nil, "", err
	}
	descriptor, err := inboxDescriptor(proof)
	if err != nil {
		return nil, nil, "", err
	}
	b := p["body"].(map[string]any)
	target := b["target"].(map[string]any)
	recipient, _, _ := ParseAddress(docTextValue(target["site"]))
	author := b["contributor"].(map[string]any)
	created, _ := contributionClock(b["created"])
	expires, _ := contributionClock(b["expires"])
	if now < 0 || now > MaxSequence || expires <= now || created-now > ContributionClockSkewMS || recipient != owner {
		return nil, nil, "", inboxError()
	}
	for _, raw := range r["entries"].([]any) {
		e := raw.(map[string]any)
		if e["contributorId"] != author["id"] || e["operationId"] != b["operationId"] {
			continue
		}
		if e["id"] == p["id"] {
			if _, err = CheckInboxCertificate(e, p, owner); err != nil {
				return nil, nil, "", err
			}
			return r, e, "duplicate", nil
		}
		conflicts := e["conflicts"].([]any)
		for _, raw := range conflicts {
			if raw.(map[string]any)["id"] == p["id"] {
				return r, e, "conflict", nil
			}
		}
		retained, _ := contributionClock(e["retainUntil"])
		if e["conflictOverflow"] == true && inboxRetain(expires) <= retained {
			return r, e, "conflict", nil
		}
		if len(conflicts) < ContributionInboxConflicts {
			e["conflicts"] = append(conflicts, map[string]any{"id": p["id"], "expires": expires})
		} else {
			e["conflictOverflow"] = true
		}
		e["retainUntil"] = max(retained, inboxRetain(expires))
		id := docTextValue(e["id"])
		r, err = advanceInbox(r)
		if err != nil {
			return nil, nil, "", err
		}
		return r, inboxEntry(r, id), "conflict", nil
	}
	e := map[string]any{"id": p["id"], "contributorId": author["id"], "operationId": b["operationId"], "target": target, "created": created, "expires": expires, "observedAt": now, "retainUntil": inboxRetain(expires), "phase": "missing-source", "verifiedAt": nil, "expiredAt": nil, "proof": descriptor, "conflicts": []any{}, "conflictOverflow": false}
	r["entries"] = append(r["entries"].([]any), e)
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, "", err
	}
	return r, inboxEntry(r, docTextValue(p["id"])), "new", nil
}
func VerifyContributionInboxSource(value any, owner, id string, proof any, now int64) (map[string]any, map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, nil, err
	}
	p, err := inboxDescriptor(proof)
	if err != nil {
		return nil, nil, err
	}
	e := inboxEntry(r, id)
	if e == nil || e["proof"] == nil || e["phase"] == "expired" {
		return nil, nil, inboxError()
	}
	observed, _ := contributionClock(e["observedAt"])
	expires, _ := contributionClock(e["expires"])
	if now < observed || now >= expires || now < 0 || now > MaxSequence {
		return nil, nil, inboxError()
	}
	prior := e["proof"].(map[string]any)
	if prior["bundleId"] != p["bundleId"] || prior["envelopeHash"] != p["envelopeHash"] {
		return nil, nil, inboxError()
	}
	if e["phase"] == "verified-candidate" {
		if !creationEqual(prior, p) {
			return nil, nil, inboxError()
		}
		return r, e, nil
	}
	e["phase"] = "verified-candidate"
	e["verifiedAt"] = now
	e["proof"] = p
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, err
	}
	return r, inboxEntry(r, id), nil
}
func ExpireContributionInbox(value any, owner string, now int64) (map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, err
	}
	if now < 0 || now > MaxSequence {
		return nil, inboxError()
	}
	changed := false
	entries := []any{}
	for _, raw := range r["entries"].([]any) {
		e := raw.(map[string]any)
		expires, _ := contributionClock(e["expires"])
		retained, _ := contributionClock(e["retainUntil"])
		if op, ok := e["receipt"].(map[string]any); ok && op["phase"] != "expired" {
			deadline, _ := contributionClock(op["request"].(map[string]any)["expires"])
			if deadline <= now {
				next, err := ExpireReceiptOperation(op, owner, e, now)
				if err != nil {
					return nil, err
				}
				e["receipt"] = next
				changed = true
			}
		}
		if op, ok := e["rejection"].(map[string]any); ok && op["phase"] != "expired" {
			deadline, _ := contributionClock(op["request"].(map[string]any)["expires"])
			if deadline <= now {
				next, err := ExpireRejectionOperation(op, owner, e, now)
				if err != nil {
					return nil, err
				}
				e["rejection"] = next
				changed = true
			}
		}
		if e["proof"] != nil && expires <= now {
			e["phase"] = "expired"
			e["proof"] = nil
			e["expiredAt"] = now
			changed = true
		}
		if retained > now {
			entries = append(entries, e)
		} else {
			changed = true
		}
	}
	r["entries"] = entries
	if changed {
		return advanceInbox(r)
	}
	return r, nil
}

// DismissContributionInbox is local disposal, not a signed decision or receipt.
func DismissContributionInbox(value any, owner, id string, revision, now int64) (map[string]any, map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, nil, err
	}
	current, _ := contributionClock(r["revision"])
	if revision < 0 || revision > current || now < 0 || now > MaxSequence {
		return nil, nil, inboxError()
	}
	e := inboxEntry(r, id)
	if e == nil {
		return nil, nil, inboxError()
	}
	if e["phase"] == "dismissed" {
		return r, e, nil
	}
	if revision != current {
		return nil, nil, errors.New("a inbox mudou; volta a consultar")
	}
	observed, _ := contributionClock(e["observedAt"])
	expires, _ := contributionClock(e["expires"])
	verified := int64(0)
	if e["verifiedAt"] != nil {
		verified, _ = contributionClock(e["verifiedAt"])
	}
	if e["proof"] == nil || now < observed || now < verified || now >= expires {
		return nil, nil, inboxError()
	}
	e["phase"], e["dismissedAt"], e["proof"] = "dismissed", now, nil
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, err
	}
	return r, inboxEntry(r, id), nil
}

// Minimal owner-private metadata; no proposal values, proof or read capability.
func ContributionInboxManagement(value any, owner string) (map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, err
	}
	entries := []any{}
	for _, raw := range r["entries"].([]any) {
		e := raw.(map[string]any)
		row := map[string]any{}
		for _, k := range []string{"id", "contributorId", "operationId", "target", "phase", "created", "expires", "retainUntil", "verifiedAt", "dismissedAt"} {
			row[k] = e[k]
		}
		entries = append(entries, row)
	}
	return map[string]any{"revision": r["revision"], "entries": entries}, nil
}

func PrepareInboxReceipt(value any, owner core.PublicIdentity, certificate any) (map[string]any, map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner.ID)
	if err != nil {
		return nil, nil, err
	}
	p, err := VerifyContribution(certificate)
	if err != nil {
		return nil, nil, err
	}
	e := inboxEntry(r, docTextValue(p["id"]))
	if e == nil || e["proof"] == nil || e["phase"] != "verified-candidate" {
		return nil, nil, inboxError()
	}
	signer := owner
	if old, ok := e["receipt"].(map[string]any); ok {
		signer, err = receiptCard(old["owner"])
		if err != nil {
			return nil, nil, err
		}
	}
	expected, err := PrepareReceiptOperation(signer, e, p)
	if err != nil {
		return nil, nil, err
	}
	if old, ok := e["receipt"].(map[string]any); ok {
		if old["fingerprint"] != expected["fingerprint"] {
			return nil, nil, inboxError()
		}
		return r, e, nil
	}
	e["receipt"] = expected
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, err
	}
	return r, inboxEntry(r, docTextValue(p["id"])), nil
}
func UpdateInboxReceipt(value any, owner, id string, receipt any) (map[string]any, map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, nil, err
	}
	e := inboxEntry(r, id)
	if e == nil {
		return nil, nil, inboxError()
	}
	old, ok := e["receipt"].(map[string]any)
	if !ok {
		return nil, nil, inboxError()
	}
	next, err := ValidateReceiptOperation(receipt, owner, e)
	if err != nil {
		return nil, nil, err
	}
	if next["fingerprint"] != old["fingerprint"] {
		return nil, nil, inboxError()
	}
	if creationEqual(next, old) {
		return r, e, nil
	}
	transition := docTextValue(old["phase"]) + ":" + docTextValue(next["phase"])
	if !docContains([]string{"prepared:signed", "signed:queued", "queued:queued"}, transition) || (old["certificateId"] != nil && next["certificateId"] != old["certificateId"]) {
		return nil, nil, inboxError()
	}
	if old["phase"] == "queued" {
		expected, _ := resourceClone(old)
		t := expected["transport"].(map[string]any)
		if t["copied"] == true {
			return nil, nil, inboxError()
		}
		t["copied"] = true
		if !creationEqual(next, expected) {
			return nil, nil, inboxError()
		}
	}
	e["receipt"] = next
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, err
	}
	return r, inboxEntry(r, id), nil
}

// RejectContributionInbox prepares an explicit owner decision from retained
// authenticated evidence. It never asserts source verification or delivery.
func RejectContributionInbox(value any, owner core.PublicIdentity, id string, revision int64, reason string, certificate any, now int64) (map[string]any, map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner.ID)
	if err != nil {
		return nil, nil, err
	}
	current, _ := contributionClock(r["revision"])
	if revision < 0 || revision > current || now < 0 || now > MaxSequence {
		return nil, nil, inboxError()
	}
	e := inboxEntry(r, id)
	if e == nil {
		return nil, nil, inboxError()
	}
	if old, ok := e["rejection"].(map[string]any); ok {
		if old["request"].(map[string]any)["reason"] != reason {
			return nil, nil, errors.New("a recusa já tem outro motivo")
		}
		return r, e, nil
	}
	if revision != current {
		return nil, nil, errors.New("a inbox mudou; volta a consultar")
	}
	if e["proof"] == nil || (e["phase"] != "missing-source" && e["phase"] != "verified-candidate") {
		return nil, nil, inboxError()
	}
	proposal, err := CheckInboxCertificate(e, certificate, owner.ID)
	if err != nil {
		return nil, nil, err
	}
	op, err := PrepareRejectionOperation(owner, e, proposal, reason, now)
	if err != nil {
		return nil, nil, err
	}
	e["rejection"], e["phase"], e["proof"] = op, "rejected", nil
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, err
	}
	return r, inboxEntry(r, id), nil
}

func UpdateInboxRejection(value any, owner, id string, rejection any) (map[string]any, map[string]any, error) {
	r, err := ValidateContributionInbox(value, owner)
	if err != nil {
		return nil, nil, err
	}
	e := inboxEntry(r, id)
	if e == nil {
		return nil, nil, inboxError()
	}
	old, ok := e["rejection"].(map[string]any)
	if !ok {
		return nil, nil, inboxError()
	}
	next, err := ValidateRejectionOperation(rejection, owner, e)
	if err != nil {
		return nil, nil, err
	}
	if next["fingerprint"] != old["fingerprint"] {
		return nil, nil, inboxError()
	}
	if creationEqual(next, old) {
		return r, e, nil
	}
	transition := docTextValue(old["phase"]) + ":" + docTextValue(next["phase"])
	if !docContains([]string{"prepared:signed", "signed:queued", "queued:queued"}, transition) || (old["certificateId"] != nil && next["certificateId"] != old["certificateId"]) {
		return nil, nil, inboxError()
	}
	if old["phase"] == "queued" {
		expected, _ := resourceClone(old)
		t := expected["transport"].(map[string]any)
		if t["copied"] == true {
			return nil, nil, inboxError()
		}
		t["copied"] = true
		if !creationEqual(next, expected) {
			return nil, nil, inboxError()
		}
	}
	e["rejection"] = next
	r, err = advanceInbox(r)
	if err != nil {
		return nil, nil, err
	}
	return r, inboxEntry(r, id), nil
}
