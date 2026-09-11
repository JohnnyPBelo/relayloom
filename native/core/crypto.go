package core

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

const (
	MaxContent             = 4 * 1024 * 1024
	ChunkSize              = 24 * 1024
	MaxStoredObjects       = 1024
	MaxBundleBytes         = 6 * 1024 * 1024
	DefaultTTL       int64 = 30 * 86400_000
	MaxTTL           int64 = 365 * 86400_000
	maxSafeInteger   int64 = 9007199254740991
	contentAAD             = "relayloom-content-v1"
)

var addressPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var kindPattern = regexp.MustCompile(`^[a-z][a-z-]{0,31}$`)

func ValidAddress(value string) bool { return addressPattern.MatchString(value) }

type PublicIdentity struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	SignKey string `json:"signKey"`
	BoxKey  string `json:"boxKey"`
	Proof   string `json:"proof"`
}
type Identity struct {
	Public     PublicIdentity `json:"public"`
	SignSecret string         `json:"signSecret"`
	BoxSecret  string         `json:"boxSecret"`
}
type Sealed struct {
	Nonce string `json:"nonce"`
	Data  string `json:"data"`
	Tag   string `json:"tag"`
}
type KeyEnvelope struct {
	Sealed
	Reader    string `json:"reader"`
	Ephemeral string `json:"ephemeral"`
}
type ChunkRef struct {
	Hash string `json:"hash"`
	Size int    `json:"size"`
}
type ManifestBody struct {
	Version   int            `json:"version"`
	Author    PublicIdentity `json:"author"`
	Kind      string         `json:"kind"`
	Created   int64          `json:"created"`
	Expires   int64          `json:"expires"`
	Nonce     string         `json:"nonce"`
	Tag       string         `json:"tag"`
	Chunks    []ChunkRef     `json:"chunks"`
	Keys      []KeyEnvelope  `json:"keys"`
	PublicKey *string        `json:"publicKey"`
	Salt      string         `json:"salt"`
}
type Manifest struct {
	ManifestBody
	ID        string `json:"id"`
	Signature string `json:"signature"`
}
type Bundle struct {
	Manifest Manifest          `json:"manifest"`
	Chunks   map[string]string `json:"chunks"`
}

func encode64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
func decode64(s string, maximum int) ([]byte, error) {
	if len(s) > maximum {
		return nil, errors.New("codificação demasiado grande")
	}
	b, err := base64.StdEncoding.Strict().DecodeString(s)
	if err != nil || encode64(b) != s {
		return nil, errors.New("codificação não canónica")
	}
	return b, nil
}
func randomBytes(n int) ([]byte, error) { b := make([]byte, n); _, err := rand.Read(b); return b, err }
func publicBytes(p PublicIdentity) ([]byte, error) {
	return Canonical(map[string]any{"id": p.ID, "name": p.Name, "signKey": p.SignKey, "boxKey": p.BoxKey})
}
func publicSign(p PublicIdentity) (ed25519.PublicKey, error) {
	raw, err := decode64(p.SignKey, 256)
	if err != nil {
		return nil, err
	}
	key, err := x509.ParsePKIXPublicKey(raw)
	if err != nil {
		return nil, err
	}
	ed, ok := key.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("chave de assinatura inválida")
	}
	return ed, nil
}
func publicBox(encoded string) (*ecdh.PublicKey, error) {
	raw, err := decode64(encoded, 256)
	if err != nil {
		return nil, err
	}
	key, err := x509.ParsePKIXPublicKey(raw)
	if err != nil {
		return nil, err
	}
	box, ok := key.(*ecdh.PublicKey)
	if !ok || box.Curve() != ecdh.X25519() {
		return nil, errors.New("chave de leitura inválida")
	}
	return box, nil
}
func secretSign(encoded string) (ed25519.PrivateKey, error) {
	raw, err := decode64(encoded, 256)
	if err != nil {
		return nil, err
	}
	key, err := x509.ParsePKCS8PrivateKey(raw)
	if err != nil {
		return nil, err
	}
	ed, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("segredo de assinatura inválido")
	}
	return ed, nil
}
func secretBox(encoded string) (*ecdh.PrivateKey, error) {
	raw, err := decode64(encoded, 256)
	if err != nil {
		return nil, err
	}
	key, err := x509.ParsePKCS8PrivateKey(raw)
	if err != nil {
		return nil, err
	}
	box, ok := key.(*ecdh.PrivateKey)
	if !ok || box.Curve() != ecdh.X25519() {
		return nil, errors.New("segredo de leitura inválido")
	}
	return box, nil
}

