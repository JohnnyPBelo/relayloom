// Package profilestate stores one bounded private document in the same protected
// SQLite transaction as authority metadata. Application semantics remain separate.
package profilestate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

const MaxBytes = 16 * 1024 * 1024
const ChunkBytes = 512 * 1024
const manifestKey = "application:state"
const prefix = manifestKey + ":"

type manifest struct {
	Domain string `json:"domain"`
	Bytes  int    `json:"bytes"`
	Chunks int    `json:"chunks"`
	Digest string `json:"digest"`
}
type State struct {
	Bytes  []byte
	Digest string
}

func partKey(i int) string           { return fmt.Sprintf("%s%04d", prefix, i) }
func integrity(message string) error { return fmt.Errorf("%w: %s", groupstore.ErrIntegrity, message) }
func decodeManifest(data []byte) (manifest, error) {
	var m manifest
	if _, err := core.DecodeJSON(data, 1024); err != nil {
		return m, integrity("manifesto privado ilegível")
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return m, integrity("manifesto privado inválido")
	}
	encoded, err := core.Canonical(m)
	if err != nil || !bytes.Equal(encoded, data) || m.Domain != "relayloom/profile-state/1" || m.Bytes < 1 || m.Bytes > MaxBytes || m.Chunks != (m.Bytes+ChunkBytes-1)/ChunkBytes || !core.ValidAddress(m.Digest) {
		return m, integrity("limites ou campos do manifesto privado inválidos")
	}
	return m, nil
}
func Read(tx *groupstore.Tx) (*State, error) {
	data, exists, err := tx.Get(manifestKey)
	if err != nil {
		return nil, err
	}
	keys, err := tx.Keys(prefix)
	if err != nil {
		return nil, err
	}
	if !exists {
		if len(keys) != 0 {
			return nil, integrity("blocos privados sem manifesto")
		}
		return nil, nil
	}
	m, err := decodeManifest(data)
	if err != nil {
		return nil, err
	}
	if len(keys) != m.Chunks {
		return nil, integrity("conjunto de blocos privados incompleto")
	}
	result := make([]byte, 0, m.Bytes)
	for i, key := range keys {
		if key != partKey(i) {
			return nil, integrity("nome de bloco privado inválido")
		}
		piece, exists, err := tx.Get(key)
		if err != nil {
			return nil, err
		}
		if !exists || len(piece) != min(ChunkBytes, m.Bytes-i*ChunkBytes) {
			return nil, integrity("bloco privado truncado")
		}
		result = append(result, piece...)
	}
	if core.Hash(result) != m.Digest {
		return nil, integrity("hash do estado privado não coincide")
	}
	return &State{result, m.Digest}, nil
}

// Write authenticates the previous blob and compares its digest before writing.
// Callers must wait for the outer SQLite commit before emitting side effects.
func Write(tx *groupstore.Tx, data []byte, expectedDigest *string) (string, error) {
	if len(data) < 1 || len(data) > MaxBytes {
		return "", errors.New("estado privado fora dos limites")
	}
	value, err := core.DecodeJSON(data, MaxBytes)
	if err != nil {
		return "", err
	}
	encoded, err := core.Canonical(value)
	if err != nil || !bytes.Equal(encoded, data) {
		return "", errors.New("estado privado não canónico")
	}
	previous, err := Read(tx)
	if err != nil {
		return "", err
	}
	if (previous == nil) != (expectedDigest == nil) || (previous != nil && previous.Digest != *expectedDigest) {
		return "", errors.New("o estado privado mudou; volte a lê-lo antes de guardar")
	}
	digest := core.Hash(data)
	if previous != nil && previous.Digest == digest {
		return digest, nil
	}
	chunks := (len(data) + ChunkBytes - 1) / ChunkBytes
	for i := 0; i < chunks; i++ {
		if err = tx.Put(partKey(i), data[i*ChunkBytes:min(len(data), (i+1)*ChunkBytes)], groupstore.Data); err != nil {
			return "", err
		}
	}
	keys, err := tx.Keys(prefix)
	if err != nil {
		return "", err
	}
	for _, key := range keys[chunks:] {
		if err = tx.Delete(key); err != nil {
			return "", err
		}
	}
	index, err := core.Canonical(manifest{"relayloom/profile-state/1", len(data), chunks, digest})
	if err != nil {
		return "", err
	}
	if err = tx.Put(manifestKey, index, groupstore.Data); err != nil {
		return "", err
	}
	return digest, nil
}
