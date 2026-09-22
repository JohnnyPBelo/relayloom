package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"github.com/JohnnyPBelo/relayloom/native/transport"
	"time"
)

type contributionRuntime struct {
	node      *Node
	owner     *core.Identity
	catalog   *sites.ContributionCatalog
	incoming  *sites.ContributionInbox
	nextRetry int64
	allowed   map[string]map[string]any
	published map[string]int64
}

func (n *Node) contributionsLocked() (*contributionRuntime, error) {
	if n.identity == nil || n.privateDatabase == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	if n.contributionRuntime != nil && n.contributionRuntime.owner == n.identity {
		return n.contributionRuntime, nil
	}
	owner := n.identity
	n.contributionRuntime = &contributionRuntime{node: n, owner: owner, catalog: sites.NewContributionCatalog(n.siteDatabaseLocked(owner), *owner), incoming: sites.NewContributionInbox(n.siteDatabaseLocked(owner), *owner), allowed: map[string]map[string]any{}, published: map[string]int64{}}
	return n.contributionRuntime, nil
}
func (r *contributionRuntime) ensure() error {
	if r.node.identity != r.owner || r.node.privateDatabase == nil {
		return errors.New("sessão de propostas bloqueada")
	}
	return nil
}
func (r *contributionRuntime) policy(id, author string) error {
	if err := r.ensure(); err != nil {
		return err
	}
	if contains(r.node.config.Blocked, author) {
		return errors.New("autor do site bloqueado")
	}
	if m, ok := r.node.private.Mutations[id]; ok && m.Author == author && m.Deleted && m.Expires > time.Now().UnixMilli() {
		return errors.New("o autor retirou este snapshot")
	}
	return nil
}
func proposalHandle(op map[string]any) sites.ContributionHandle {
	seq, _ := number(op["sequence"])
	return sites.ContributionHandle{Sequence: seq, OperationID: text(op["operationId"]), Fingerprint: text(op["fingerprint"])}
}
func (r *contributionRuntime) permit(op map[string]any) error {
	target := op["target"].(map[string]any)
	owner, _, err := sites.ParseAddress(text(target["site"]))
	if err != nil {
		return err
	}
	if err = r.policy(text(target["snapshotId"]), owner); err != nil {
		return err
	}
	expires, _ := number(op["expires"])
	if expires <= time.Now().UnixMilli() {
		return errors.New("proposta expirada")
	}
	return nil
}
func (r *contributionRuntime) cancelPacket(id string) {
	r.node.Router.CancelLocal(func(value any) bool {
		m, ok := value.(map[string]any)
		if !ok || text(m["type"]) != "bundle" {
			return false
		}
		switch b := m["bundle"].(type) {
		case core.Bundle:
			return b.Manifest.ID == id
		case map[string]any:
			manifest, ok := b["manifest"].(map[string]any)
			return ok && text(manifest["id"]) == id
		}
		return false
	})
}
func (r *contributionRuntime) stop(op map[string]any) {
	if t, ok := op["transport"].(map[string]any); ok {
		id := text(t["bundleId"])
		delete(r.allowed, id)
		delete(r.published, id)
		r.cancelPacket(id)
	}
}
func (r *contributionRuntime) revokeInvalid() {
	for _, op := range r.allowed {
		if r.permit(op) != nil {
			r.stop(op)
		}
	}
}
func (r *contributionRuntime) close() {
	for id := range r.allowed {
		r.cancelPacket(id)
	}
	r.allowed = map[string]map[string]any{}
	r.published = map[string]int64{}
}
func (r *contributionRuntime) canServe(bundle core.Bundle) bool {
	op, ok := r.allowed[bundle.Manifest.ID]
	if !ok || op["phase"] != "queued" || r.permit(op) != nil {
		return false
	}
	meta := op["transport"].(map[string]any)
	if meta["copied"] != true {
		return false
	}
	bytes, err := core.Canonical(bundle)
	if err != nil || core.Hash(bytes) != meta["bundleHash"] {
		return false
	}
	value, err := inspectContributionBundle(bundle, r.owner)
	return err == nil && value != nil
}
func (r *contributionRuntime) finish(op map[string]any) (map[string]any, error) {
	if err := r.ensure(); err != nil {
		return nil, err
	}
	handle := proposalHandle(op)
	run := func() error {
		var err error
		if op["phase"] == "prepared" {
			op, err = r.catalog.Sign(handle, r.policy)
			if err != nil {
				return err
			}
		}
		if op["phase"] == "signed" {
			if _, err = r.catalog.Seal(handle, r.policy); err != nil {
				return err
			}
			op, err = r.catalog.Queue(handle, r.policy)
			if err != nil {
				return err
			}
		}
		if op["phase"] != "queued" {
			r.stop(op)
			return nil
		}
		if err = r.permit(op); err != nil {
			return err
		}
		bundle, err := r.catalog.AuthorizedBundle(handle, r.policy)
		if err != nil {
			return err
		}
		if bundle == nil {
			return errors.New("envelope guardado indisponível")
		}
		if _, err = r.node.Store.Put(*bundle, true); err != nil {
			return err
		}
		actual, err := r.node.Store.GetWithTouch(bundle.Manifest.ID, false)
		if err != nil {
			return err
		}
		op, err = r.catalog.MarkCopied(handle, actual)
		if err != nil {
			return err
		}
		r.allowed[actual.Manifest.ID] = op
		if !r.canServe(actual) {
			return errors.New("envio suspenso pela política actual")
		}
		now := time.Now().UnixMilli()
		if now-r.published[actual.Manifest.ID] >= 30000 {
			if _, err = r.node.Router.Broadcast(map[string]any{"type": "bundle", "bundle": actual}, transport.Normal, 2*time.Minute, false); err != nil {
				return err
			}
			r.published[actual.Manifest.ID] = now
		}
		return nil
	}
	if err := run(); err != nil {
		r.stop(op)
		if e := r.ensure(); e != nil {
			return nil, e
		}
		current, _, e := r.catalog.Operation(handle.Sequence, handle.OperationID)
		if e != nil {
			return nil, e
		}
		if current == nil {
			return nil, err
		}
		return map[string]any{"operation": current, "error": err.Error()}, nil
	}
	return map[string]any{"operation": op}, nil
}
func (r *contributionRuntime) tick() error {
	now := time.Now().UnixMilli()
	if now < r.nextRetry {
		return nil
	}
	r.nextRetry = now + 5000
	state, err := r.catalog.State()
	if err != nil {
		r.close()
		return err
	}
	prior := map[string]bool{}
	for id := range r.allowed {
		prior[id] = true
	}
	for _, raw := range state["operations"].([]any) {
		op := raw.(map[string]any)
		if meta, ok := op["transport"].(map[string]any); ok {
			delete(prior, text(meta["bundleId"]))
		}
		if phase := text(op["phase"]); phase == "prepared" || phase == "signed" || phase == "queued" {
			if _, err = r.finish(op); err != nil {
				r.close()
				return err
			}
		} else {
			r.stop(op)
		}
	}
	for id := range prior {
		delete(r.allowed, id)
		delete(r.published, id)
		r.cancelPacket(id)
	}
	return nil
}
func (r *contributionRuntime) command(body map[string]any) (any, error) {
	if err := r.ensure(); err != nil {
		return nil, err
	}
	action := text(body["action"])
	if action == "form" {
		return r.node.contributionFormLocked(body)
	}
	if action == "state" && commandShape(body, []string{"action"}, "") {
		return r.catalog.State()
	}
	if action == "inbox" && commandShape(body, []string{"action"}, "") {
		return r.inbox()
	}
	if action == "submit" && commandShape(body, []string{"action", "sequence", "operationId", "snapshotId", "pageId", "formId", "values", "publicationScope", "ttlMs"}, "") {
		input := map[string]any{}
		for key, value := range body {
			if key != "action" {
				input[key] = value
			}
		}
		q, _, err := sites.ContributionCreationRequest(input, r.owner.Public.ID)
		if err != nil {
			return nil, err
		}
		op, err := r.catalog.Prepare(q, func() (core.Bundle, error) { return r.node.Store.GetWithTouch(text(q["snapshotId"]), false) }, r.policy)
		if err != nil {
			return nil, err
		}
		return r.finish(op)
	}
	if !contains([]string{"operation", "resume", "cancel"}, action) || !commandShape(body, []string{"action", "sequence", "operationId"}, "") {
		return nil, errors.New("comando de proposta inválido")
	}
	sequence, err := number(body["sequence"])
	if err != nil {
		return nil, err
	}
	op, retired, err := r.catalog.Operation(sequence, text(body["operationId"]))
	if err != nil {
		return nil, err
	}
	if action == "operation" {
		return map[string]any{"operation": op, "retired": retired}, nil
	}
	if op == nil {
		return nil, errors.New("resultado de proposta desconhecido ou retirado")
	}
	if action == "cancel" {
		op, err = r.catalog.Cancel(proposalHandle(op))
		if err != nil {
			return nil, err
		}
		r.stop(op)
		return map[string]any{"operation": op}, nil
	}
	return r.finish(op)
}

