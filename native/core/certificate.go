package core

import (
	"bytes"
	"crypto/ed25519"
	"errors"
)

// Detached signatures use the same validated identity/key format as bundles.
// The caller supplies a bounded, canonical, domain-separated certificate body.
func SignCertificateData(identity Identity, data []byte) ([]byte, error) {
	if err := ValidateIdentity(identity.Public); err != nil {
		return nil, err
	}
	secret, err := secretSign(identity.SignSecret)
	if err != nil {
		return nil, err
	}
	public, err := publicSign(identity.Public)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(secret.Public().(ed25519.PublicKey), public) {
		return nil, errors.New("a chave não pertence à autoridade")
	}
	return ed25519.Sign(secret, data), nil
}

func VerifyCertificateData(owner PublicIdentity, data, signature []byte) error {
	if err := ValidateIdentity(owner); err != nil {
		return err
	}
	public, err := publicSign(owner)
	if err != nil {
		return err
	}
	if len(signature) != ed25519.SignatureSize || !ed25519.Verify(public, data, signature) {
		return errors.New("assinatura de certificado inválida")
	}
	return nil
}
