package groups

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"unicode/utf8"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func canonical(value any, maximum int) ([]byte, error) {
	data, err := core.Canonical(value)
	if err != nil {
		return nil, err
	}
	if len(data) > maximum {
		return nil, errors.New("certificado de grupo demasiado grande")
	}
	return data, nil
}
func decode64(value string, exact, maximum int) ([]byte, error) {
	if len(value) > maximum {
		return nil, errors.New("codificação de grupo demasiado grande")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || base64.StdEncoding.EncodeToString(data) != value || (exact >= 0 && len(data) != exact) {
		return nil, errors.New("codificação de grupo não canónica")
	}
	return data, nil
}
func nonce() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}
func MemberCardHash(card core.PublicIdentity) (string, error) {
	if err := core.ValidateIdentity(card); err != nil {
		return "", err
	}
	data, err := core.Canonical(card)
	if err != nil {
		return "", err
	}
	return core.Hash(data), nil
}
func cardHashVerified(card core.PublicIdentity) string {
	data, _ := core.Canonical(card)
	return core.Hash(data)
}
func verifyCertificate[T any](cert Certificate[T], signer core.PublicIdentity, maximum int) error {
	if err := core.ValidateIdentity(signer); err != nil {
		return err
	}
	data, err := canonical(cert.Body, maximum)
	if err != nil {
		return err
	}
	if _, err = canonical(cert, maximum); err != nil {
		return err
	}
	if !core.ValidAddress(cert.ID) || cert.ID != core.Hash(data) {
		return errors.New("hash do certificado não coincide")
	}
	signature, err := decode64(cert.Signature, ed25519.SignatureSize, 88)
	if err != nil {
		return err
	}
	keyBytes, err := decode64(signer.SignKey, -1, 256)
	if err != nil {
		return err
	}
	parsed, err := x509.ParsePKIXPublicKey(keyBytes)
	if err != nil {
		return err
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok || !ed25519.Verify(key, data, signature) {
		return errors.New("assinatura de grupo inválida")
	}
	return nil
}
func signCertificate[T any](body T, identity core.Identity, maximum int) (Certificate[T], error) {
	var empty Certificate[T]
	if err := core.ValidateIdentity(identity.Public); err != nil {
		return empty, err
	}
	secret, err := decode64(identity.SignSecret, -1, 256)
	if err != nil {
		return empty, err
	}
	parsed, err := x509.ParsePKCS8PrivateKey(secret)
	if err != nil {
		return empty, err
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return empty, errors.New("chave de assinatura inválida")
	}
	public, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil || base64.StdEncoding.EncodeToString(public) != identity.Public.SignKey {
		return empty, errors.New("a chave não pertence à autoridade")
	}
	data, err := canonical(body, maximum)
	if err != nil {
		return empty, err
	}
	cert := Certificate[T]{Body: body, ID: core.Hash(data), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, data))}
	if _, err = canonical(cert, maximum); err != nil {
		return empty, err
	}
	return cert, nil
}
func utf16Length(value string) int {
	count := 0
	for at := 0; at < len(value); {
		r, size := utf8.DecodeRuneInString(value[at:])
		// core.DecodeJSON preserves escaped lone UTF-16 surrogates as WTF-8.
		if r == utf8.RuneError && size == 1 && at+2 < len(value) && value[at] == 0xed && value[at+1] >= 0xa0 && value[at+1] <= 0xbf && value[at+2]&0xc0 == 0x80 {
			size = 3
		}
		count++
		if r > 0xffff {
			count++
		}
		at += size
	}
	return count
}
