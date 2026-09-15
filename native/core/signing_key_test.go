package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func TestIdentityRejectsSmallOrderSigningKey(t *testing.T) {
	good, err := CreateIdentity("Positive identity control")
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateIdentity(good.Public); err != nil {
		t.Fatal(err)
	}
	raw := make([]byte, 32)
	raw[0] = 1
	prefix, _ := hex.DecodeString("302a300506032b6570032100")
	der := append(prefix, raw...)
	signature := make([]byte, 64)
	signature[0] = 1
	card := PublicIdentity{ID: Hash(der), Name: "Synthetic weak key", SignKey: encode64(der), BoxKey: good.Public.BoxKey, Proof: encode64(signature)}
	message, err := publicBytes(card)
	if err != nil {
		t.Fatal(err)
	}
	key, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(key.(ed25519.PublicKey), message, signature) {
		t.Fatal("primitive acceptance control did not reproduce")
	}
	if ValidateIdentity(card) == nil {
		t.Fatal("weak signing key accepted as an identity")
	}
}

func TestSigningKeyProfileReferenceVectors(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/signing-key-profile.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		SmallOrder   []string `json:"smallOrder"`
		Noncanonical []string `json:"noncanonical"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors.SmallOrder) != 8 || len(vectors.Noncanonical) != 40 {
		t.Fatal("missing reference controls")
	}
	prefix, _ := hex.DecodeString("302a300506032b6570032100")
	for _, value := range append(vectors.SmallOrder, vectors.Noncanonical...) {
		raw, err := hex.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		der := append(append([]byte{}, prefix...), raw...)
		before := append([]byte{}, der...)
		if admittedSigningKey(der) {
			t.Fatal("accepted forbidden key", value)
		}
		if !bytes.Equal(der, before) {
			t.Fatal("admission modified its input")
		}
	}
	for i := 0; i < 32; i++ {
		good, err := CreateIdentity("Generated control")
		if err != nil {
			t.Fatal(err)
		}
		der, err := decode64(good.Public.SignKey, 256)
		if err != nil {
			t.Fatal(err)
		}
		if !admittedSigningKey(der) || ValidateIdentity(good.Public) != nil {
			t.Fatal("generated key rejected")
		}
		if admittedSigningKey(append(der, 0)) {
			t.Fatal("trailing DER bytes accepted")
		}
	}
}
