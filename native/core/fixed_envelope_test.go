package core

import (
	"encoding/json"
	"os"
	"testing"
)

func TestFixedEnvelopeInteropWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_FIXED_ENVELOPE_INPUT")
	if path == "" {
		t.Skip("parent-owned envelope fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 2*1024*1024 {
		t.Fatal("bounded fixture", err)
	}
	decoded, err := DecodeJSON(data, 2*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	input := decoded.(map[string]any)
	bytes, err := Canonical(input["reader"])
	if err != nil {
		t.Fatal(err)
	}
	reader, err := DecodeIdentity(bytes)
	if err != nil {
		t.Fatal(err)
	}
	createdValue := input["created"]
	created, err := createdValue.(json.Number).Int64()
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range input["bundles"].([]any) {
		bytes, err = Canonical(raw)
		if err != nil {
			t.Fatal(err)
		}
		bundle, err := DecodeBundle(bytes)
		if err != nil {
			t.Fatal(err)
		}
		if bundle.Manifest.Created != created || bundle.Manifest.Expires != created+1000 {
			t.Fatal("fixed deadline changed")
		}
		if err = VerifyBundleAt(bundle, created+999); err != nil {
			t.Fatal(err)
		}
		if VerifyBundleAt(bundle, created+1000) == nil {
			t.Fatal("expired envelope accepted")
		}
		plain, err := DecryptBundleAt(bundle, &reader, created)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := Canonical(plain)
		want, _ := Canonical(input["payload"])
		if string(got) != string(want) {
			t.Fatal("payload mismatch")
		}
	}
	author, err := CreateIdentity("Fixed Go envelope")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := CreateBundleAt(author, "site-contribution", input["payload"], []PublicIdentity{reader.Public}, false, 1000, created)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err = Canonical(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".bundle.json", bytes, 0600); err != nil {
		t.Fatal(err)
	}
}
