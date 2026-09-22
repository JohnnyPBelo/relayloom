package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"regexp"
	"time"
)

type ContributionInbox struct {
	database CatalogDatabase
	identity core.Identity
	key      string
	now      func() int64
}
type inboxPrivateProof struct {
	envelope core.Bundle
	source   *core.Bundle
}

var inboxPartSuffix = regexp.MustCompile(`:[0-9]{2}$`)

func NewContributionInbox(database CatalogDatabase, identity core.Identity) *ContributionInbox {
	encoded, _ := core.Canonical(map[string]any{"domain": "relayloom/contribution-inbox-key/1", "owner": identity.Public.ID})
	return &ContributionInbox{database, identity, "contribution-inbox:" + core.Hash(encoded), func() int64 { return time.Now().UnixMilli() }}
}
func inboxProofKey(id string) string { return "contribution-inbox:" + id + ":stage" }
func (p *inboxPrivateProof) value() map[string]any {
	var source any
	if p.source != nil {
		source = *p.source
	}
	return map[string]any{"envelope": p.envelope, "source": source}
}
func (p *inboxPrivateProof) descriptor() (map[string]any, error) {
	bytes, err := core.Canonical(p.value())
	if err != nil {
		return nil, err
	}
	envelope, err := core.Canonical(p.envelope)
	if err != nil {
		return nil, err
	}
	return map[string]any{"bundleId": p.envelope.Manifest.ID, "envelopeHash": core.Hash(envelope), "digest": core.Hash(bytes), "bytes": len(bytes)}, nil
}
func inboxBundle(value any) (core.Bundle, error) {
	encoded, err := core.Canonical(value)
	if err != nil {
		return core.Bundle{}, err
	}
	return core.DecodeBundle(encoded)
}
func (c *ContributionInbox) certificate(bundle core.Bundle) (map[string]any, error) {
	value, err := core.DecryptBundleAt(bundle, &c.identity, bundle.Manifest.Created)
	if err != nil {
		return nil, err
	}
	content, err := MatchContributionEnvelope(bundle, value)
	if err != nil {
		return nil, err
	}
	return content["proposal"].(map[string]any), nil
}
func (c *ContributionInbox) source(proposal map[string]any, bundle core.Bundle, now int64) (*ResolvedContributionForm, error) {
	value, err := core.DecryptBundleAt(bundle, &c.identity, now)
	if err != nil {
		return nil, err
	}
	b := proposal["body"].(map[string]any)
	target := b["target"].(map[string]any)
	author := b["contributor"].(map[string]any)
	resolved, err := ResolveContributionForm(map[string]any{"action": "form", "snapshotId": target["snapshotId"], "pageId": target["pageId"], "formId": target["formId"]}, bundle, value, docTextValue(author["id"]), now)
	if err != nil {
		return nil, err
	}
	if _, err = VerifyContributionForSubmission(proposal, resolved.Context, now); err != nil {
		return nil, err
	}
	return resolved, nil
}
func (c *ContributionInbox) readProof(values *PrivateRecords, entry map[string]any) (*inboxPrivateProof, map[string]any, error) {
	fail := func() (*inboxPrivateProof, map[string]any, error) {
		return nil, nil, privateIntegrity("prova privada de inbox inválida")
	}
	if entry["proof"] == nil {
		return fail()
	}
	raw, found, err := values.Read(inboxProofKey(docTextValue(entry["id"])))
	if err != nil {
		return nil, nil, err
	}
	if !found {
		return fail()
	}
	value, err := object(raw, "envelope", "source")
	if err != nil {
		return fail()
	}
	bundle, err := inboxBundle(value["envelope"])
	if err != nil {
		return fail()
	}
	proof := &inboxPrivateProof{envelope: bundle}
	if value["source"] != nil {
		source, err := inboxBundle(value["source"])
		if err != nil {
			return fail()
		}
		proof.source = &source
	}
	descriptor, err := proof.descriptor()
	if err != nil || !creationEqual(descriptor, entry["proof"]) {
		return fail()
	}
	proposal, err := c.certificate(bundle)
	if err != nil {
		return fail()
	}
	if _, err = CheckInboxCertificate(entry, proposal, c.identity.Public.ID); err != nil {
		return fail()
	}
	if entry["verifiedAt"] == nil {
		if proof.source != nil {
			return fail()
		}
	} else {
		if proof.source == nil {
			return fail()
		}
		when, _ := contributionClock(entry["verifiedAt"])
		if _, err = c.source(proposal, *proof.source, when); err != nil {
			return fail()
		}
	}
	return proof, proposal, nil
}
func (c *ContributionInbox) run(callback func(*PrivateRecords, map[string]any, *PrivateRecords) error) error {
	return c.database.Update(func(tx *groupstore.Tx) error {
		return RunContributionInboxPrivate(tx, c.identity, func(values *PrivateRecords) error {
			return RunContributionReceiptPrivate(tx, c.identity, func(receipts *PrivateRecords) error {
				saved, found, err := values.Read(c.key + ":record")
				if err != nil {
					return err
				}
				keys, err := tx.Keys("contribution-inbox:")
				if err != nil {
					return err
				}
				receiptKeys, err := tx.Keys("contribution-receipt:")
				if err != nil {
					return err
				}
				var record map[string]any
				if !found {
					if len(keys) != 0 || len(receiptKeys) != 0 {
						return privateIntegrity("inbox ausente com provas existentes")
					}
					record, err = InitialContributionInbox(c.identity.Public.ID)
					if err != nil {
						return err
					}
				} else {
					record, err = ValidateContributionInbox(saved, c.identity.Public.ID)
					if err != nil {
						return privateIntegrity("índice privado de inbox inválido")
					}
					expected := map[string]bool{c.key + ":record": true}
					for _, raw := range record["entries"].([]any) {
						e := raw.(map[string]any)
						if e["proof"] != nil {
							expected[inboxProofKey(docTextValue(e["id"]))] = true
						}
					}
					for key := range expected {
						_, exists, err := tx.Get(key)
						if err != nil {
							return err
						}
						if !exists {
							return privateIntegrity("índice de prova ausente")
						}
					}
					for _, key := range keys {
						if !expected[inboxPartSuffix.ReplaceAllString(key, "")] {
							return privateIntegrity("prova privada órfã")
						}
					}
				}
				expectedReceipts := map[string]bool{}
				for _, raw := range record["entries"].([]any) {
					e := raw.(map[string]any)
					if op, ok := e["receipt"].(map[string]any); ok && op["stage"] != nil {
						expectedReceipts[receiptProofKey(docTextValue(e["id"]))] = true
					}
				}
				for key := range expectedReceipts {
					_, exists, err := tx.Get(key)
					if err != nil {
						return err
					}
					if !exists {
						return privateIntegrity("preparação de recibo ausente")
					}
				}
				for _, key := range receiptKeys {
					if !expectedReceipts[inboxPartSuffix.ReplaceAllString(key, "")] {
						return privateIntegrity("preparação de recibo órfã")
					}
				}
				next, err := ExpireContributionInbox(record, c.identity.Public.ID, c.now())
				if err != nil {
					return err
				}
				if !creationEqual(next["revision"], record["revision"]) {
					for _, raw := range record["entries"].([]any) {
						e := raw.(map[string]any)
						n := inboxEntry(next, docTextValue(e["id"]))
						if op, ok := e["receipt"].(map[string]any); ok && op["stage"] != nil {
							var nextStage any
							if n != nil {
								if receipt, ok := n["receipt"].(map[string]any); ok {
									nextStage = receipt["stage"]
								}
							}
							if nextStage == nil {
								if _, err = c.readReceipt(receipts, e); err != nil {
									return err
								}
								if err = receipts.Remove(receiptProofKey(docTextValue(e["id"]))); err != nil {
									return err
								}
							}
						}
						if e["proof"] != nil && (n == nil || n["proof"] == nil) {
							if _, _, err = c.readProof(values, e); err != nil {
								return err
							}
							if err = values.Remove(inboxProofKey(docTextValue(e["id"]))); err != nil {
								return err
							}
						}
					}
					if err = values.Write(c.key+":record", next); err != nil {
						return err
					}
					record = next
				}
				return callback(values, record, receipts)
			})
		})
	})
}
func (c *ContributionInbox) State() (map[string]any, error) {
	var result map[string]any
	err := c.run(func(_ *PrivateRecords, r map[string]any, _ *PrivateRecords) error { result = r; return nil })
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (c *ContributionInbox) CheckSource(bundle, source core.Bundle) error {
	proposal, err := c.certificate(bundle)
	if err != nil {
		return err
	}
	_, err = c.source(proposal, source, c.now())
	return err
}
func (c *ContributionInbox) Admit(input core.Bundle, allow ContributionPolicy) (map[string]any, error) {
	bundle, err := inboxBundle(input)
	if err != nil {
		return nil, err
	}
	proposal, err := c.certificate(bundle)
	if err != nil {
		return nil, err
	}
	proof := &inboxPrivateProof{envelope: bundle}
	descriptor, err := proof.descriptor()
	if err != nil {
		return nil, err
	}
	var result map[string]any
	err = c.run(func(values *PrivateRecords, record map[string]any, _ *PrivateRecords) error {
		b := proposal["body"].(map[string]any)
		target := b["target"].(map[string]any)
		author := b["contributor"].(map[string]any)
		if err := allow(docTextValue(target["snapshotId"]), docTextValue(author["id"])); err != nil {
			return err
		}
		if err := allow(docTextValue(target["snapshotId"]), c.identity.Public.ID); err != nil {
			return err
		}
		next, entry, outcome, err := ObserveContributionInbox(record, c.identity.Public.ID, proposal, descriptor, c.now())
		if err != nil {
			return err
		}
		if outcome == "new" {
			key := inboxProofKey(docTextValue(proposal["id"]))
			_, found, err := values.Read(key)
			if err != nil {
				return err
			}
			if found {
				return privateIntegrity("slot de prova já ocupado")
			}
			if err = values.Write(key, proof.value()); err != nil {
				return err
			}
		} else if entry["proof"] != nil {
			if _, _, err = c.readProof(values, entry); err != nil {
				return err
			}
		}
		if !creationEqual(next["revision"], record["revision"]) {
			if err = values.Write(c.key+":record", next); err != nil {
				return err
			}
		}
		result = map[string]any{"record": next, "entry": entry, "outcome": outcome}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (c *ContributionInbox) AttachSource(id string, input core.Bundle, allow ContributionPolicy) (map[string]any, error) {
	source, err := inboxBundle(input)
	if err != nil {
		return nil, err
	}
	if err = core.VerifyBundleAt(source, source.Manifest.Created); err != nil {
		return nil, err
	}
	var result map[string]any
	err = c.run(func(values *PrivateRecords, record map[string]any, _ *PrivateRecords) error {
		e := inboxEntry(record, id)
		if e == nil || e["proof"] == nil {
			return errors.New("candidato ausente ou expirado")
		}
		prior, proposal, err := c.readProof(values, e)
		if err != nil {
			return err
		}
		if _, err = c.source(proposal, source, c.now()); err != nil {
			return err
		}
		target := e["target"].(map[string]any)
		if err = allow(docTextValue(target["snapshotId"]), docTextValue(e["contributorId"])); err != nil {
			return err
		}
		if err = allow(docTextValue(target["snapshotId"]), c.identity.Public.ID); err != nil {
			return err
		}
		if _, err = c.source(proposal, source, c.now()); err != nil {
			return err
		}
		proof := &inboxPrivateProof{envelope: prior.envelope, source: &source}
		descriptor, err := proof.descriptor()
		if err != nil {
			return err
		}
		next, entry, err := VerifyContributionInboxSource(record, c.identity.Public.ID, id, descriptor, c.now())
		if err != nil {
			return err
		}
		next, entry, err = PrepareInboxReceipt(next, c.identity.Public, proposal)
		if err != nil {
			return err
		}
		if !creationEqual(next["revision"], record["revision"]) {
			if err = values.Write(inboxProofKey(id), proof.value()); err != nil {
				return err
			}
			if err = values.Write(c.key+":record", next); err != nil {
				return err
			}
		}
		result = entry
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (c *ContributionInbox) Read(id string, allow ContributionPolicy) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, _ *PrivateRecords) error {
		e := inboxEntry(record, id)
		if e == nil {
			return nil
		}
		target := e["target"].(map[string]any)
		if err := allow(docTextValue(target["snapshotId"]), docTextValue(e["contributorId"])); err != nil {
			return err
		}
		if err := allow(docTextValue(target["snapshotId"]), c.identity.Public.ID); err != nil {
			return err
		}
		if e["proof"] == nil {
			result = map[string]any{"entry": e}
			return nil
		}
		expires, _ := contributionClock(e["expires"])
		if expires <= c.now() {
			return errors.New("proposta expirada durante a política")
		}
		proof, proposal, err := c.readProof(values, e)
		if err != nil {
			return err
		}
		if proof.source == nil {
			result = map[string]any{"entry": e}
			return nil
		}
		if _, err = c.source(proposal, *proof.source, c.now()); err != nil {
			return err
		}
		if _, present := e["receipt"]; !present {
			next, migrated, err := PrepareInboxReceipt(record, c.identity.Public, proposal)
			if err != nil {
				return err
			}
			if err = values.Write(c.key+":record", next); err != nil {
				return err
			}
			e = migrated
		}
		result = map[string]any{"entry": e, "proposal": proposal, "source": *proof.source}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (c *ContributionInbox) Dismiss(id string, revision int64) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, _ *PrivateRecords) error {
		next, entry, err := DismissContributionInbox(record, c.identity.Public.ID, id, revision, c.now())
		if err != nil {
			return err
		}
		if !creationEqual(next["revision"], record["revision"]) {
			if _, _, err = c.readProof(values, inboxEntry(record, id)); err != nil {
				return err
			}
			if err = values.Remove(inboxProofKey(id)); err != nil {
				return err
			}
			if err = values.Write(c.key+":record", next); err != nil {
				return err
			}
		}
		result = map[string]any{"entry": entry, "revision": next["revision"]}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func receiptProofKey(id string) string { return "contribution-receipt:" + id + ":stage" }
func receiptProofDescriptor(value any) (map[string]any, error) {
	b, err := core.Canonical(value)
	if err != nil {
		return nil, err
	}
	return map[string]any{"hash": core.Hash(b), "bytes": len(b)}, nil
}
func (c *ContributionInbox) readReceipt(records *PrivateRecords, entry map[string]any) (map[string]any, error) {
	stage, err := c.readReceiptChecked(records, entry)
	if err != nil {
		return nil, privateIntegrity("preparação privada de recibo inválida")
	}
	return stage, nil
}
func (c *ContributionInbox) readReceiptChecked(records *PrivateRecords, entry map[string]any) (map[string]any, error) {
	op, ok := entry["receipt"].(map[string]any)
	if !ok || op["stage"] == nil {
		return nil, receiptOperationError()
	}
	raw, found, err := records.Read(receiptProofKey(docTextValue(entry["id"])))
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, receiptOperationError()
	}
	stage, err := object(raw, "receipt", "envelope")
	if err != nil {
		return nil, err
	}
	desc, err := receiptProofDescriptor(stage)
	if err != nil || !creationEqual(desc, op["stage"]) {
		return nil, receiptOperationError()
	}
	receipt, err := CheckReceiptOperationCertificate(op, c.identity.Public.ID, entry, stage["receipt"])
	if err != nil {
		return nil, err
	}
	if op["phase"] == "signed" {
		if stage["envelope"] != nil {
			return nil, receiptOperationError()
		}
	} else {
		if op["phase"] != "queued" || stage["envelope"] == nil {
			return nil, receiptOperationError()
		}
		bundle, err := inboxBundle(stage["envelope"])
		if err != nil {
			return nil, err
		}
		plain, err := core.DecryptBundleAt(bundle, &c.identity, bundle.Manifest.Created)
		if err != nil {
			return nil, err
		}
		content, err := MatchContributionReceiptEnvelope(bundle, plain)
		if err != nil {
			return nil, err
		}
		transport := op["transport"].(map[string]any)
		bytes, _ := core.Canonical(bundle)
		if !creationEqual(content["receipt"], receipt) || transport["bundleId"] != bundle.Manifest.ID || transport["bundleHash"] != core.Hash(bytes) {
			return nil, receiptOperationError()
		}
	}
	return stage, nil
}
func (c *ContributionInbox) receiptEntry(record map[string]any, id string, allow ContributionPolicy) (map[string]any, error) {
	e := inboxEntry(record, id)
	if e == nil {
		return nil, errors.New("intenção de recibo indisponível")
	}
	op, ok := e["receipt"].(map[string]any)
	if !ok || op["phase"] == "expired" {
		return nil, errors.New("intenção de recibo indisponível")
	}
	target := e["target"].(map[string]any)
	if err := allow(docTextValue(target["snapshotId"]), docTextValue(e["contributorId"])); err != nil {
		return nil, err
	}
	if err := allow(docTextValue(target["snapshotId"]), c.identity.Public.ID); err != nil {
		return nil, err
	}
	if !receiptOperationLive(op, c.now()) {
		return nil, errors.New("recibo expirado")
	}
	return e, nil
}
func (c *ContributionInbox) SignReceipt(id string, allow ContributionPolicy) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, receipts *PrivateRecords) error {
		e, err := c.receiptEntry(record, id, allow)
		if err != nil {
			return err
		}
		op := e["receipt"].(map[string]any)
		if op["phase"] != "prepared" {
			if _, err = c.readReceipt(receipts, e); err != nil {
				return err
			}
			result = e
			return nil
		}
		_, found, err := receipts.Read(receiptProofKey(id))
		if err != nil {
			return err
		}
		if found {
			return privateIntegrity("assinatura sem intenção de recibo")
		}
		identity := c.identity
		identity.Public, err = receiptCard(op["owner"])
		if err != nil {
			return err
		}
		receipt, err := CreateContributionReceipt(identity, op["request"])
		if err != nil {
			return err
		}
		stage := map[string]any{"receipt": receipt, "envelope": nil}
		desc, err := receiptProofDescriptor(stage)
		if err != nil {
			return err
		}
		next, err := SignReceiptOperation(op, c.identity.Public.ID, e, receipt, desc, c.now())
		if err != nil {
			return err
		}
		record, result, err = UpdateInboxReceipt(record, c.identity.Public.ID, id, next)
		if err != nil {
			return err
		}
		if err = receipts.Write(receiptProofKey(id), stage); err != nil {
			return err
		}
		return values.Write(c.key+":record", record)
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (c *ContributionInbox) SealReceipt(id string, allow ContributionPolicy) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, receipts *PrivateRecords) error {
		e, err := c.receiptEntry(record, id, allow)
		if err != nil {
			return err
		}
		op := e["receipt"].(map[string]any)
		if op["phase"] == "prepared" {
			return errors.New("assinatura de recibo em falta")
		}
		stage, err := c.readReceipt(receipts, e)
		if err != nil {
			return err
		}
		if op["phase"] == "queued" {
			result = e
			return nil
		}
		identity := c.identity
		identity.Public, err = receiptCard(op["owner"])
		if err != nil {
			return err
		}
		if identity.Public.BoxKey != c.identity.Public.BoxKey {
			return errors.New("chave histórica de leitura do dono indisponível")
		}
		recipient, err := receiptCard(op["recipient"])
		if err != nil {
			return err
		}
		q := op["request"].(map[string]any)
		created, _ := contributionClock(q["created"])
		expires, _ := contributionClock(q["expires"])
		plain := map[string]any{"type": "site-contribution-receipt", "receipt": stage["receipt"]}
		bundle, err := core.CreateBundleAt(identity, "site-contribution-receipt", plain, []core.PublicIdentity{recipient}, false, expires-created, created)
		if err != nil {
			return err
		}
		if _, err = MatchContributionReceiptEnvelope(bundle, plain); err != nil {
			return err
		}
		stage["envelope"] = bundle
		desc, err := receiptProofDescriptor(stage)
		if err != nil {
			return err
		}
		bytes, _ := core.Canonical(bundle)
		next, err := QueueReceiptOperation(op, c.identity.Public.ID, e, map[string]any{"id": bundle.Manifest.ID, "hash": core.Hash(bytes)}, desc, c.now())
		if err != nil {
			return err
		}
		record, result, err = UpdateInboxReceipt(record, c.identity.Public.ID, id, next)
		if err != nil {
			return err
		}
		if err = receipts.Write(receiptProofKey(id), stage); err != nil {
			return err
		}
		return values.Write(c.key+":record", record)
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (c *ContributionInbox) ReceiptBundle(id string, allow ContributionPolicy) (*core.Bundle, error) {
	var result *core.Bundle
	err := c.run(func(_ *PrivateRecords, record map[string]any, receipts *PrivateRecords) error {
		e, err := c.receiptEntry(record, id, allow)
		if err != nil {
			return err
		}
		if e["receipt"].(map[string]any)["phase"] != "queued" {
			return nil
		}
		stage, err := c.readReceipt(receipts, e)
		if err != nil {
			return err
		}
		bundle, err := inboxBundle(stage["envelope"])
		if err != nil {
			return err
		}
		result = &bundle
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (c *ContributionInbox) CopyReceipt(id string, actual core.Bundle, allow ContributionPolicy) (map[string]any, error) {
	bundle, err := inboxBundle(actual)
	if err != nil {
		return nil, err
	}
	if err = core.VerifyBundleAt(bundle, bundle.Manifest.Created); err != nil {
		return nil, err
	}
	var result map[string]any
	err = c.run(func(values *PrivateRecords, record map[string]any, receipts *PrivateRecords) error {
		e, err := c.receiptEntry(record, id, allow)
		if err != nil {
			return err
		}
		stage, err := c.readReceipt(receipts, e)
		if err != nil {
			return err
		}
		if !creationEqual(stage["envelope"], bundle) {
			return privateIntegrity("cópia do recibo diferente")
		}
		bytes, _ := core.Canonical(bundle)
		next, err := CopyReceiptOperation(e["receipt"], c.identity.Public.ID, e, bundle.Manifest.ID, core.Hash(bytes), c.now())
		if err != nil {
			return err
		}
		updated, entry, err := UpdateInboxReceipt(record, c.identity.Public.ID, id, next)
		if err != nil {
			return err
		}
		result = entry
		if !creationEqual(updated["revision"], record["revision"]) {
			return values.Write(c.key+":record", updated)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