func ValidateIdentity(p PublicIdentity) error {
	if stringLength(p.Name) < 1 || stringLength(p.Name) > 64 {
		return errors.New("nome inválido")
	}
	raw, err := decode64(p.SignKey, 256)
	if err != nil || p.ID != Hash(raw) {
		return errors.New("identidade inválida")
	}
	sp, err := publicSign(p)
	if err != nil {
		return err
	}
	if _, err = publicBox(p.BoxKey); err != nil {
		return err
	}
	proof, err := decode64(p.Proof, 128)
	if err != nil {
		return err
	}
	data, err := publicBytes(p)
	if err != nil {
		return err
	}
	if !ed25519.Verify(sp, data, proof) {
		return errors.New("prova de identidade inválida")
	}
	return nil
}
func jsSpace(r rune) bool {
	return r == 9 || r == 10 || r == 11 || r == 12 || r == 13 || r == 32 || r == 0xa0 || r == 0x1680 || (r >= 0x2000 && r <= 0x200a) || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
}
func trimJS(s string) string {
	start, end := 0, 0
	leading := true
	for at := 0; at < len(s); {
		r, n, err := stringRune(s, at)
		if err != nil {
			return ""
		}
		if !jsSpace(r) {
			if leading {
				start = at
				leading = false
			}
			end = at + n
		}
		at += n
	}
	return s[start:end]
}
func CreateIdentity(name string) (Identity, error) {
	name = trimJS(name)
	if stringLength(name) < 1 || stringLength(name) > 64 {
		return Identity{}, errors.New("nome inválido")
	}
	sp, ss, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Identity{}, err
	}
	bs, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return Identity{}, err
	}
	signDER, err := x509.MarshalPKIXPublicKey(sp)
	if err != nil {
		return Identity{}, err
	}
	boxDER, err := x509.MarshalPKIXPublicKey(bs.PublicKey())
	if err != nil {
		return Identity{}, err
	}
	signPrivate, err := x509.MarshalPKCS8PrivateKey(ss)
	if err != nil {
		return Identity{}, err
	}
	boxPrivate, err := x509.MarshalPKCS8PrivateKey(bs)
	if err != nil {
		return Identity{}, err
	}
	p := PublicIdentity{ID: Hash(signDER), Name: name, SignKey: encode64(signDER), BoxKey: encode64(boxDER)}
	proof, err := publicBytes(p)
	if err != nil {
		return Identity{}, err
	}
	p.Proof = encode64(ed25519.Sign(ss, proof))
	return Identity{Public: p, SignSecret: encode64(signPrivate), BoxSecret: encode64(boxPrivate)}, nil
}
func validateSecrets(identity Identity) error {
	if err := ValidateIdentity(identity.Public); err != nil {
		return err
	}
	sign, err := secretSign(identity.SignSecret)
	if err != nil {
		return err
	}
	box, err := secretBox(identity.BoxSecret)
	if err != nil {
		return err
	}
	signDER, err := x509.MarshalPKIXPublicKey(sign.Public())
	if err != nil {
		return err
	}
	boxDER, err := x509.MarshalPKIXPublicKey(box.PublicKey())
	if err != nil {
		return err
	}
	if encode64(signDER) != identity.Public.SignKey || encode64(boxDER) != identity.Public.BoxKey {
		return errors.New("segredos não correspondem à identidade")
	}
	return nil
}

