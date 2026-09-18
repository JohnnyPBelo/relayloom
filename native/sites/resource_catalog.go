package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"sort"
	"time"
)

// ResourceCatalog journals signing-owned creation, never automatic broadcast.
// The runtime remains responsible for copying and verifying the exact bundle.
type ResourceCatalog struct {
	database CatalogDatabase
	identity core.Identity
	key      string
	now      func() int64
}
type ResourceHandle struct {
	Sequence    int64  `json:"sequence"`
	OperationID string `json:"operationId"`
	Fingerprint string `json:"fingerprint"`
}

func NewResourceCatalog(database CatalogDatabase, identity core.Identity) *ResourceCatalog {
	key, _ := core.Canonical(map[string]any{"domain": "relayloom/resource-catalog-key/1", "owner": identity.Public.ID})
	return &ResourceCatalog{database, identity, "resource:" + core.Hash(key), func() int64 { return time.Now().UnixMilli() }}
}
func resourceHandle(op map[string]any) ResourceHandle {
	sequence, _ := creationNumber(op["sequence"])
	return ResourceHandle{sequence, docTextValue(op["operationId"]), docTextValue(op["fingerprint"])}
}
func (c *ResourceCatalog) verify(bundle core.Bundle, op map[string]any) error {
	if err := core.VerifyBundleAt(bundle, bundle.Manifest.Created); err != nil {
		return err
	}
	if bundle.Manifest.Kind != "site-resource" || bundle.Manifest.Author.ID != c.identity.Public.ID {
		return creationError()
	}
	value, err := core.DecryptBundleAt(bundle, &c.identity, bundle.Manifest.Created)
	if err != nil {
		return err
	}
	resource, err := ParseResource(value)
	if err != nil {
		return err
	}
	ref, err := DescribeResource(resource, map[string]any{"id": bundle.Manifest.ID, "authorId": bundle.Manifest.Author.ID, "kind": bundle.Manifest.Kind})
	if err != nil {
		return err
	}
	created, _ := creationNumber(op["created"])
	expires, _ := creationNumber(op["expires"])
	encoded, err := core.Canonical(bundle)
	if err != nil {
		return err
	}
	if !creationEqual(ref, op["reference"]) || !creationEqual(readersOf(bundle), op["recipients"]) || bundle.Manifest.Created != created || bundle.Manifest.Expires != expires || core.Hash(encoded) != op["bundleHash"] {
		return creationError()
	}
	return nil
}
func (c *ResourceCatalog) run(callback func(*PrivateRecords, map[string]any, *core.Bundle) error) error {
	return c.database.Update(func(tx *groupstore.Tx) error {
		return RunResourcePrivate(tx, c.identity, func(values *PrivateRecords) error {
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
				keys, err := tx.Keys("resource:")
				if err != nil {
					return err
				}
				if len(keys) != 0 {
					return privateIntegrity("registo de recursos ausente com dados existentes")
				}
				record, err = InitialResourceRecord(c.identity.Public.ID)
				if err != nil {
					return err
				}
			} else {
				record, err = ValidateResourceRecord(saved, c.identity.Public.ID)
				if err != nil {
					return privateIntegrity("registo de criação de recursos inválido")
				}
			}
			var pending map[string]any
			for _, item := range record["operations"].([]any) {
				op := item.(map[string]any)
				if op["phase"] == "copy-pending" {
					pending = op
				}
			}
			var bundle *core.Bundle
			if pending != nil {
				if !staged {
					return privateIntegrity("preparação de recurso em falta")
				}
				encoded, err := core.Canonical(raw)
				if err != nil {
					return privateIntegrity("preparação ilegível")
				}
				decoded, err := core.DecodeBundle(encoded)
				if err != nil || c.verify(decoded, pending) != nil {
					return privateIntegrity("preparação de recurso inválida")
				}
				bundle = &decoded
				if decoded.Manifest.Expires <= c.now() {
					record, err = ExpireResourceCreation(record, c.identity.Public.ID, c.now())
					if err != nil {
						return err
					}
					if err = values.Remove(c.key + ":stage"); err != nil {
						return err
					}
					if err = values.Write(c.key+":record", record); err != nil {
						return err
					}
					bundle = nil
				}
			} else if staged {
				return privateIntegrity("assinatura sem operação pendente")
			}
			return callback(values, record, bundle)
		})
	})
}
func (c *ResourceCatalog) State() (map[string]any, error) {
	var result map[string]any
	err := c.run(func(_ *PrivateRecords, r map[string]any, _ *core.Bundle) error {
		var err error
		result, err = creationClone(r, ResourceRecordBytes)
		return err
	})
	return result, err
}
func (c *ResourceCatalog) Operation(sequence int64, id string) (map[string]any, bool, error) {
	var result map[string]any
	var retired bool
	err := c.run(func(_ *PrivateRecords, r map[string]any, _ *core.Bundle) error {
		var err error
		_, result, retired, err = LookupResourceOperation(r, c.identity.Public.ID, sequence, id)
		return err
	})
	return result, retired, err
}

