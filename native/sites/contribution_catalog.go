package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"time"
)

// ContributionCatalog prepares private intent and signs in separate commits.
// It does not send, publish, approve or put signatures into peer inventory.
type ContributionCatalog struct {
	database CatalogDatabase
	identity core.Identity
	key      string
	now      func() int64
}
type contributionStage struct {
	request     map[string]any
	source      core.Bundle
	certificate any
	envelope    *core.Bundle
}
type ContributionPolicy func(snapshotID, siteOwnerID string) error

func NewContributionCatalog(database CatalogDatabase, identity core.Identity) *ContributionCatalog {
	text, _ := core.Canonical(map[string]any{"domain": "relayloom/contribution-catalog-key/1", "owner": identity.Public.ID})
	return &ContributionCatalog{database, identity, "contribution:" + core.Hash(text), func() int64 { return time.Now().UnixMilli() }}
}
func (c *ContributionCatalog) source(request map[string]any, bundle core.Bundle, now int64) (*ResolvedContributionForm, error) {
	if err := core.VerifyBundleAt(bundle, now); err != nil {
		return nil, err
	}
	value, err := core.DecryptBundleAt(bundle, &c.identity, now)
	if err != nil {
		return nil, err
	}
	return ResolveContributionForm(map[string]any{"action": "form", "snapshotId": request["snapshotId"], "pageId": request["pageId"], "formId": request["formId"]}, bundle, value, c.identity.Public.ID, now)
}
func (s *contributionStage) value() map[string]any {
	value := map[string]any{"request": s.request, "source": s.source, "certificate": s.certificate}
	if s.envelope != nil {
		value["envelope"] = *s.envelope
	}
	return value
}