func seal(data, key []byte, aad string) (Sealed, error) {
	if len(key) != 32 {
		return Sealed{}, errors.New("chave AES-256 inválida")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return Sealed{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return Sealed{}, err
	}
	nonce, err := randomBytes(12)
	if err != nil {
		return Sealed{}, err
	}
	encrypted := gcm.Seal(nil, nonce, data, []byte(aad))
	return Sealed{Nonce: encode64(nonce), Data: encode64(encrypted[:len(encrypted)-16]), Tag: encode64(encrypted[len(encrypted)-16:])}, nil
}
func open(s Sealed, key []byte, aad string) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("chave AES-256 inválida")
	}
	nonce, err := decode64(s.Nonce, 32)
	if err != nil || len(nonce) != 12 {
		return nil, errors.New("nonce inválido")
	}
	tag, err := decode64(s.Tag, 32)
	if err != nil || len(tag) != 16 {
		return nil, errors.New("tag inválida")
	}
	data, err := decode64(s.Data, MaxContent*2)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, append(data, tag...), []byte(aad))
}
func passwordKey(password string, salt []byte) ([]byte, error) {
	// Node's Buffer.from(string, "utf8") replaces each unpaired UTF-16
	// surrogate; our signed JSON codec preserves those units internally.
	var encoded bytes.Buffer
	for at := 0; at < len(password); {
		r, width, err := stringRune(password, at)
		if err != nil {
			return nil, err
		}
		at += width
		if r >= 0xd800 && r <= 0xdfff {
			encoded.WriteRune('\ufffd')
		} else {
			encoded.WriteRune(r)
		}
	}
	return scrypt.Key(encoded.Bytes(), salt, 32768, 8, 1, 32)
}

func ExportVault(identity Identity, password string) (string, error) {
	if stringLength(password) < 12 || stringLength(password) > 1024 {
		return "", errors.New("use uma frase-passe com 12 a 1024 caracteres")
	}
	if err := validateSecrets(identity); err != nil {
		return "", err
	}
	salt, err := randomBytes(16)
	if err != nil {
		return "", err
	}
	key, err := passwordKey(password, salt)
	if err != nil {
		return "", err
	}
	plain, err := Canonical(identity)
	if err != nil {
		return "", err
	}
	encrypted, err := seal(plain, key, "relayloom-vault-v1")
	if err != nil {
		return "", err
	}
	data, err := Canonical(map[string]any{"version": 1, "salt": encode64(salt), "sealed": encrypted})
	return string(data), err
}
func ImportVault(vault, password string) (Identity, error) {
	if len(vault) > 8192 || stringLength(password) > 1024 {
		return Identity{}, errors.New("cofre inválido")
	}
	var v struct {
		Version int    `json:"version"`
		Salt    string `json:"salt"`
		Sealed  Sealed `json:"sealed"`
	}
	if err := decodeInto([]byte(vault), 8192, &v); err != nil {
		return Identity{}, err
	}
	if v.Version != 1 {
		return Identity{}, errors.New("versão inválida")
	}
	salt, err := decode64(v.Salt, 32)
	if err != nil || len(salt) != 16 {
		return Identity{}, errors.New("sal inválido")
	}
	key, err := passwordKey(password, salt)
	if err != nil {
		return Identity{}, err
	}
	plain, err := open(v.Sealed, key, "relayloom-vault-v1")
	if err != nil {
		return Identity{}, err
	}
	identity, err := DecodeIdentity(plain)
	if err != nil {
		return Identity{}, err
	}
	return identity, validateSecrets(identity)
}

