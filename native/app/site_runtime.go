package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"github.com/JohnnyPBelo/relayloom/native/transport"
	"time"
)

func inspectSiteBundle(bundle core.Bundle, identity *core.Identity) (*sites.VerifiedContent, error) {
	if bundle.Manifest.Kind != "site" {
		return nil, nil
	}
	readable := bundle.Manifest.PublicKey != nil
	for _, key := range bundle.Manifest.Keys {
		if identity != nil && key.Reader == identity.Public.ID {
			readable = true
		}
	}
	if !readable {
		return nil, nil
	}
	value, err := core.DecryptBundle(bundle, identity)
	if err != nil {
		return nil, err
	}
	m, err := object(value)
	if err != nil {
		return nil, err
	}
	if text(m["type"]) != "site" {
		return nil, errors.New("conteúdo de site inválido")
	}
	if _, versioned := m["siteRevision"]; !versioned {
		doc, _ := m["site"].(map[string]any)
		version, _ := number(doc["version"])
		if version == 3 {
			return nil, errors.New("sites versão 3 exigem um snapshot assinado")
		}
		return nil, validateContent(Content(m))
	}
	verified, err := sites.VerifyContent(m, bundle.Manifest.Author, "")
	if err != nil {
		return nil, err
	}
	return &verified, nil
}

type siteDatabase func(func(*groupstore.Tx) error) error

func (d siteDatabase) Update(fn func(*groupstore.Tx) error) error { return d(fn) }

type pendingSite struct {
	name      string
	operation sites.OperationSummary
}
type siteRuntime struct {
	node        *Node
	owner       *core.Identity
	catalog     *sites.Catalog
	initialized bool
	pending     []pendingSite
	nextRetry   int64
	lastError   string
}

func (n *Node) siteDatabaseLocked(owner *core.Identity) siteDatabase {
	return siteDatabase(func(fn func(*groupstore.Tx) error) error {
		if n.identity != owner || n.privateDatabase == nil {
			return errors.New("sessão de site bloqueada")
		}
		err := n.privateDatabase.Update(func(tx *groupstore.Tx) error {
			state, e := profilestate.Read(tx)
			if e != nil {
				return e
			}
			if state == nil || state.Digest != n.privateDigest {
				return errors.New("estado privado desactualizado")
			}
			return fn(tx)
		})
		if errors.Is(err, groupstore.ErrIntegrity) || errors.Is(err, groupstore.ErrUnavailable) {
			_ = n.lockPrivateLocked()
		}
		return err
	})
}

