package app

import (
	"encoding/base64"
	"encoding/json"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"github.com/JohnnyPBelo/relayloom/native/transport"
	"testing"
	"time"
)

func runtimeSitePayload(title string) map[string]any {
	return map[string]any{"type": "site", "blocks": []any{}, "theme": "sand", "site": map[string]any{"version": 1, "title": title, "description": "Runtime tests", "home": "home", "design": map[string]any{"font": "sans", "width": "standard", "radius": "soft", "accent": "#207a70"}, "pages": []any{map[string]any{"id": "home", "slug": "inicio", "title": "Início", "blocks": []any{}}}}}
}
func TestSiteRuntimeRecoversAuthorizedCopyAfterQuotaAndRestart(t *testing.T) {
	node, owner := nodeFor(t, "Go site runtime recovery")
	address, _ := sites.Address(owner.ID, "profile")
	state := apply(t, node, "site-command", map[string]any{"action": "state", "address": address}).(sites.CatalogState)
	apply(t, node, "settings", map[string]any{"quota": int64(1024 * 1024)})
	payload := runtimeSitePayload("Large opaque fixture")
	payload["attachments"] = []any{map[string]any{"name": "synthetic.bin.png", "mime": "image/png", "data": base64.StdEncoding.EncodeToString(make([]byte, 1100000))}}
	request := map[string]any{"action": "publish", "name": "profile", "sequence": *state.NextSequence, "operationId": "00000000-0000-0000-0000-000000000001", "expectedBase": state.Base, "payload": payload, "recipients": "public", "ttlMs": int64(3600000)}
	result := apply(t, node, "site-command", request).(map[string]any)
	op := result["operation"].(sites.OperationSummary)
	if op.Phase != "committed" || text(result["error"]) == "" || node.Store.Has(op.BundleID) {
		t.Fatal("quota failure did not preserve private committed intent")
	}
	apply(t, node, "settings", map[string]any{"quota": int64(8 * 1024 * 1024)})
	dir := node.Dir
	if e := node.Close(); e != nil {
		t.Fatal(e)
	}
	restarted, e := NewNode(dir)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { restarted.Close() })
	apply(t, restarted, "unlock", map[string]any{"password": password})
	deadline := time.Now().Add(12 * time.Second)
	for !time.Now().After(deadline) {
		value := apply(t, restarted, "site-command", map[string]any{"action": "resolve", "address": address}).(map[string]any)
		if value["status"] == "available" {
			object := value["object"].(*DisplayObject)
			if object.ID != op.BundleID {
				t.Fatal("recovery generated a different bundle")
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("site recovery did not complete")
}
func TestSiteReceiveRevalidatesPrivateSnapshotAfterWireWasOpaque(t *testing.T) {
	target, recipient := nodeFor(t, "Go private snapshot validator")
	owner, e := core.CreateIdentity("Original owner")
	if e != nil {
		t.Fatal(e)
	}
	attacker, e := core.CreateIdentity("Other signer")
	if e != nil {
		t.Fatal(e)
	}
	content, e := sites.CreateContent(owner, "profile", 1, []string{}, runtimeSitePayload("Original"))
	if e != nil {
		t.Fatal(e)
	}
	forged, e := core.CreateBundle(attacker, "site", content, []core.PublicIdentity{recipient}, false, 3600000)
	if e != nil {
		t.Fatal(e)
	}
	data, e := core.Canonical(map[string]any{"type": "bundle", "bundle": forged})
	if e != nil {
		t.Fatal(e)
	}
	if e = ValidateWire(json.RawMessage(data)); e != nil {
		t.Fatal("opaque transit control failed", e)
	}
	target.mu.Lock()
	e = target.receiveLocked(transport.Delivery{Payload: json.RawMessage(data)})
	target.mu.Unlock()
	if e == nil || target.Store.Has(forged.Manifest.ID) {
		t.Fatal("readable invalid snapshot entered storage")
	}
	good, e := core.CreateBundle(owner, "site", content, []core.PublicIdentity{recipient}, false, 3600000)
	if e != nil {
		t.Fatal(e)
	}
	data, _ = core.Canonical(map[string]any{"type": "bundle", "bundle": good})
	target.mu.Lock()
	e = target.receiveLocked(transport.Delivery{Payload: json.RawMessage(data)})
	target.mu.Unlock()
	if e != nil || !target.Store.Has(good.Manifest.ID) {
		t.Fatal("valid private control failed", e)
	}
}

func TestVersionedSiteFallbackUsesSharedNodeSemantics(t *testing.T) {
	node, _ := nodeFor(t, "Fallback semantics owner")
	node.mu.Lock()
	defer node.mu.Unlock()
	for _, url := range []any{nil, false, 0, ""} {
		payload := runtimeSitePayload("Rich site with a compatibility block")
		payload["blocks"] = []any{map[string]any{"id": "fallback", "type": "text", "title": "Fallback", "body": "Body", "url": url}}
		content, err := sites.CreateContent(*node.identity, "profile", 1, []string{}, payload)
		if err != nil {
			t.Fatal(err)
		}
		bundle, err := core.CreateBundle(*node.identity, "site", content, nil, true, 3600000)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = node.displayLocked(bundle); err != nil {
			t.Fatal("valid Node-compatible fallback rejected", err)
		}
	}
}
