package groupauthority

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"sort"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

type Result struct {
	GroupID     string  `json:"groupId"`
	EpochID     *string `json:"epochId"`
	Certificate any     `json:"certificate"`
}
type operation struct {
	Version     int    `json:"version"`
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Fingerprint string `json:"fingerprint"`
	Sequence    int64  `json:"sequence"`
	Result      Result `json:"result"`
}

var operationID = regexp.MustCompile(`(?i)^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

func operationKind(kind string) bool {
	switch kind {
	case "create", "invite", "remember-invitation", "accept", "commit", "close", "leave":
		return true
	}
	return false
}
func (g *Registry) readOperation(tx *groupstore.Tx, key string, data []byte, records map[string]*record) (*operation, error) {
	op, err := g.decodeOperation(tx, key, data, records)
	if err != nil {
		return nil, integrity(err)
	}
	return op, nil
}
func (g *Registry) decodeOperation(tx *groupstore.Tx, key string, data []byte, records map[string]*record) (*operation, error) {
	if _, err := core.DecodeJSON(data, OperationBytes); err != nil {
		return nil, err
	}
	var op operation
	if err := json.Unmarshal(data, &op); err != nil {
		return nil, err
	}
	encoded, err := core.Canonical(op)
	if err != nil || !bytes.Equal(encoded, data) {
		return nil, errors.New("campos da operação inválidos")
	}
	revision, exists, err := tx.RecordRevision(key)
	if err != nil {
		return nil, err
	}
	if op.Version != 1 || !operationID.MatchString(op.ID) || key != "operation:"+op.ID || !operationKind(op.Kind) || !core.ValidAddress(op.Fingerprint) || op.Sequence < 1 || !exists || op.Sequence != revision || !core.ValidAddress(op.Result.GroupID) || (op.Result.EpochID != nil && !core.ValidAddress(*op.Result.EpochID)) {
		return nil, errors.New("operação persistida inválida")
	}
	r := records[op.Result.GroupID]
	if r == nil {
		r, err = g.record(tx, op.Result.GroupID)
		if err != nil {
			return nil, err
		}
		if records != nil {
			records[op.Result.GroupID] = r
		}
	}
	switch op.Kind {
	case "create", "commit", "close":
		if op.Result.Certificate != nil || op.Result.EpochID == nil {
			return nil, errors.New("resultado de época inválido")
		}
	default:
		if op.Result.Certificate == nil {
			if op.Kind != "leave" {
				return nil, errors.New("certificado de operação ausente")
			}
			return &op, nil
		}
		cert, ok := op.Result.Certificate.(map[string]any)
		if !ok || len(cert) != 3 {
			return nil, errors.New("certificado inválido")
		}
		body, ok := cert["body"].(map[string]any)
		if !ok {
			return nil, errors.New("corpo de certificado inválido")
		}
		signer := g.identity.Public
		domain := "leave"
		if op.Kind == "invite" || op.Kind == "remember-invitation" {
			signer = r.Anchor.Body.Creator
			domain = "invitation"
		} else if op.Kind == "accept" {
			domain = "consent"
		}
		signature, ok := cert["signature"].(string)
		if !ok {
			return nil, errors.New("assinatura ausente")
		}
		sig, err := base64.StdEncoding.Strict().DecodeString(signature)
		if err != nil || len(sig) != 64 || base64.StdEncoding.EncodeToString(sig) != signature {
			return nil, errors.New("assinatura inválida")
		}
		data, err := core.Canonical(body)
		if err != nil {
			return nil, err
		}
		if body["domain"] != "relayloom/group-"+domain+"/1" || body["groupId"] != r.Anchor.ID || op.Result.EpochID == nil || body["parentEpochId"] != *op.Result.EpochID || cert["id"] != core.Hash(data) {
			return nil, errors.New("certificado de operação incoerente")
		}
		keyBytes, err := base64.StdEncoding.Strict().DecodeString(signer.SignKey)
		if err != nil {
			return nil, err
		}
		parsed, err := x509.ParsePKIXPublicKey(keyBytes)
		if err != nil {
			return nil, err
		}
		public, ok := parsed.(ed25519.PublicKey)
		if !ok || !ed25519.Verify(public, data, sig) {
			return nil, errors.New("assinatura de operação inválida")
		}
	}
	return &op, nil
}
func (g *Registry) operation(id, kind string, input any, apply func(*groupstore.Tx) (Result, error)) (Result, error) {
	var result Result
	if !operationID.MatchString(id) {
		return result, errors.New("identificador de operação inválido")
	}
	normalized, err := core.Canonical(map[string]any{"kind": kind, "input": input})
	if err != nil {
		return result, err
	}
	fingerprint := core.Hash(normalized)
	key := "operation:" + id
	err = g.store.Update(func(tx *groupstore.Tx) error {
		previous, exists, err := tx.Get(key)
		if err != nil {
			return err
		}
		if exists {
			op, err := g.readOperation(tx, key, previous, nil)
			if err != nil {
				return err
			}
			if op.Kind != kind || op.Fingerprint != fingerprint {
				return errors.New("a operação já foi usada com outro pedido")
			}
			result = op.Result
			return nil
		}
		keys, err := tx.Keys("operation:")
		if err != nil {
			return err
		}
		if len(keys) > OperationLimit {
			return integrity(errors.New("limite de operações ultrapassado"))
		}
		if len(keys) == OperationLimit {
			// No candidate is deleted until the complete scan finishes. Only the
			// group checkpoint is reused here; every operation still has its own
			// revision and signature checked. Never reuse this across transactions.
			records := make(map[string]*record)
			type retained struct {
				key      string
				sequence int64
			}
			ops := make([]retained, 0, len(keys))
			for _, key := range keys {
				data, _, err := tx.Get(key)
				if err != nil {
					return err
				}
				op, err := g.readOperation(tx, key, data, records)
				if err != nil {
					return err
				}
				ops = append(ops, retained{key, op.Sequence})
			}
			sort.Slice(ops, func(i, j int) bool {
				if ops[i].sequence == ops[j].sequence {
					return ops[i].key < ops[j].key
				}
				return ops[i].sequence < ops[j].sequence
			})
			if err = tx.Delete(ops[0].key); err != nil {
				return err
			}
		}
		result, err = apply(tx)
		if err != nil {
			return err
		}
		accounting, err := tx.Accounting()
		if err != nil {
			return err
		}
		op := operation{1, id, kind, fingerprint, accounting.Revision + 1, result}
		data, err := core.Canonical(op)
		if err != nil {
			return err
		}
		if len(data) > OperationBytes {
			return errors.New("operação excede a reserva individual")
		}
		class := groupstore.Data
		if kind == "leave" || kind == "close" {
			class = groupstore.Checkpoint
		}
		return tx.Put(key, data, class)
	})
	return result, err
}
func (g *Registry) OperationStatus(id string) (*Result, error) {
	if !operationID.MatchString(id) {
		return nil, errors.New("identificador de operação inválido")
	}
	var result *Result
	err := g.store.View(func(tx *groupstore.Tx) error {
		key := "operation:" + id
		data, exists, err := tx.Get(key)
		if err != nil || !exists {
			return err
		}
		op, err := g.readOperation(tx, key, data, nil)
		if err != nil {
			return err
		}
		result = &op.Result
		return nil
	})
	return result, err
}