// Receive preserves owner evidence before the ordinary relay cache may evict it.
func (r *contributionRuntime) receive(bundle core.Bundle) error {
	if err := r.ensure(); err != nil {
		return err
	}
	content, err := inspectContributionBundle(bundle, r.owner)
	if err != nil {
		return err
	}
	if content == nil {
		return nil
	}
	p := content["proposal"].(map[string]any)
	b := p["body"].(map[string]any)
	target := b["target"].(map[string]any)
	owner, _, _ := sites.ParseAddress(text(target["site"]))
	if owner != r.owner.Public.ID {
		return nil
	}
	var source *core.Bundle
	if available, e := r.node.Store.GetWithTouch(text(target["snapshotId"]), false); e == nil {
		if e = r.incoming.CheckSource(bundle, available); e != nil {
			return r.ensure()
		}
		source = &available
	}
	result, err := r.incoming.Admit(bundle, r.policy)
	if err != nil {
		return err
	}
	if result["outcome"] != "conflict" {
		return r.completeSource(result["entry"].(map[string]any), source)
	}
	return nil
}
func (r *contributionRuntime) receiveSource(bundle core.Bundle) error {
	if err := r.ensure(); err != nil {
		return err
	}
	if bundle.Manifest.Author.ID != r.owner.Public.ID {
		return nil
	}
	state, err := r.incoming.State()
	if err != nil {
		return err
	}
	for _, raw := range state["entries"].([]any) {
		e := raw.(map[string]any)
		target := e["target"].(map[string]any)
		if e["phase"] == "missing-source" && target["snapshotId"] == bundle.Manifest.ID {
			if err = r.completeSource(e, &bundle); err != nil {
				return err
			}
		}
	}
	return nil
}
func (r *contributionRuntime) completeSource(entry map[string]any, supplied *core.Bundle) error {
	if entry["phase"] != "missing-source" {
		return nil
	}
	var source core.Bundle
	var err error
	if supplied != nil {
		source = *supplied
	} else {
		target := entry["target"].(map[string]any)
		source, err = r.node.Store.GetWithTouch(text(target["snapshotId"]), false)
		if err != nil {
			return nil
		}
	}
	if _, err = r.incoming.AttachSource(text(entry["id"]), source, r.policy); err != nil {
		return r.ensure()
	}
	return nil
}