func wrap(key []byte, reader PublicIdentity) (KeyEnvelope, error) {
	ephemeral, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return KeyEnvelope{}, err
	}
	recipient, err := publicBox(reader.BoxKey)
	if err != nil {
		return KeyEnvelope{}, err
	}
	shared, err := ephemeral.ECDH(recipient)
	if err != nil {
		return KeyEnvelope{}, err
	}
	wrapping, err := hkdf.Key(sha256.New, shared, []byte(reader.ID), "relayloom-reader-v1", 32)
	if err != nil {
		return KeyEnvelope{}, err
	}
	sealed, err := seal(key, wrapping, reader.ID)
	if err != nil {
		return KeyEnvelope{}, err
	}
	der, err := x509.MarshalPKIXPublicKey(ephemeral.PublicKey())
	if err != nil {
		return KeyEnvelope{}, err
	}
	return KeyEnvelope{Sealed: sealed, Reader: reader.ID, Ephemeral: encode64(der)}, nil
}
func CreateBundle(identity Identity, kind string, payload any, readers []PublicIdentity, public bool, ttlMS int64) (Bundle, error) {
	return CreateBundleAt(identity, kind, payload, readers, public, ttlMS, time.Now().UnixMilli())
}
func CreateBundleAt(identity Identity, kind string, payload any, readers []PublicIdentity, public bool, ttlMS, nowMS int64) (Bundle, error) {
	if !kindPattern.MatchString(kind) || ttlMS < 1000 || ttlMS > MaxTTL || nowMS > maxSafeInteger-ttlMS || nowMS < 0 {
		return Bundle{}, errors.New("metadados inválidos")
	}
	if err := validateSecrets(identity); err != nil {
		return Bundle{}, err
	}
	plain, err := Canonical(payload)
	if err != nil {
		return Bundle{}, err
	}
	if len(plain) > MaxContent {
		return Bundle{}, errors.New("conteúdo excede 4 MiB")
	}
	access := make([]PublicIdentity, 0)
	if !public {
		for _, r := range append([]PublicIdentity{identity.Public}, readers...) {
			if err := ValidateIdentity(r); err != nil {
				return Bundle{}, err
			}
			found := -1
			for i, p := range access {
				if p.ID == r.ID {
					found = i
					break
				}
			}
			if found >= 0 {
				access[found] = r
			} else {
				access = append(access, r)
			}
		}
		if len(access) > 64 {
			return Bundle{}, errors.New("limite de destinatários")
		}
	}
	key, err := randomBytes(32)
	if err != nil {
		return Bundle{}, err
	}
	encrypted, err := seal(plain, key, contentAAD)
	if err != nil {
		return Bundle{}, err
	}
	ciphertext, err := decode64(encrypted.Data, MaxContent*2)
	if err != nil {
		return Bundle{}, err
	}
	chunks := make(map[string]string)
	refs := make([]ChunkRef, 0)
	for start := 0; start < len(ciphertext); start += ChunkSize {
		end := min(start+ChunkSize, len(ciphertext))
		chunk := ciphertext[start:end]
		id := Hash(chunk)
		chunks[id] = encode64(chunk)
		refs = append(refs, ChunkRef{Hash: id, Size: len(chunk)})
	}
	envelopes := make([]KeyEnvelope, 0, len(access))
	for _, r := range access {
		e, err := wrap(key, r)
		if err != nil {
			return Bundle{}, err
		}
		envelopes = append(envelopes, e)
	}
	salt, err := randomBytes(16)
	if err != nil {
		return Bundle{}, err
	}
	body := ManifestBody{Version: 1, Author: identity.Public, Kind: kind, Created: nowMS, Expires: nowMS + ttlMS, Nonce: encrypted.Nonce, Tag: encrypted.Tag, Chunks: refs, Keys: envelopes, Salt: encode64(salt)}
	if public {
		encoded := encode64(key)
		body.PublicKey = &encoded
	}
	data, err := Canonical(body)
	if err != nil {
		return Bundle{}, err
	}
	secret, err := secretSign(identity.SignSecret)
	if err != nil {
		return Bundle{}, err
	}
	return Bundle{Manifest: Manifest{ManifestBody: body, ID: Hash(data), Signature: encode64(ed25519.Sign(secret, data))}, Chunks: chunks}, nil
}