func (n *Node) sitesLocked() (*siteRuntime, error) {
	if n.identity == nil || n.privateDatabase == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	if n.siteRuntime != nil && n.siteRuntime.owner == n.identity {
		return n.siteRuntime, nil
	}
	owner := n.identity
	database := n.siteDatabaseLocked(owner)
	n.siteRuntime = &siteRuntime{node: n, owner: owner, catalog: sites.NewCatalog(database, *owner), pending: []pendingSite{}}
	return n.siteRuntime, nil
}
func (n *Node) siteStatusLocked() any {
	if n.identity == nil {
		return nil
	}
	if n.siteRuntime == nil {
		return map[string]any{"pending": 0, "error": ""}
	}
	return map[string]any{"pending": len(n.siteRuntime.pending), "error": n.siteRuntime.lastError}
}
func (r *siteRuntime) track(name string, op sites.OperationSummary) {
	for i, p := range r.pending {
		if p.name == name && p.operation.Sequence == op.Sequence {
			r.pending[i] = pendingSite{name, op}
			return
		}
	}
	r.pending = append(r.pending, pendingSite{name, op})
}
func (r *siteRuntime) remove(name string, seq int64) {
	next := r.pending[:0]
	for _, p := range r.pending {
		if p.name != name || p.operation.Sequence != seq {
			next = append(next, p)
		}
	}
	r.pending = next
}
func (r *siteRuntime) initialize() error {
	if r.initialized {
		return nil
	}
	for _, m := range r.node.Store.List() {
		if m.Kind != "site" || contains(r.node.config.Blocked, m.Author.ID) {
			continue
		}
		bundle, err := r.node.Store.GetWithTouch(m.ID, false)
		if err != nil {
			continue
		}
		parsed, err := inspectSiteBundle(bundle, r.owner)
		if err != nil {
			continue
		}
		if parsed != nil {
			if _, err = r.catalog.Observe(bundle, parsed.Revision.Body.Name); err != nil {
				return err
			}
		}
	}
	pending, err := r.catalog.Pending()
	if err != nil {
		return err
	}
	r.pending = []pendingSite{}
	for _, p := range pending {
		r.track(p.Name, p.OperationSummary)
	}
	r.initialized = true
	return nil
}
func (r *siteRuntime) receive(bundle core.Bundle) error {
	parsed, err := inspectSiteBundle(bundle, r.owner)
	if err != nil {
		return err
	}
	if parsed != nil {
		_, err = r.catalog.Observe(bundle, parsed.Revision.Body.Name)
	}
	return err
}
func (r *siteRuntime) current(name string, h sites.OperationHandle) (sites.OperationSummary, error) {
	op, err := r.catalog.Operation(name, h.Sequence, h.OperationID)
	if err != nil {
		return sites.OperationSummary{}, err
	}
	if op == nil || op.Fingerprint != h.Fingerprint {
		return sites.OperationSummary{}, errors.New("operação de site desconhecida")
	}
	return *op, nil
}
func (r *siteRuntime) finish(name string, h sites.OperationHandle) (map[string]any, error) {
	op, err := r.current(name, h)
	if err != nil {
		return nil, err
	}
	access, err := r.catalog.PreparationAccess(name, op.OperationHandle)
	if err != nil {
		return nil, err
	}
	if access != nil {
		if readers, ok := access.Readers.([]string); ok {
			for _, id := range readers {
				if contains(r.node.config.Blocked, id) {
					r.lastError = "A publicação está em pausa porque um leitor foi bloqueado."
					return map[string]any{"operation": op, "error": r.lastError}, nil
				}
			}
		}
	}
	if op.Phase == "prepared" {
		op, err = r.catalog.Commit(name, op.OperationHandle)
		if err != nil {
			return nil, err
		}
	}
	if op.Phase == "committed" {
		bundle, e := r.catalog.AuthorizedBundle(name, op.OperationHandle)
		if e != nil {
			return nil, e
		}
		if _, e = r.node.Store.Put(bundle, true); e != nil {
			return nil, e
		}
		stored, e := r.node.Store.GetWithTouch(bundle.Manifest.ID, false)
		if e != nil {
			return nil, e
		}
		a, e := core.Canonical(stored)
		if e != nil {
			return nil, e
		}
		b, _ := core.Canonical(bundle)
		if string(a) != string(b) {
			return nil, errors.New("cópia do site não corresponde à publicação")
		}
		op, e = r.catalog.MarkReady(name, op.OperationHandle)
		if e != nil {
			return nil, e
		}
		allowed, e := r.node.maySeedLocked(stored.Manifest)
		if e != nil {
			return nil, e
		}
		if !allowed {
			return nil, errors.New("partilha de site interrompida")
		}
		if _, e = r.node.Router.Broadcast(map[string]any{"type": "bundle", "bundle": stored}, transport.Bulk, 2*time.Minute, false); e != nil {
			return nil, e
		}
	}
	if op.Phase != "prepared" && op.Phase != "committed" {
		r.remove(name, op.Sequence)
	}
	r.lastError = ""
	return map[string]any{"operation": op}, nil
}
func (r *siteRuntime) tick() {
	now := time.Now().UnixMilli()
	if now < r.nextRetry {
		return
	}
	r.nextRetry = now + 5000
	if err := r.initialize(); err != nil {
		r.lastError = err.Error()
		return
	}
	for i, p := range r.pending {
		if p.operation.Phase == "committed" || p.operation.Requested {
			r.pending = append(append(r.pending[:i:i], r.pending[i+1:]...), p)
			result, err := r.finish(p.name, p.operation.OperationHandle)
			if err != nil {
				r.lastError = err.Error()
			} else {
				r.lastError = text(result["error"])
			}
			return
		}
	}
}
func (r *siteRuntime) address(value any) (string, string, error) {
	owner, name, err := sites.ParseAddress(text(value))
	if err != nil {
		return "", "", err
	}
	if contains(r.node.config.Blocked, owner) {
		return "", "", errors.New("contacto bloqueado")
	}
	return owner, name, nil
}
func (r *siteRuntime) resolve(address, revisionID string, hasRevision bool) (map[string]any, error) {
	owner, name, err := r.address(address)
	if err != nil {
		return nil, err
	}
	state, err := r.catalog.State(owner, name)
	if err != nil {
		return nil, err
	}
	if hasRevision && !core.ValidAddress(revisionID) {
		return nil, errors.New("revisão inválida")
	}
	if !hasRevision && state.Status == "conflict" {
		return map[string]any{"status": "conflict", "address": address, "state": state}, nil
	}
	if !hasRevision && len(state.Heads) > 0 {
		revisionID = state.Heads[0].ID
	}
	if revisionID == "" {
		return map[string]any{"status": "pending", "address": address, "state": state}, nil
	}
	history, err := r.catalog.History(owner, name)
	if err != nil {
		return nil, err
	}
	var header *sites.StoredRevision
	for _, h := range history {
		if h.Revision.ID == revisionID {
			copy := h
			header = &copy
			break
		}
	}
	if header == nil {
		return map[string]any{"status": "unknown-revision", "address": address, "revisionId": revisionID, "state": state}, nil
	}
	candidates := append([]string{}, header.Bundles...)
	for _, m := range r.node.Store.List() {
		if m.Kind == "site" && m.Author.ID == owner && !contains(candidates, m.ID) {
			candidates = append(candidates, m.ID)
		}
	}
	for _, id := range candidates {
		bundle, e := r.node.Store.Get(id)
		if e != nil {
			continue
		}
		parsed, e := inspectSiteBundle(bundle, r.owner)
		if e != nil || parsed == nil || parsed.Revision.ID != revisionID || parsed.Revision.Body.Name != name || bundle.Manifest.Author.ID != owner {
			continue
		}
		object, e := r.node.displayLocked(bundle)
		if e != nil {
			continue
		}
		return map[string]any{"status": "available", "address": address, "revisionId": revisionID, "object": object, "state": state}, nil
	}
	now := time.Now().UnixMilli()
	wanted := []string{}
	for _, id := range header.Bundles {
		if now-r.node.requests[id] > 5000 {
			wanted = append(wanted, id)
			r.node.rememberRequestLocked(id, now)
		}
	}
	if len(wanted) > 0 {
		_, _ = r.node.Router.Broadcast(map[string]any{"type": "request", "ids": wanted}, transport.Normal, 2*time.Minute, false)
	}
	return map[string]any{"status": "pending", "address": address, "revisionId": revisionID, "state": state}, nil
}
func commandShape(body map[string]any, fields []string, optional string) bool {
	if len(body) != len(fields) && (optional == "" || len(body) != len(fields)+1) {
		return false
	}
	for _, key := range fields {
		if _, ok := body[key]; !ok {
			return false
		}
	}
	for key := range body {
		if key != optional && !contains(fields, key) {
			return false
		}
	}
	return true
}
func (r *siteRuntime) readers(ids any) (any, error) {
	if text(ids) == "public" {
		return "public", nil
	}
	list, err := stringsList(ids, 64, true)
	if err != nil {
		return nil, err
	}
	list = append([]string{r.owner.Public.ID}, list...)
	cards := []core.PublicIdentity{}
	seen := map[string]bool{}
	for _, id := range list {
		if seen[id] {
			continue
		}
		seen[id] = true
		if contains(r.node.config.Blocked, id) {
			return nil, errors.New("contacto bloqueado")
		}
		var card *core.PublicIdentity
		if id == r.owner.Public.ID {
			copy := r.owner.Public
			card = &copy
		} else {
			for _, c := range r.node.config.Contacts {
				if c.ID == id {
					copy := c
					card = &copy
					break
				}
			}
		}
		if card == nil {
			return nil, errors.New("adicione primeiro o cartão do destinatário")
		}
		cards = append(cards, *card)
	}
	return cards, nil
}
func (r *siteRuntime) command(body map[string]any) (any, error) {
	action := text(body["action"])
	if action == "operation" || action == "cancel" {
		if !commandShape(body, []string{"action", "name", "sequence", "operationId"}, "") {
			return nil, errors.New("comando de site inválido")
		}
		seq, err := number(body["sequence"])
		if err != nil {
			return nil, err
		}
		op, err := r.catalog.Operation(text(body["name"]), seq, text(body["operationId"]))
		if err != nil {
			return nil, err
		}
		if action == "operation" || op == nil {
			return map[string]any{"operation": op}, nil
		}
		cancelled, err := r.catalog.Cancel(text(body["name"]), op.OperationHandle)
		if err != nil {
			return nil, err
		}
		if cancelled.Phase == "cancelled" {
			r.remove(text(body["name"]), seq)
		}
		return map[string]any{"operation": cancelled}, nil
	}
	if err := r.initialize(); err != nil {
		return nil, err
	}
	if action == "state" || action == "history" {
		if !commandShape(body, []string{"action", "address"}, "") {
			return nil, errors.New("comando de site inválido")
		}
		owner, name, err := r.address(body["address"])
		if err != nil {
			return nil, err
		}
		if action == "state" {
			return r.catalog.State(owner, name)
		}
		history, err := r.catalog.History(owner, name)
		return map[string]any{"address": body["address"], "revisions": history}, err
	}
	if action == "resolve" {
		if !commandShape(body, []string{"action", "address"}, "revisionId") {
			return nil, errors.New("comando de site inválido")
		}
		_, has := body["revisionId"]
		return r.resolve(text(body["address"]), text(body["revisionId"]), has)
	}
	if action == "resume" {
		if !commandShape(body, []string{"action", "name", "sequence", "operationId"}, "") {
			return nil, errors.New("comando de site inválido")
		}
		seq, err := number(body["sequence"])
		if err != nil {
			return nil, err
		}
		op, err := r.catalog.Operation(text(body["name"]), seq, text(body["operationId"]))
		if err != nil {
			return nil, err
		}
		if op == nil {
			return nil, errors.New("operação desconhecida")
		}
		return r.finish(text(body["name"]), op.OperationHandle)
	}
	if action != "publish" || !commandShape(body, []string{"action", "name", "sequence", "operationId", "expectedBase", "payload", "recipients", "ttlMs"}, "confirmedHeads") {
		return nil, errors.New("comando de site inválido")
	}
	readers, err := r.readers(body["recipients"])
	if err != nil {
		return nil, err
	}
	request := map[string]any{"sequence": body["sequence"], "operationId": body["operationId"], "expectedBase": body["expectedBase"], "payload": body["payload"], "readers": readers, "ttlMs": body["ttlMs"]}
	if heads, exists := body["confirmedHeads"]; exists {
		request["confirmedHeads"] = heads
	}
	name := text(body["name"])
	op, err := r.catalog.CreatePublication(name, request, r.validateResources)
	if err != nil {
		return nil, err
	}
	if op.Phase == "prepared" || op.Phase == "committed" {
		r.track(name, op)
	}
	address, _ := sites.Address(r.owner.Public.ID, name)
	result, err := r.finish(name, op.OperationHandle)
	if err != nil {
		r.lastError = err.Error()
		current, e := r.current(name, op.OperationHandle)
		if e != nil {
			return nil, err
		}
		return map[string]any{"address": address, "operation": current, "error": r.lastError}, nil
	}
	result["address"] = address
	return result, nil
}
func (n *Node) cancelSitePacketsLocked() {
	if n.identity == nil {
		return
	}
	owner := n.identity.Public.ID
	n.Router.CancelLocal(func(value any) bool {
		m, ok := value.(map[string]any)
		if !ok || text(m["type"]) != "bundle" {
			return false
		}
		b, e := decodeBundle(m["bundle"])
		if e != nil || b.Manifest.Kind != "site" || b.Manifest.Author.ID != owner {
			return false
		}
		for _, k := range b.Manifest.Keys {
			if contains(n.config.Blocked, k.Reader) {
				return true
			}
		}
		return false
	})
}