func (c *ContributionCatalog) run(callback func(*PrivateRecords, map[string]any, *contributionStage) error) error {
	return c.database.Update(func(tx *groupstore.Tx) error {
		return RunContributionPrivate(tx, c.identity, func(values *PrivateRecords) error {
			saved, found, err := values.Read(c.key + ":record")
			if err != nil {
				return err
			}
			raw, staged, err := values.Read(c.key + ":stage")
			if err != nil {
				return err
			}
			var record map[string]any
			if !found {
				keys, err := tx.Keys("contribution:")
				if err != nil {
					return err
				}
				if len(keys) != 0 {
					return privateIntegrity("registo de propostas ausente com dados existentes")
				}
				record, err = InitialContributionRecord(c.identity.Public.ID)
				if err != nil {
					return err
				}
			} else {
				record, err = ValidateContributionRecord(saved, c.identity.Public.ID)
				if err != nil {
					return privateIntegrity("registo de propostas inválido")
				}
			}
			var op map[string]any
			for _, value := range record["operations"].([]any) {
				if contributionPending(value.(map[string]any)) {
					op = value.(map[string]any)
				}
			}
			var stage *contributionStage
			if op != nil {
				if !staged {
					return privateIntegrity("preparação de proposta em falta")
				}
				entry, err := object(raw, "request", "source", "certificate")
				if err != nil {
					entry, err = object(raw, "request", "source", "certificate", "envelope")
				}
				if err != nil {
					return privateIntegrity("preparação de proposta inválida")
				}
				request, fingerprint, err := ContributionCreationRequest(entry["request"], c.identity.Public.ID)
				if err != nil {
					return privateIntegrity("pedido preparado inválido")
				}
				if fingerprint != op["fingerprint"] || !creationEqual(request["sequence"], op["sequence"]) || request["operationId"] != op["operationId"] {
					return privateIntegrity("intenção privada diferente")
				}
				encoded, err := core.Canonical(entry["source"])
				if err != nil {
					return err
				}
				source, err := core.DecodeBundle(encoded)
				if err != nil {
					return privateIntegrity("snapshot preparado ilegível")
				}
				created, _ := contributionClock(op["created"])
				resolved, err := c.source(request, source, created)
				if err != nil {
					return privateIntegrity("snapshot preparado inválido")
				}
				schema, err := ContributionSchemaHash(resolved.Context.Form, resolved.Context.Table)
				if err != nil {
					return err
				}
				if !creationEqual(resolved.Context.Target, op["target"]) || schema != op["schemaHash"] {
					return privateIntegrity("snapshot preparado diferente")
				}
				ttl, _ := creationNumber(request["ttlMs"])
				expires, _ := contributionClock(op["expires"])
				if expires != min(created+ttl, resolved.Context.SnapshotExpires) {
					return privateIntegrity("prazo privado diferente da intenção")
				}
				certificate := entry["certificate"]
				if op["phase"] == "prepared" {
					if certificate != nil {
						return privateIntegrity("assinatura sem autorização guardada")
					}
				} else {
					if certificate == nil {
						return privateIntegrity("assinatura preparada em falta")
					}
					if _, _, err = SignContributionIntent(record, c.identity.Public.ID, contributionHandle(op), request, certificate); err != nil {
						return privateIntegrity("assinatura preparada diferente")
					}
					if _, err = VerifyContributionForSubmission(certificate, resolved.Context, created); err != nil {
						return privateIntegrity("certificado preparado não autorizado")
					}
				}
				stage = &contributionStage{request: request, source: source, certificate: certificate}
				if rawEnvelope, present := entry["envelope"]; present {
					if op["phase"] != "signed" {
						return privateIntegrity("envelope sem proposta assinada")
					}
					bytes, err := core.Canonical(rawEnvelope)
					if err != nil {
						return err
					}
					envelope, err := core.DecodeBundle(bytes)
					if err != nil {
						return privateIntegrity("envelope preparado inválido")
					}
					if err = c.verifyEnvelope(envelope, certificate); err != nil {
						return err
					}
					stage.envelope = &envelope
				}
				now := c.now()
				if expires <= now {
					record, err = ExpireContributionIntent(record, c.identity.Public.ID, now)
					if err != nil {
						return err
					}
					if err = values.Remove(c.key + ":stage"); err != nil {
						return err
					}
					if err = values.Write(c.key+":record", record); err != nil {
						return err
					}
					stage = nil
				}
			} else if staged {
				return privateIntegrity("preparação sem operação pendente")
			}
			return callback(values, record, stage)
		})
	})
}
func (c *ContributionCatalog) verifyEnvelope(bundle core.Bundle, certificate any) error {
	if err := core.VerifyBundleAt(bundle, bundle.Manifest.Created); err != nil {
		return err
	}
	value, err := core.DecryptBundleAt(bundle, &c.identity, bundle.Manifest.Created)
	if err != nil {
		return err
	}
	content, err := MatchContributionEnvelope(bundle, value)
	if err != nil {
		return err
	}
	if !creationEqual(content["proposal"], certificate) {
		return privateIntegrity("envelope de outra preparação")
	}
	return nil
}
func (c *ContributionCatalog) State() (map[string]any, error) {
	var result map[string]any
	err := c.run(func(_ *PrivateRecords, record map[string]any, _ *contributionStage) error {
		var err error
		result, err = creationClone(record, ContributionRecordBytes)
		return err
	})
	return result, err
}
func (c *ContributionCatalog) Operation(sequence int64, id string) (map[string]any, bool, error) {
	var result map[string]any
	var retired bool
	err := c.run(func(_ *PrivateRecords, record map[string]any, _ *contributionStage) error {
		var err error
		_, result, retired, err = LookupContributionOperation(record, c.identity.Public.ID, sequence, id)
		return err
	})
	return result, retired, err
}
func (c *ContributionCatalog) Prepare(input any, load func() (core.Bundle, error), allow ContributionPolicy) (map[string]any, error) {
	q, fingerprint, err := ContributionCreationRequest(input, c.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	seq, _ := creationNumber(q["sequence"])
	id := docTextValue(q["operationId"])
	var result map[string]any
	err = c.run(func(values *PrivateRecords, record map[string]any, _ *contributionStage) error {
		_, previous, retired, err := LookupContributionOperation(record, c.identity.Public.ID, seq, id)
		if err != nil {
			return err
		}
		if previous != nil {
			if previous["fingerprint"] != fingerprint {
				return contributionJournalError()
			}
			result = previous
			return nil
		}
		next, _ := creationNumber(record["nextSequence"])
		if retired || next != seq {
			return contributionJournalError()
		}
		for _, value := range record["operations"].([]any) {
			if contributionPending(value.(map[string]any)) {
				return contributionJournalError()
			}
		}
		loaded, err := load()
		if err != nil {
			return err
		}
		bytes, err := core.Canonical(loaded)
		if err != nil {
			return err
		}
		source, err := core.DecodeBundle(bytes)
		if err != nil {
			return err
		}
		resolved, err := c.source(q, source, c.now())
		if err != nil {
			return err
		}
		if err = allow(source.Manifest.ID, source.Manifest.Author.ID); err != nil {
			return err
		}
		updated, op, err := PrepareContributionIntent(record, c.identity.Public.ID, q, resolved.Context, c.now())
		if err != nil {
			return err
		}
		stage := contributionStage{request: q, source: source}
		if err = values.Write(c.key+":stage", stage.value()); err != nil {
			return err
		}
		if err = values.Write(c.key+":record", updated); err != nil {
			return err
		}
		result = op
		return nil
	})
	return result, err
}
func (c *ContributionCatalog) Sign(handle ContributionHandle, allow ContributionPolicy) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, stage *contributionStage) error {
		_, op, err := contributionJournalHandle(record, c.identity.Public.ID, handle)
		if err != nil {
			return err
		}
		if !contributionPending(op) {
			result = op
			return nil
		}
		if stage == nil {
			return privateIntegrity("preparação em falta")
		}
		now := c.now()
		source, err := c.source(stage.request, stage.source, now)
		if err != nil {
			return err
		}
		target := source.Context.Target.(map[string]any)
		if err = allow(docTextValue(target["snapshotId"]), source.Owner.ID); err != nil {
			return err
		}
		if op["phase"] == "signed" {
			result = op
			return nil
		}
		expires, _ := contributionClock(op["expires"])
		if expires <= c.now() {
			return errors.New("a proposta expirou durante a verificação de política")
		}

		certificate, err := CreateContribution(c.identity, map[string]any{"target": source.Context.Target, "schemaHash": op["schemaHash"], "operationId": op["operationId"], "created": op["created"], "expires": op["expires"], "values": stage.request["values"], "publicationScope": stage.request["publicationScope"]})
		if err != nil {
			return err
		}
		if _, err = VerifyContributionForSubmission(certificate, source.Context, c.now()); err != nil {
			return err
		}
		updated, signed, err := SignContributionIntent(record, c.identity.Public.ID, handle, stage.request, certificate)
		if err != nil {
			return err
		}
		stage.certificate = certificate
		if err = values.Write(c.key+":stage", stage.value()); err != nil {
			return err
		}
		if err = values.Write(c.key+":record", updated); err != nil {
			return err
		}
		result = signed
		return nil
	})
	return result, err
}
func (c *ContributionCatalog) AuthorizedCertificate(handle ContributionHandle, allow ContributionPolicy) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(_ *PrivateRecords, record map[string]any, stage *contributionStage) error {
		_, op, err := contributionJournalHandle(record, c.identity.Public.ID, handle)
		if err != nil {
			return err
		}
		if op["phase"] != "signed" {
			return nil
		}
		if stage == nil || stage.certificate == nil {
			return privateIntegrity("assinatura em falta")
		}
		source, err := c.source(stage.request, stage.source, c.now())
		if err != nil {
			return err
		}
		target := source.Context.Target.(map[string]any)
		if err = allow(docTextValue(target["snapshotId"]), source.Owner.ID); err != nil {
			return err
		}
		result, err = VerifyContributionForSubmission(stage.certificate, source.Context, c.now())
		return err
	})
	return result, err
}
func (c *ContributionCatalog) Seal(handle ContributionHandle, allow ContributionPolicy) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, stage *contributionStage) error {
		_, op, err := contributionJournalHandle(record, c.identity.Public.ID, handle)
		if err != nil {
			return err
		}
		if op["phase"] != "signed" {
			result = map[string]any{"operation": op, "bundleId": nil}
			return nil
		}
		if stage == nil || stage.certificate == nil {
			return privateIntegrity("proposta assinada indisponível")
		}
		source, err := c.source(stage.request, stage.source, c.now())
		if err != nil {
			return err
		}
		target := source.Context.Target.(map[string]any)
		if err = allow(docTextValue(target["snapshotId"]), source.Owner.ID); err != nil {
			return err
		}
		certificate, err := VerifyContributionForSubmission(stage.certificate, source.Context, c.now())
		if err != nil {
			return err
		}
		envelope := stage.envelope
		if envelope == nil {
			created, _ := contributionClock(op["created"])
			expires, _ := contributionClock(op["expires"])
			sealed, err := core.CreateBundleAt(c.identity, "site-contribution", map[string]any{"type": "site-contribution", "proposal": certificate}, []core.PublicIdentity{source.Owner}, false, expires-created, created)
			if err != nil {
				return err
			}
			envelope = &sealed
		}
		if err = c.verifyEnvelope(*envelope, certificate); err != nil {
			return err
		}
		if _, err = VerifyContributionForSubmission(certificate, source.Context, c.now()); err != nil {
			return err
		}
		if stage.envelope == nil {
			stage.envelope = envelope
			if err = values.Write(c.key+":stage", stage.value()); err != nil {
				return err
			}
		}
		result = map[string]any{"operation": op, "bundleId": envelope.Manifest.ID}
		return nil
	})
	return result, err
}
func (c *ContributionCatalog) AuthorizedBundle(handle ContributionHandle, allow ContributionPolicy) (*core.Bundle, error) {
	var result *core.Bundle
	err := c.run(func(_ *PrivateRecords, record map[string]any, stage *contributionStage) error {
		_, op, err := contributionJournalHandle(record, c.identity.Public.ID, handle)
		if err != nil {
			return err
		}
		if op["phase"] != "signed" || stage == nil || stage.envelope == nil {
			return nil
		}
		if stage.certificate == nil {
			return privateIntegrity("assinatura em falta")
		}
		source, err := c.source(stage.request, stage.source, c.now())
		if err != nil {
			return err
		}
		target := source.Context.Target.(map[string]any)
		if err = allow(docTextValue(target["snapshotId"]), source.Owner.ID); err != nil {
			return err
		}
		if _, err = VerifyContributionForSubmission(stage.certificate, source.Context, c.now()); err != nil {
			return err
		}
		if err = c.verifyEnvelope(*stage.envelope, stage.certificate); err != nil {
			return err
		}
		if _, err = VerifyContributionForSubmission(stage.certificate, source.Context, c.now()); err != nil {
			return err
		}
		bytes, err := core.Canonical(*stage.envelope)
		if err != nil {
			return err
		}
		owned, err := core.DecodeBundle(bytes)
		if err != nil {
			return err
		}
		result = &owned
		return nil
	})
	return result, err
}
func (c *ContributionCatalog) Cancel(handle ContributionHandle) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, _ *contributionStage) error {
		updated, err := CancelContributionIntent(record, c.identity.Public.ID, handle)
		if err != nil {
			return err
		}
		if err = values.Write(c.key+":record", updated); err != nil {
			return err
		}
		if err = values.Remove(c.key + ":stage"); err != nil {
			return err
		}
		_, result, _, err = LookupContributionOperation(updated, c.identity.Public.ID, handle.Sequence, handle.OperationID)
		return err
	})
	return result, err
}