func VerifyManifest(m Manifest) error { return VerifyManifestAt(m, time.Now().UnixMilli()) }
func VerifyManifestAt(m Manifest, nowMS int64) error {
	data, err := Canonical(m)
	if err != nil || stringLength(string(data)) > 100000 {
		return errors.New("manifesto inválido")
	}
	if m.Version != 1 || ValidateIdentity(m.Author) != nil || !kindPattern.MatchString(m.Kind) || m.Created < -maxSafeInteger || m.Created > maxSafeInteger || m.Expires < -maxSafeInteger || m.Expires > maxSafeInteger || m.Created > nowMS+300000 || m.Expires <= nowMS || m.Expires <= m.Created || m.Expires-m.Created > MaxTTL+10 {
		return errors.New("manifesto expirado ou inválido")
	}
	if len(m.Chunks) < 1 || len(m.Chunks) > (MaxContent+ChunkSize-1)/ChunkSize || m.Keys == nil || len(m.Keys) > 64 {
		return errors.New("limite de conteúdo")
	}
	total := 0
	for _, c := range m.Chunks {
		if !ValidAddress(c.Hash) || c.Size < 1 || c.Size > ChunkSize {
			return errors.New("fragmento inválido")
		}
		total += c.Size
	}
	if total > MaxContent {
		return errors.New("limite de conteúdo")
	}
	if m.PublicKey != nil {
		key, err := decode64(*m.PublicKey, 48)
		if err != nil || len(key) != 32 {
			return errors.New("chave pública inválida")
		}
	} else if len(m.Keys) < 1 {
		return errors.New("sem destinatários")
	}
	for _, field := range []struct {
		data   string
		length int
	}{{m.Nonce, 12}, {m.Tag, 16}, {m.Salt, 16}} {
		value, err := decode64(field.data, 32)
		if err != nil || len(value) != field.length {
			return errors.New("cifra inválida")
		}
	}
	for _, e := range m.Keys {
		if !ValidAddress(e.Reader) {
			return errors.New("destinatário inválido")
		}
		if _, err := publicBox(e.Ephemeral); err != nil {
			return err
		}
		for _, field := range []struct {
			data   string
			length int
		}{{e.Nonce, 12}, {e.Tag, 16}, {e.Data, 32}} {
			b, err := decode64(field.data, 128)
			if err != nil || len(b) != field.length {
				return errors.New("envelope inválido")
			}
		}
	}
	body, err := Canonical(m.ManifestBody)
	if err != nil {
		return err
	}
	key, err := publicSign(m.Author)
	if err != nil {
		return err
	}
	signature, err := decode64(m.Signature, 128)
	if err != nil || m.ID != Hash(body) || !ed25519.Verify(key, body, signature) {
		return errors.New("assinatura inválida")
	}
	return nil
}
func VerifyBundle(b Bundle) error { return VerifyBundleAt(b, time.Now().UnixMilli()) }
func VerifyBundleAt(b Bundle, nowMS int64) error {
	if err := VerifyManifestAt(b.Manifest, nowMS); err != nil {
		return err
	}
	if b.Chunks == nil || len(b.Chunks) > len(b.Manifest.Chunks) {
		return errors.New("fragmentos inválidos")
	}
	for _, c := range b.Manifest.Chunks {
		data, err := decode64(b.Chunks[c.Hash], ChunkSize*2)
		if err != nil || len(data) != c.Size || Hash(data) != c.Hash {
			return errors.New("conteúdo corrompido")
		}
	}
	return nil
}
func DecryptBundle(b Bundle, identity *Identity) (any, error) {
	return DecryptBundleAt(b, identity, time.Now().UnixMilli())
}
func DecryptBundleAt(b Bundle, identity *Identity, nowMS int64) (any, error) {
	if err := VerifyBundleAt(b, nowMS); err != nil {
		return nil, err
	}
	m := b.Manifest
	var key []byte
	var err error
	if m.PublicKey != nil {
		key, err = decode64(*m.PublicKey, 48)
	} else {
		if identity == nil {
			return nil, errors.New("sem autorização de leitura")
		}
		var envelope *KeyEnvelope
		for i := range m.Keys {
			if m.Keys[i].Reader == identity.Public.ID {
				envelope = &m.Keys[i]
				break
			}
		}
		if envelope == nil {
			return nil, errors.New("sem autorização de leitura")
		}
		secret, e := secretBox(identity.BoxSecret)
		if e != nil {
			return nil, e
		}
		ephemeral, e := publicBox(envelope.Ephemeral)
		if e != nil {
			return nil, e
		}
		shared, e := secret.ECDH(ephemeral)
		if e != nil {
			return nil, e
		}
		wrapping, e := hkdf.Key(sha256.New, shared, []byte(identity.Public.ID), "relayloom-reader-v1", 32)
		if e != nil {
			return nil, e
		}
		key, err = open(envelope.Sealed, wrapping, identity.Public.ID)
	}
	if err != nil {
		return nil, err
	}
	var ciphertext bytes.Buffer
	for _, c := range m.Chunks {
		part, err := decode64(b.Chunks[c.Hash], ChunkSize*2)
		if err != nil {
			return nil, err
		}
		ciphertext.Write(part)
	}
	plain, err := open(Sealed{Nonce: m.Nonce, Tag: m.Tag, Data: encode64(ciphertext.Bytes())}, key, contentAAD)
	if err != nil {
		return nil, err
	}
	return DecodeJSON(plain, MaxContent)
}