// Durable candidates remain separate from owner approval and receipts.
func (r *contributionRuntime) inbox() (any, error) {
	items := []any{}
	for _, m := range r.node.Store.List() {
		if m.Kind != "site-contribution" {
			continue
		}
		bundle, err := r.node.Store.GetWithTouch(m.ID, false)
		if err != nil {
			continue
		}
		if err = r.receive(bundle); err != nil {
			if e := r.ensure(); e != nil {
				return nil, e
			}
		}
	}
	state, err := r.incoming.State()
	if err != nil {
		return nil, err
	}
	for _, raw := range state["entries"].([]any) {
		entry := raw.(map[string]any)
		if entry["phase"] == "expired" {
			continue
		}
		if err = r.completeSource(entry, nil); err != nil {
			return nil, err
		}
		current, err := r.incoming.Read(text(entry["id"]), r.policy)
		if err != nil {
			if e := r.ensure(); e != nil {
				return nil, e
			}
			continue
		}
		if current == nil {
			continue
		}
		e := current["entry"].(map[string]any)
		if e["phase"] == "expired" {
			continue
		}
		proof := e["proof"].(map[string]any)
		target := e["target"].(map[string]any)
		base := map[string]any{"id": e["id"], "bundleId": proof["bundleId"], "contributorId": e["contributorId"], "operationId": e["operationId"], "target": target, "created": e["created"], "expires": e["expires"], "conflicts": e["conflicts"], "conflictOverflow": e["conflictOverflow"]}
		p, ok := current["proposal"].(map[string]any)
		if !ok {
			if !r.node.Store.Has(text(target["snapshotId"])) {
				base["status"] = "missing-source"
				items = append(items, base)
			}
			continue
		}
		b := p["body"].(map[string]any)
		base["status"] = "verified-candidate"
		base["contributor"] = b["contributor"]
		base["values"] = b["values"]
		base["publicationScope"] = b["publicationScope"]
		base["schemaHash"] = b["schemaHash"]
		items = append(items, base)
	}
	return map[string]any{"items": items, "scope": "candidates", "durable": true}, nil
}
