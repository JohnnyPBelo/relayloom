package sites

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

// A browser test drives this helper with public certificates only. It verifies
// those bytes, then emits an independently created Go certificate, never keys.
func TestSiteRevisionInteropFixture(t *testing.T) {
	inputPath := os.Getenv("RELAYLOOM_SITE_VECTOR_INPUT")
	if inputPath == "" {
		t.Skip("driven by the real browser certificate test")
	}
	absolute, err := filepath.Abs(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(filepath.Join(root, ".cache"), absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		t.Fatal("fixture must stay in the project cache")
	}
	stat, err := os.Lstat(absolute)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > 65536 {
		t.Fatal("invalid fixture file", err)
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		t.Fatal(err)
	}
	value, err := core.DecodeJSON(data, 65536)
	if err != nil {
		t.Fatal(err)
	}
	input, err := object(value, "ownerId", "name", "payload", "revision")
	if err != nil {
		t.Fatal(err)
	}
	ownerID, ok := input["ownerId"].(string)
	if !ok {
		t.Fatal("ownerId")
	}
	name, ok := input["name"].(string)
	if !ok {
		t.Fatal("name")
	}
	bytes, err := core.Canonical(input["revision"])
	if err != nil {
		t.Fatal(err)
	}
	r, err := DecodeRevision(bytes)
	if err != nil {
		t.Fatal(err)
	}
	if err = VerifySnapshot(r, input["payload"], ownerID, name); err != nil {
		t.Fatal(err)
	}
	if VerifySnapshot(r, "tampered", ownerID, name) == nil {
		t.Fatal("tampered payload accepted")
	}
	goOwner, err := core.CreateIdentity("Go site vector — 🌿")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := DocumentHash(input["payload"])
	if err != nil {
		t.Fatal(err)
	}
	created, err := CreateSuccessor(goOwner, name, nil, hash)
	if err != nil {
		t.Fatal(err)
	}
	output, err := core.Canonical(map[string]any{"owner": goOwner.Public, "revision": created, "documentHash": hash, "browserSignatureVerified": true, "tamperedPayloadRejected": true})
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(absolute+".out.json", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err = f.Write(output); err != nil {
		t.Fatal(err)
	}
}