// resolve is called only for a new operation; retries don't depend on changed
// contact cards and never create another signature with a fresh nonce.
func (c *ResourceCatalog) Prepare(input any, resolve func(any) ([]core.PublicIdentity, bool, error)) (map[string]any, error) {
	q, fingerprint, err := ResourceCreationRequest(input, c.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	sequence, _ := creationNumber(q["sequence"])
	id := docTextValue(q["operationId"])
	var result map[string]any
	err = c.run(func(values *PrivateRecords, record map[string]any, _ *core.Bundle) error {
		_, prior, retired, err := LookupResourceOperation(record, c.identity.Public.ID, sequence, id)
		if err != nil {
			return err
		}
		if prior != nil {
			if prior["fingerprint"] != fingerprint {
				return errors.New("pedido de recurso repetido com outros valores")
			}
			result = prior
			return nil
		}
		next, _ := creationNumber(record["nextSequence"])
		if retired || sequence != next {
			return creationError()
		}
		for _, raw := range record["operations"].([]any) {
			if raw.(map[string]any)["phase"] == "copy-pending" {
				return errors.New("recurso pendente")
			}
		}
		cards, public, err := resolve(q["recipients"])
		if err != nil {
			return err
		}
		var scope any = "public"
		if !public {
			if len(cards) < 1 || len(cards) > 64 {
				return creationError()
			}
			ids := []string{}
			seen := map[string]bool{}
			for _, card := range cards {
				if core.ValidateIdentity(card) != nil || seen[card.ID] {
					return creationError()
				}
				ids = append(ids, card.ID)
				seen[card.ID] = true
			}
			sort.Strings(ids)
			scope = ids
		}
		if !creationEqual(scope, q["recipients"]) {
			return errors.New("cartões diferentes dos leitores")
		}
		ttl, _ := creationNumber(q["ttlMs"])
		bundle, err := core.CreateBundleAt(c.identity, "site-resource", q["content"], cards, public, ttl, c.now())
		if err != nil {
			return err
		}
		ref, err := DescribeResource(q["content"], map[string]any{"id": bundle.Manifest.ID, "authorId": bundle.Manifest.Author.ID, "kind": bundle.Manifest.Kind})
		if err != nil {
			return err
		}
		encoded, err := core.Canonical(bundle)
		if err != nil {
			return err
		}
		updated, op, err := PrepareResourceCreation(record, c.identity.Public.ID, q, map[string]any{"reference": ref, "created": bundle.Manifest.Created, "expires": bundle.Manifest.Expires, "bundleHash": core.Hash(encoded), "recipients": q["recipients"]})
		if err != nil {
			return err
		}
		if err = c.verify(bundle, op); err != nil {
			return err
		}
		if err = values.Write(c.key+":stage", bundle); err != nil {
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
func (c *ResourceCatalog) AuthorizedBundle(handle ResourceHandle) (*core.Bundle, error) {
	var result *core.Bundle
	err := c.run(func(_ *PrivateRecords, record map[string]any, stage *core.Bundle) error {
		_, op, _, err := LookupResourceOperation(record, c.identity.Public.ID, handle.Sequence, handle.OperationID)
		if err != nil {
			return err
		}
		if op == nil || op["fingerprint"] != handle.Fingerprint {
			return errors.New("resultado de criação desconhecido")
		}
		if op["phase"] != "copy-pending" {
			return nil
		}
		if stage == nil {
			return privateIntegrity("preparação em falta")
		}
		if err = core.VerifyBundleAt(*stage, c.now()); err != nil {
			return err
		}
		result = stage
		return nil
	})
	return result, err
}
func (c *ResourceCatalog) Ready(handle ResourceHandle, copied core.Bundle) (map[string]any, error) {
	var result map[string]any
	err := c.run(func(values *PrivateRecords, record map[string]any, stage *core.Bundle) error {
		_, op, _, err := LookupResourceOperation(record, c.identity.Public.ID, handle.Sequence, handle.OperationID)
		if err != nil {
			return err
		}
		if op == nil || op["fingerprint"] != handle.Fingerprint {
			return errors.New("resultado de criação desconhecido")
		}
		if err = c.verify(copied, op); err != nil {
			return err
		}
		if op["phase"] == "ready" {
			result = op
			return nil
		}
		if op["phase"] != "copy-pending" || stage == nil || !creationEqual(*stage, copied) {
			return errors.New("cópia diferente da preparação")
		}
		if err = core.VerifyBundleAt(copied, c.now()); err != nil {
			return err
		}
		data, err := core.Canonical(copied)
		if err != nil {
			return err
		}
		updated, err := ResourceCopyReady(record, c.identity.Public.ID, handle.Sequence, handle.OperationID, handle.Fingerprint, core.Hash(data))
		if err != nil {
			return err
		}
		if err = values.Write(c.key+":record", updated); err != nil {
			return err
		}
		if err = values.Remove(c.key + ":stage"); err != nil {
			return err
		}
		_, result, _, err = LookupResourceOperation(updated, c.identity.Public.ID, handle.Sequence, handle.OperationID)
		return err
	})
	return result, err
}
