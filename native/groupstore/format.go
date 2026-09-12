// Package groupstore persists encrypted local metadata. It does not grant group authority.
package groupstore

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const (
	domain           = "relayloom/local-group-registry/1"
	maxIndex         = 4 * 1024 * 1024
	maxRecord        = 512 * 1024
	envelopeOverhead = 61
	maxRevision      = 9007199254740991
	applicationID    = 0x524c4731
	checkpointSQL    = "CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id = 1), store_id TEXT NOT NULL, payload BLOB NOT NULL)"
	recordsSQL       = "CREATE TABLE records (slot TEXT PRIMARY KEY, payload BLOB NOT NULL) WITHOUT ROWID"
)

var (
	ErrIntegrity   = errors.New("autenticação ou formato do registo inválido")
	ErrCapacity    = errors.New("capacidade protegida do registo atingida")
	ErrUnavailable = errors.New("registo fechado, incerto ou já em transacção")
	ErrTransaction = errors.New("transacção terminada ou apenas de leitura")
	keyPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9:/._-]{0,159}$`)
)

type StorageClass string

const (
	Data       StorageClass = "data"
	Checkpoint StorageClass = "checkpoint"
)

type Limits struct {
	TotalBytes   int `json:"totalBytes"`
	ReserveBytes int `json:"reserveBytes"`
}

func DefaultLimits() Limits { return Limits{64 * 1024 * 1024, 4 * 1024 * 1024} }

type Accounting struct {
	Limits
	Revision           int64 `json:"revision"`
	Records            int   `json:"records"`
	SerializedBytes    int   `json:"serializedBytes"`
	OrdinaryBytes      int   `json:"ordinaryBytes"`
	SQLiteBytes        int64 `json:"sqliteBytes"`
	SQLiteMaximumBytes int64 `json:"sqliteMaximumBytes"`
}
type entry struct {
	Key      string       `json:"key"`
	Slot     string       `json:"slot"`
	Revision int64        `json:"revision"`
	Digest   string       `json:"digest"`
	Bytes    int          `json:"bytes"`
	Class    StorageClass `json:"storageClass"`
}
type indexBody struct {
	Domain   string  `json:"domain"`
	Owner    string  `json:"owner"`
	StoreID  string  `json:"storeId"`
	Revision int64   `json:"revision"`
	Limits   Limits  `json:"limits"`
	Entries  []entry `json:"entries"`
}
type signedIndex struct {
	Body      indexBody `json:"body"`
	Signature string    `json:"signature"`
}
type keys struct {
	owner    string
	signer   ed25519.PrivateKey
	verifier ed25519.PublicKey
	box      []byte
}

func integrity(message string) error { return fmt.Errorf("%w: %s", ErrIntegrity, message) }
func checkLimits(l Limits) error {
	if l.TotalBytes < 32768 || l.TotalBytes > DefaultLimits().TotalBytes || l.ReserveBytes < 4096 || l.ReserveBytes >= l.TotalBytes || l.ReserveBytes > DefaultLimits().ReserveBytes {
		return integrity("limites")
	}
	return nil
}
func decode64(value string, size int) ([]byte, error) {
	if len(value) > 256 {
		return nil, integrity("chave demasiado grande")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || base64.StdEncoding.EncodeToString(data) != value || (size >= 0 && len(data) != size) {
		return nil, integrity("base64")
	}
	return data, nil
}
func identityKeys(identity core.Identity) (keys, error) {
	var k keys
	if err := core.ValidateIdentity(identity.Public); err != nil {
		return k, integrity("identidade local")
	}
	signBytes, err := decode64(identity.SignSecret, -1)
	if err != nil {
		return k, err
	}
	signParsed, err := x509.ParsePKCS8PrivateKey(signBytes)
	if err != nil {
		return k, integrity("chave de assinatura")
	}
	signer, ok := signParsed.(ed25519.PrivateKey)
	if !ok {
		return k, integrity("tipo de assinatura")
	}
	public, err := x509.MarshalPKIXPublicKey(signer.Public())
	if err != nil || base64.StdEncoding.EncodeToString(public) != identity.Public.SignKey {
		return k, integrity("autoridade local")
	}
	boxBytes, err := decode64(identity.BoxSecret, -1)
	if err != nil {
		return k, err
	}
	boxParsed, err := x509.ParsePKCS8PrivateKey(boxBytes)
	if err != nil {
		return k, integrity("chave de leitura")
	}
	box, ok := boxParsed.(*ecdh.PrivateKey)
	if !ok || box.Curve() != ecdh.X25519() {
		return k, integrity("tipo de leitura")
	}
	public, err = x509.MarshalPKIXPublicKey(box.PublicKey())
	if err != nil || base64.StdEncoding.EncodeToString(public) != identity.Public.BoxKey {
		return k, integrity("leitura local")
	}
	return keys{identity.Public.ID, signer, signer.Public().(ed25519.PublicKey), boxBytes}, nil
}
func randomID() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}
func (k *keys) aad(storeID, key string, revision int64) []byte {
	data, _ := core.Canonical([]any{domain, k.owner, storeID, key, revision})
	return data
}
func (k *keys) gcm(salt []byte) (cipher.AEAD, error) {
	key, err := hkdf.Key(sha256.New, k.box, salt, domain, 32)
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
func (k *keys) seal(plain, aad []byte) ([]byte, error) {
	salt, nonce := make([]byte, 32), make([]byte, 12)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	gcm, err := k.gcm(salt)
	if err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, plain, aad)
	out := make([]byte, 0, len(plain)+envelopeOverhead)
	out = append(out, 1)
	out = append(out, salt...)
	out = append(out, nonce...)
	out = append(out, sealed[len(sealed)-16:]...)
	out = append(out, sealed[:len(sealed)-16]...)
	return out, nil
}
func (k *keys) unseal(envelope, aad []byte) ([]byte, error) {
	if len(envelope) < envelopeOverhead || envelope[0] != 1 {
		return nil, integrity("envelope")
	}
	gcm, err := k.gcm(envelope[1:33])
	if err != nil {
		return nil, err
	}
	sealed := append(bytes.Clone(envelope[61:]), envelope[45:61]...)
	plain, err := gcm.Open(nil, envelope[33:45], sealed, aad)
	if err != nil {
		return nil, integrity("AEAD")
	}
	return plain, nil
}
func decodeIndex(data []byte, k *keys, storeID string) (indexBody, error) {
	var value signedIndex
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return indexBody{}, integrity("JSON")
	}
	encoded, err := core.Canonical(value)
	if err != nil || !bytes.Equal(encoded, data) {
		return indexBody{}, integrity("JSON não canónico")
	}
	b := value.Body
	if b.Domain != domain || b.Owner != k.owner || b.StoreID != storeID || b.Revision < 0 || b.Revision > maxRevision || b.Entries == nil || len(b.Entries) > 131072 {
		return b, integrity("checkpoint")
	}
	signature, err := decode64(value.Signature, 64)
	if err != nil {
		return b, err
	}
	encoded, err = core.Canonical(b)
	if err != nil || !ed25519.Verify(k.verifier, encoded, signature) {
		return b, integrity("assinatura local")
	}
	if err = checkLimits(b.Limits); err != nil {
		return b, err
	}
	previous := ""
	slots := map[string]bool{}
	for _, e := range b.Entries {
		if !keyPattern.MatchString(e.Key) || e.Key <= previous || !core.ValidAddress(e.Slot) || slots[e.Slot] || !core.ValidAddress(e.Digest) || e.Revision <= 0 || e.Revision > b.Revision || e.Bytes < envelopeOverhead || e.Bytes > maxRecord+envelopeOverhead || (e.Class != Data && e.Class != Checkpoint) {
			return b, integrity("referência")
		}
		previous = e.Key
		slots[e.Slot] = true
	}
	return b, nil
}
func indexSize(b indexBody) (int, error) {
	encoded, err := core.Canonical(signedIndex{b, strings.Repeat("A", 88)})
	return len(encoded) + envelopeOverhead, err
}
func account(b indexBody, indexBytes int) (Accounting, error) {
	result := Accounting{Limits: b.Limits, Revision: b.Revision, Records: len(b.Entries), SerializedBytes: indexBytes + 64, SQLiteMaximumBytes: maximumDatabaseBytes(b.Limits)}
	ordinary := make([]entry, 0)
	for _, e := range b.Entries {
		result.SerializedBytes += e.Bytes + 64
		if e.Class == Data {
			ordinary = append(ordinary, e)
			result.OrdinaryBytes += e.Bytes + 64
		}
	}
	encoded, err := core.Canonical(ordinary)
	if err != nil {
		return result, err
	}
	result.OrdinaryBytes += len(encoded)
	if indexBytes > maxIndex || result.SerializedBytes > b.Limits.TotalBytes || result.OrdinaryBytes > b.Limits.TotalBytes-b.Limits.ReserveBytes {
		return result, ErrCapacity
	}
	return result, nil
}
func maximumDatabaseBytes(l Limits) int64 {
	value := max(65536, (l.TotalBytes*3+1)/2)
	return int64((value+4095)/4096) * 4096
}
