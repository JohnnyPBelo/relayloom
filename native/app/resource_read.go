package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"github.com/JohnnyPBelo/relayloom/native/transport"
	"regexp"
	"sort"
	"time"
)

var resourceBlockID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func resourceBundleAudience(bundle core.Bundle) any {
	if bundle.Manifest.PublicKey != nil {
		return "public"
	}
	ids := []string{}
	for _, key := range bundle.Manifest.Keys {
		ids = append(ids, key.Reader)
	}
	sort.Strings(ids)
	return ids
}
func (r *resourceRuntime) read(body map[string]any) (any, error) {
	action, snapshotID, pageID, blockID := text(body["action"]), text(body["snapshotId"]), text(body["pageId"]), text(body["blockId"])
	if !commandShape(body, []string{"action", "snapshotId", "pageId", "blockId"}, "") || (action != "inspect" && action != "obtain") || !core.ValidAddress(snapshotID) || !resourceBlockID.MatchString(pageID) || !resourceBlockID.MatchString(blockID) {
		return nil, errors.New("pedido de recurso do site inválido")
	}
	snapshot, err := r.node.Store.GetWithTouch(snapshotID, false)
	if err != nil {
		return nil, err
	}
	if contains(r.node.config.Blocked, snapshot.Manifest.Author.ID) {
		return nil, errors.New("autor do site bloqueado")
	}
	parsed, err := inspectSiteBundle(snapshot, r.owner)
	if err != nil {
		return nil, err
	}
	if parsed == nil {
		return nil, errors.New("é necessário um snapshot de site assinado e legível")
	}
	refs, err := sites.ResourceBlocks(parsed.Content["site"].(map[string]any))
	if err != nil {
		return nil, err
	}
	var reference map[string]any
	for _, entry := range refs {
		if entry.PageID == pageID && entry.BlockID == blockID {
			reference = entry.Reference
			break
		}
	}
	if reference == nil {
		return nil, errors.New("este bloco não contém uma referência de recurso")
	}
	result := func(status string) map[string]any { return map[string]any{"status": status, "reference": reference} }
	if contains(r.node.config.Blocked, text(reference["authorId"])) {
		return result("blocked"), nil
	}
	id := text(reference["bundleId"])
	if m, ok := r.node.private.Mutations[id]; ok && m.Author == text(reference["authorId"]) && m.Deleted && m.Expires > time.Now().UnixMilli() {
		return result("withdrawn"), nil
	}
	bundle, err := r.node.Store.GetStored(id)
	if err != nil {
		if r.node.Store.HasRecord(id) {
			return result("invalid"), nil
		}
		if action == "inspect" {
			return result("missing"), nil
		}
		now := time.Now().UnixMilli()
		if now-r.node.requests[id] > 5000 {
			r.node.rememberRequestLocked(id, now)
			if _, err = r.node.Router.Broadcast(map[string]any{"type": "request", "ids": []string{id}}, transport.Normal, 2*time.Minute, false); err != nil {
				return nil, err
			}
		}
		return result("requested"), nil
	}
	if bundle.Manifest.Kind != "site-resource" || bundle.Manifest.Author.ID != text(reference["authorId"]) {
		return result("invalid"), nil
	}
	readable := bundle.Manifest.PublicKey != nil
	for _, key := range bundle.Manifest.Keys {
		if key.Reader == r.owner.Public.ID {
			readable = true
		}
	}
	if !readable {
		return result("unreadable"), nil
	}
	value, err := core.DecryptBundleAt(bundle, r.owner, bundle.Manifest.Created)
	if err != nil {
		return result("invalid"), nil
	}
	content, err := sites.MatchResource(reference, value, map[string]any{"id": bundle.Manifest.ID, "authorId": bundle.Manifest.Author.ID, "kind": bundle.Manifest.Kind})
	if err != nil {
		return result("invalid"), nil
	}
	covered, err := sites.ResourceScopeCoversSite(resourceBundleAudience(snapshot), resourceBundleAudience(bundle))
	if err != nil || !covered {
		return result("invalid"), nil
	}
	if bundle.Manifest.Expires <= time.Now().UnixMilli() {
		out := result("expired")
		out["expires"] = bundle.Manifest.Expires
		return out, nil
	}
	if core.VerifyBundle(bundle) != nil {
		return result("invalid"), nil
	}
	if action == "obtain" {
		if _, err = r.node.Store.Get(bundle.Manifest.ID); err != nil {
			return result("invalid"), nil
		}
	}
	out := result("available")
	out["author"] = bundle.Manifest.Author
	out["expires"] = bundle.Manifest.Expires
	if action == "obtain" {
		out["content"] = content
	}
	return out, nil
}
