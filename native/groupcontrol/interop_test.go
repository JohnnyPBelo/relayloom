package groupcontrol

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
)

// The Node driver owns fresh synthetic keys, private inputs and output cleanup.
func TestControlInteropFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_CONTROL_VECTORS")
	if path == "" {
		t.Skip("driven by tests/native/group-carriers.test.ts")
	}
	abs, err := filepath.Abs(path)
	check(t, err)
	root, err := filepath.Abs("../../.cache")
	check(t, err)
	rel, err := filepath.Rel(root, abs)
	check(t, err)
	if rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		t.Fatal("fixture outside project cache")
	}
	data, err := os.ReadFile(abs)
	check(t, err)
	decoded, err := core.DecodeJSON(data, 8*1024*1024)
	check(t, err)
	input := decoded.(map[string]any)
	encoded := func(v any) []byte { b, err := core.Canonical(v); check(t, err); return b }
	identities := []core.Identity{}
	for _, raw := range input["identities"].([]any) {
		id, err := core.DecodeIdentity(encoded(raw))
		check(t, err)
		identities = append(identities, id)
	}
	anchor, err := groups.DecodeAnchor(encoded(input["anchor"]))
	check(t, err)
	output := []any{}
	for _, raw := range input["cases"].([]any) {
		v := raw.(map[string]any)
		index := func(key string) int {
			i, ok := integer(v[key])
			if !ok || i >= len(identities) {
				t.Fatal("bad identity index")
			}
			return i
		}
		name := str(v["name"])
		accepted := v["accepted"].(bool)
		viewer := identities[index("viewer")]
		accepts := func(bundle core.Bundle) bool {
			c, err := Open(bundle, viewer)
			if err != nil {
				return false
			}
			if v["stage"] == "snapshot" {
				_, err = SnapshotPreview(bundle, c, anchor)
			}
			return err == nil
		}
		nodeBundle, err := core.DecodeBundle(encoded(v["bundle"]))
		nodeAccepted := err == nil && accepts(nodeBundle)
		if nodeAccepted != accepted {
			t.Fatalf("Go opening Node %s: got %t", name, nodeAccepted)
		}
		cards := []core.PublicIdentity{}
		for _, r := range v["readers"].([]any) {
			i, ok := integer(r)
			if !ok || i >= len(identities) {
				t.Fatal("bad reader index")
			}
			cards = append(cards, identities[i].Public)
		}
		bundle, err := core.CreateBundle(identities[index("signer")], str(v["kind"]), v["payload"], cards, v["public"].(bool), TTL)
		check(t, err)
		check(t, core.VerifyBundle(bundle))
		if v["corrupt"].(bool) {
			id := bundle.Manifest.Chunks[0].Hash
			b, err := base64.StdEncoding.DecodeString(bundle.Chunks[id])
			check(t, err)
			b[0] ^= 1
			bundle.Chunks[id] = base64.StdEncoding.EncodeToString(b)
		}
		goAccepted := accepts(bundle)
		if goAccepted != accepted {
			t.Fatalf("Go self %s: got %t", name, goAccepted)
		}
		output = append(output, map[string]any{"name": name, "nodeAccepted": nodeAccepted, "goAccepted": goAccepted, "bundle": bundle})
	}
	check(t, os.WriteFile(filepath.Join(filepath.Dir(abs), "output.json"), encoded(output), 0600))
}
