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
func (c *ContributionInbox) run(callback func(*PrivateRecords, map[string]any) error) error {
	return c.database.Update(func(tx *groupstore.Tx) error {
		return RunContributionInboxPrivate(tx, c.identity, func(values *PrivateRecords) error {
			saved, found, err := values.Read(c.key + ":record")
			if err != nil {
				return err
			}
			keys, err := tx.Keys("contribution-inbox:")
			if err != nil {
				return err
			}
			var record map[string]any
			if !found {
				if len(keys) != 0 {
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
			next, err := ExpireContributionInbox(record, c.identity.Public.ID, c.now())
			if err != nil {
				return err
			}
			if !creationEqual(next["revision"], record["revision"]) {
				for _, raw := range record["entries"].([]any) {
					e := raw.(map[string]any)
					n := inboxEntry(next, docTextValue(e["id"]))
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
			return callback(values, record)
		})
	})
}
func (c *ContributionInbox) State() (map[string]any, error) {
	var result map[string]any
	err := c.run(func(_ *PrivateRecords, r map[string]any) error { result = r; return nil })
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
	err = c.run(func(values *PrivateRecords, record map[string]any) error {
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
	err = c.run(func(values *PrivateRecords, record map[string]any) error {
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
	err := c.run(func(values *PrivateRecords, record map[string]any) error {
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
		result = map[string]any{"entry": e, "proposal": proposal, "source": *proof.source}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
