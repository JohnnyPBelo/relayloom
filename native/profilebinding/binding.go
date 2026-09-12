// Package profilebinding signs local installation/store bindings. sourceDigest
// names legacy ciphertext, never a public digest of private plaintext.
package profilebinding

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

type Body struct {
	Domain       string `json:"domain"`
	Owner        string `json:"owner"`
	StoreID      string `json:"storeId"`
	Nonce        string `json:"nonce"`
	SourceDigest string `json:"sourceDigest"`
	Phase        string `json:"phase"`
}
type Binding struct {
	Body      Body   `json:"body"`
	ID        string `json:"id"`
	Signature string `json:"signature"`
}

func Decode(data []byte, identity core.PublicIdentity) (Binding, error) {
	var result Binding
	if err := core.ValidateIdentity(identity); err != nil {
		return result, err
	}
	if _, err := core.DecodeJSON(data, 2048); err != nil {
		return result, err
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return result, err
	}
	encoded, err := core.Canonical(result)
	if err != nil || !bytes.Equal(data, encoded) {
		return result, errors.New("formato da ligação do perfil inválido")
	}
	b := result.Body
	if b.Domain != "relayloom/profile-binding/1" || b.Owner != identity.ID || (b.Phase != "prepared" && b.Phase != "committed") || !core.ValidAddress(b.StoreID) || !core.ValidAddress(b.Nonce) || !core.ValidAddress(b.SourceDigest) {
		return result, errors.New("contexto da ligação do perfil inválido")
	}
	body, err := core.Canonical(b)
	if err != nil {
		return result, err
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(result.Signature)
	if err != nil || len(signature) != 64 || base64.StdEncoding.EncodeToString(signature) != result.Signature || result.ID != core.Hash(body) {
		return result, errors.New("assinatura da ligação do perfil inválida")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(identity.SignKey)
	if err != nil {
		return result, err
	}
	parsed, err := x509.ParsePKIXPublicKey(raw)
	if err != nil {
		return result, err
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok || !ed25519.Verify(key, body, signature) {
		return result, errors.New("assinatura da ligação do perfil inválida")
	}
	return result, nil
}
func sign(body Body, identity core.Identity) (Binding, error) {
	var empty Binding
	raw, err := base64.StdEncoding.Strict().DecodeString(identity.SignSecret)
	if err != nil {
		return empty, err
	}
	parsed, err := x509.ParsePKCS8PrivateKey(raw)
	if err != nil {
		return empty, err
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return empty, errors.New("chave de assinatura inválida")
	}
	data, err := core.Canonical(body)
	if err != nil {
		return empty, err
	}
	result := Binding{body, core.Hash(data), base64.StdEncoding.EncodeToString(ed25519.Sign(key, data))}
	encoded, err := core.Canonical(result)
	if err != nil {
		return empty, err
	}
	return Decode(encoded, identity.Public)
}
func Prepare(identity core.Identity, storeID, sourceDigest string) (Binding, error) {
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return Binding{}, err
	}
	return sign(Body{"relayloom/profile-binding/1", identity.Public.ID, storeID, hex.EncodeToString(nonce), sourceDigest, "prepared"}, identity)
}
func Commit(identity core.Identity, prepared Binding) (Binding, error) {
	data, err := core.Canonical(prepared)
	if err != nil {
		return Binding{}, err
	}
	checked, err := Decode(data, identity.Public)
	if err != nil {
		return Binding{}, err
	}
	if checked.Body.Phase != "prepared" {
		return Binding{}, errors.New("a ligação do perfil já foi concluída")
	}
	checked.Body.Phase = "committed"
	return sign(checked.Body, identity)
}
