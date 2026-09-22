package sites

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

const PrivateBytes = 6*1024*1024 + 16384
const PrivateChunkBytes = 512 * 1024
const PrivateChunks = 16
const privateOverhead = 61
const privateDomain = "relayloom/site-private/1"
const resourcePrivateDomain = "relayloom/site-resource-private/1"
const contributionPrivateDomain = "relayloom/site-contribution-private/1"

var privateKeyPattern = regexp.MustCompile(`^site:[a-f0-9]{64}:(record|stage)$`)
var resourcePrivateKeyPattern = regexp.MustCompile(`^resource:[a-f0-9]{64}:(record|stage)$`)
var contributionPrivateKeyPattern = regexp.MustCompile(`^contribution:[a-f0-9]{64}:(record|stage)$`)

type PrivateRecords struct {
	tx             *groupstore.Tx
	owner, storeID string
	secret         []byte
	closed         bool
	namespace      string
}

func privateIntegrity(reason string) error {
	return fmt.Errorf("%w: %s", groupstore.ErrIntegrity, reason)
}

// RunPrivate protects unpublished signatures with signing ownership inside the
// existing transactional profile. It does not change the outer storage format.
func RunPrivate(tx *groupstore.Tx, identity core.Identity, callback func(*PrivateRecords) error) error {
	return runPrivateNamespace(tx, identity, callback, "site")
}
func RunResourcePrivate(tx *groupstore.Tx, identity core.Identity, callback func(*PrivateRecords) error) error {
	return runPrivateNamespace(tx, identity, callback, "resource")
}
func RunContributionPrivate(tx *groupstore.Tx, identity core.Identity, callback func(*PrivateRecords) error) error {
	return runPrivateNamespace(tx, identity, callback, "contribution")
}
func runPrivateNamespace(tx *groupstore.Tx, identity core.Identity, callback func(*PrivateRecords) error, namespace string) error {
	if namespace != "site" && namespace != "resource" && namespace != "contribution" {
		return tx.Abort(privateIntegrity("espaço privado inválido"))
	}
	owner, err := tx.Owner()
	if err != nil {
		return err
	}
	if err = core.ValidateIdentity(identity.Public); err != nil || owner != identity.Public.ID {
		return errors.New("proprietário privado de site inválido")
	}
	if _, err = core.SignCertificateData(identity, []byte("relayloom/site-private-key-check/1")); err != nil {
		return tx.Abort(err)
	}
	secret, err := base64.StdEncoding.DecodeString(identity.SignSecret)
	if err != nil {
		return tx.Abort(err)
	}
	storeID, err := tx.StoreID()
	if err != nil {
		clear(secret)
		return err
	}
	records := &PrivateRecords{tx: tx, owner: owner, storeID: storeID, secret: secret, namespace: namespace}
	defer func() { records.closed = true; clear(records.secret) }()
	if err = callback(records); err != nil {
		return tx.Abort(err)
	}
	return nil
}
func (r *PrivateRecords) check(key string) error {
	if r.closed {
		return groupstore.ErrTransaction
	}
	pattern := privateKeyPattern
	if r.namespace == "resource" {
		pattern = resourcePrivateKeyPattern
	} else if r.namespace == "contribution" {
		pattern = contributionPrivateKeyPattern
	}
	if !pattern.MatchString(key) {
		return privateIntegrity("chave de site inválida")
	}
	return nil
}
func (r *PrivateRecords) domain() string {
	if r.namespace == "resource" {
		return resourcePrivateDomain
	}
	if r.namespace == "contribution" {
		return contributionPrivateDomain
	}
	return privateDomain
}
func (r *PrivateRecords) aad(key string) []byte {
	data, _ := core.Canonical([]any{r.domain(), r.owner, r.storeID, key})
	return data
}
func (r *PrivateRecords) gcm(salt []byte) (cipher.AEAD, error) {
	key, err := hkdf.Key(sha256.New, r.secret, salt, r.domain(), 32)
	if err != nil {
		return nil, err
	}
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func (r *PrivateRecords) encrypt(key string, plain []byte) ([]byte, error) {
	salt, nonce := make([]byte, 32), make([]byte, 12)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	gcm, err := r.gcm(salt)
	if err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, plain, r.aad(key))
	out := make([]byte, 0, len(plain)+privateOverhead)
	out = append(out, 1)
	out = append(out, salt...)
	out = append(out, nonce...)
	out = append(out, sealed[len(sealed)-16:]...)
	out = append(out, sealed[:len(sealed)-16]...)
	return out, nil
}
func (r *PrivateRecords) decrypt(key string, encoded []byte) ([]byte, error) {
	if len(encoded) < privateOverhead || encoded[0] != 1 {
		return nil, privateIntegrity("envelope privado inválido")
	}
	gcm, err := r.gcm(encoded[1:33])
	if err != nil {
		return nil, err
	}
	sealed := append(append([]byte{}, encoded[61:]...), encoded[45:61]...)
	plain, err := gcm.Open(nil, encoded[33:45], sealed, r.aad(key))
	if err != nil {
		return nil, privateIntegrity("autenticação privada de site")
	}
	return plain, nil
}
func privatePart(key string, n int) string { return fmt.Sprintf("%s:%02d", key, n) }
func privateInt(value any) (int, error) {
	n, ok := value.(json.Number)
	if !ok {
		return 0, privateIntegrity("número privado inválido")
	}
	i, err := n.Int64()
	if err != nil || i < 0 || i > PrivateBytes+privateOverhead {
		return 0, privateIntegrity("número privado fora dos limites")
	}
	return int(i), nil
}
func (r *PrivateRecords) Read(key string) (value any, found bool, err error) {
	defer func() {
		if err != nil {
			err = r.tx.Abort(err)
		}
	}()
	if err = r.check(key); err != nil {
		return nil, false, err
	}
	manifest, found, err := r.tx.Get(key)
	if err != nil {
		return nil, false, err
	}
	keys, err := r.tx.Keys(key + ":")
	if err != nil {
		return nil, false, err
	}
	if !found {
		if len(keys) != 0 {
			return nil, false, privateIntegrity("blocos de site sem índice")
		}
		return nil, false, nil
	}
	parsed, err := core.DecodeJSON(manifest, 1024)
	if err != nil {
		return nil, false, privateIntegrity("índice privado ilegível")
	}
	m, ok := parsed.(map[string]any)
	if !ok || len(m) != 4 || m["domain"] != r.domain() {
		return nil, false, privateIntegrity("índice privado inválido")
	}
	size, err := privateInt(m["bytes"])
	if err != nil {
		return nil, false, err
	}
	chunks, err := privateInt(m["chunks"])
	if err != nil {
		return nil, false, err
	}
	digest, ok := m["digest"].(string)
	encoded, err := core.Canonical(m)
	if err != nil || !bytes.Equal(manifest, encoded) || !ok || !core.ValidAddress(digest) || size < privateOverhead || size > PrivateBytes+privateOverhead || chunks != (size+PrivateChunkBytes-1)/PrivateChunkBytes || chunks > PrivateChunks || len(keys) != chunks {
		return nil, false, privateIntegrity("limites privados inválidos")
	}
	combined := make([]byte, 0, size)
	for i, k := range keys {
		if k != privatePart(key, i) {
			return nil, false, privateIntegrity("conjunto privado incompleto")
		}
		piece, exists, e := r.tx.Get(k)
		if e != nil {
			return nil, false, e
		}
		expected := min(PrivateChunkBytes, size-i*PrivateChunkBytes)
		if !exists || len(piece) != expected {
			return nil, false, privateIntegrity("bloco privado truncado")
		}
		combined = append(combined, piece...)
	}
	if core.Hash(combined) != digest {
		return nil, false, privateIntegrity("hash privado inválido")
	}
	plain, err := r.decrypt(key, combined)
	if err != nil {
		return nil, false, err
	}
	value, err = core.DecodeJSON(plain, PrivateBytes)
	if err != nil {
		return nil, false, privateIntegrity("dados privados ilegíveis")
	}
	encoded, err = core.Canonical(value)
	if err != nil || !bytes.Equal(encoded, plain) {
		return nil, false, privateIntegrity("dados privados não canónicos")
	}
	return value, true, nil
}
func (r *PrivateRecords) Write(key string, value any) (err error) {
	defer func() {
		if err != nil {
			err = r.tx.Abort(err)
		}
	}()
	if err = r.check(key); err != nil {
		return err
	}
	plain, err := core.Canonical(value)
	if err != nil {
		return err
	}
	if len(plain) > PrivateBytes {
		return groupstore.ErrCapacity
	}
	encrypted, err := r.encrypt(key, plain)
	if err != nil {
		return err
	}
	chunks := (len(encrypted) + PrivateChunkBytes - 1) / PrivateChunkBytes
	if chunks > PrivateChunks {
		return groupstore.ErrCapacity
	}
	if err = r.Remove(key); err != nil {
		return err
	}
	for i := 0; i < chunks; i++ {
		if err = r.tx.Put(privatePart(key, i), encrypted[i*PrivateChunkBytes:min(len(encrypted), (i+1)*PrivateChunkBytes)], groupstore.Data); err != nil {
			return err
		}
	}
	manifest, err := core.Canonical(map[string]any{"domain": r.domain(), "bytes": len(encrypted), "chunks": chunks, "digest": core.Hash(encrypted)})
	if err != nil {
		return err
	}
	return r.tx.Put(key, manifest, groupstore.Data)
}
func (r *PrivateRecords) Remove(key string) (err error) {
	defer func() {
		if err != nil {
			err = r.tx.Abort(err)
		}
	}()
	if err = r.check(key); err != nil {
		return err
	}
	keys, err := r.tx.Keys(key + ":")
	if err != nil {
		return err
	}
	for _, k := range keys {
		if err = r.tx.Delete(k); err != nil {
			return err
		}
	}
	return r.tx.Delete(key)
}
