package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"sort"
	"time"
)

// A carrier can retain opaque private envelopes. If this identity can read
// the resource, validate the closed payload before accepting or serving it.
func inspectResourceBundle(bundle core.Bundle, identity *core.Identity) error {
	if bundle.Manifest.Kind != "site-resource" {
		return nil
	}
	readable := bundle.Manifest.PublicKey != nil
	for _, key := range bundle.Manifest.Keys {
		if identity != nil && key.Reader == identity.Public.ID {
			readable = true
		}
	}
	if !readable {
		return nil
	}
	value, err := core.DecryptBundle(bundle, identity)
	if err != nil {
		return err
	}
	_, err = sites.ParseResource(value)
	return err
}

func (r *siteRuntime) validateResources(request sites.NormalizedRequest) error {
	refs, err := sites.ResourceBlocks(request.Payload["site"].(map[string]any))
	if err != nil {
		return err
	}
	var readers any = "public"
	if cards, ok := request.Context.Readers.([]core.PublicIdentity); ok {
		ids := []string{}
		for _, card := range cards {
			ids = append(ids, card.ID)
		}
		sort.Strings(ids)
		readers = ids
	}
	seen := map[string]bool{}
	for _, entry := range refs {
		ref := entry.Reference
		id := text(ref["bundleId"])
		if seen[id] {
			continue
		}
		seen[id] = true
		if m, ok := r.node.private.Mutations[id]; ok && m.Author == text(ref["authorId"]) && m.Deleted && m.Expires > time.Now().UnixMilli() {
			return errors.New("o autor retirou um recurso deste site")
		}
		if contains(r.node.config.Blocked, text(ref["authorId"])) {
			return errors.New("autor do recurso bloqueado")
		}
		bundle, err := r.node.Store.GetWithTouch(id, false)
		if err != nil {
			return err
		}
		value, err := core.DecryptBundle(bundle, r.owner)
		if err != nil {
			return err
		}
		if _, err = sites.MatchResource(ref, value, map[string]any{"id": bundle.Manifest.ID, "authorId": bundle.Manifest.Author.ID, "kind": bundle.Manifest.Kind}); err != nil {
			return err
		}
		var scope any = "public"
		if bundle.Manifest.PublicKey == nil {
			ids := []string{}
			for _, key := range bundle.Manifest.Keys {
				ids = append(ids, key.Reader)
			}
			sort.Strings(ids)
			scope = ids
		}
		covered, err := sites.ResourceScopeCoversSite(readers, scope)
		if err != nil {
			return err
		}
		if !covered {
			return errors.New("um recurso não permite todos os leitores deste site")
		}
	}
	return nil
}