func ConstantEqual(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func DecodeIdentity(data []byte) (Identity, error) {
	var value Identity
	err := decodeInto(data, 8192, &value)
	return value, err
}
func DecodeBundle(data []byte) (Bundle, error) {
	var value Bundle
	err := decodeInto(data, MaxBundleBytes, &value)
	return value, err
}
func DecodePublicIdentity(data []byte) (PublicIdentity, error) {
	var value PublicIdentity
	err := decodeInto(data, 2048, &value)
	return value, err
}

func decodeInto(data []byte, maximum int, dst any) error {
	value, err := DecodeJSON(data, maximum)
	if err != nil {
		return err
	}
	v := reflect.ValueOf(dst)
	if v.Kind() != reflect.Pointer || v.IsNil() {
		return errors.New("destino inválido")
	}
	return assignJSON(v.Elem(), value)
}
func assignJSON(dst reflect.Value, src any) error {
	if dst.Kind() == reflect.Pointer {
		if src == nil {
			dst.SetZero()
			return nil
		}
		dst.Set(reflect.New(dst.Type().Elem()))
		return assignJSON(dst.Elem(), src)
	}
	if dst.Kind() == reflect.Interface {
		if src == nil {
			dst.SetZero()
		} else {
			dst.Set(reflect.ValueOf(src))
		}
		return nil
	}
	switch dst.Kind() {
	case reflect.String:
		s, ok := src.(string)
		if !ok {
			return errors.New("texto esperado")
		}
		dst.SetString(s)
	case reflect.Bool:
		b, ok := src.(bool)
		if !ok {
			return errors.New("booleano esperado")
		}
		dst.SetBool(b)
	case reflect.Int, reflect.Int64, reflect.Int32:
		n, ok := src.(json.Number)
		if !ok {
			return errors.New("inteiro esperado")
		}
		f, err := strconv.ParseFloat(string(n), 64)
		if err != nil || math.Trunc(f) != f || math.Abs(f) > float64(maxSafeInteger) || dst.OverflowInt(int64(f)) {
			return errors.New("inteiro inválido")
		}
		dst.SetInt(int64(f))
	case reflect.Slice:
		a, ok := src.([]any)
		if !ok {
			return errors.New("lista esperada")
		}
		dst.Set(reflect.MakeSlice(dst.Type(), len(a), len(a)))
		for i, v := range a {
			if err := assignJSON(dst.Index(i), v); err != nil {
				return err
			}
		}
	case reflect.Map:
		o, ok := src.(map[string]any)
		if !ok {
			return errors.New("objecto esperado")
		}
		dst.Set(reflect.MakeMap(dst.Type()))
		for k, v := range o {
			element := reflect.New(dst.Type().Elem()).Elem()
			if err := assignJSON(element, v); err != nil {
				return err
			}
			dst.SetMapIndex(reflect.ValueOf(k), element)
		}
	case reflect.Struct:
		o, ok := src.(map[string]any)
		if !ok {
			return errors.New("objecto esperado")
		}
		fields := make(map[string]reflect.Value)
		collectJSONFields(dst, fields)
		if len(o) != len(fields) {
			return errors.New("campos JSON inválidos")
		}
		for name, field := range fields {
			value, ok := o[name]
			if !ok {
				return fmt.Errorf("campo em falta: %s", name)
			}
			if err := assignJSON(field, value); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
	default:
		return errors.New("tipo de campo inválido")
	}
	return nil
}
func collectJSONFields(value reflect.Value, fields map[string]reflect.Value) {
	t := value.Type()
	for i := 0; i < value.NumField(); i++ {
		f := t.Field(i)
		if f.PkgPath != "" {
			continue
		}
		tag := strings.Split(f.Tag.Get("json"), ",")[0]
		if tag == "-" {
			continue
		}
		fv := value.Field(i)
		if f.Anonymous && tag == "" && fv.Kind() == reflect.Struct {
			collectJSONFields(fv, fields)
			continue
		}
		if tag == "" {
			tag = f.Name
		}
		fields[tag] = fv
	}
}
