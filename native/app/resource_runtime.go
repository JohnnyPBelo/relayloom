package app

import (
	"errors"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
)

// Resources are copied locally without broadcast. A signed site reference and
// an explicit retrieval request provide discovery and transfer.
type resourceRuntime struct {
	node      *Node
	owner     *core.Identity
	catalog   *sites.ResourceCatalog
	nextRetry int64
}

func (n *Node) resourcesLocked() (*resourceRuntime, error) {
	if n.identity == nil || n.privateDatabase == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	if n.resourceRuntime != nil && n.resourceRuntime.owner == n.identity {
		return n.resourceRuntime, nil
	}
	owner := n.identity
	n.resourceRuntime = &resourceRuntime{node: n, owner: owner, catalog: sites.NewResourceCatalog(n.siteDatabaseLocked(owner), *owner)}
	return n.resourceRuntime, nil
}
func (r *resourceRuntime) ensure() error {
	if r.node.identity != r.owner || r.node.privateDatabase == nil {
		return errors.New("sessão de recursos bloqueada")
	}
	return nil
}
func (r *resourceRuntime) readers(scope any) ([]core.PublicIdentity, bool, error) {
	if scope == "public" {
		return nil, true, nil
	}
	ids, err := stringsList(scope, 64, true)
	if err != nil {
		return nil, false, err
	}
	cards := []core.PublicIdentity{}
	for _, id := range ids {
		if contains(r.node.config.Blocked, id) {
			return nil, false, errors.New("contacto bloqueado")
		}
		if id == r.owner.Public.ID {
			cards = append(cards, r.owner.Public)
			continue
		}
		found := false
		for _, card := range r.node.config.Contacts {
			if card.ID == id {
				cards = append(cards, card)
				found = true
				break
			}
		}
		if !found {
			return nil, false, errors.New("adicione primeiro o cartão do destinatário")
		}
	}
	return cards, false, nil
}
func resourceOperationHandle(op map[string]any) sites.ResourceHandle {
	seq, _ := number(op["sequence"])
	return sites.ResourceHandle{Sequence: seq, OperationID: text(op["operationId"]), Fingerprint: text(op["fingerprint"])}
}
func (r *resourceRuntime) copy(op map[string]any) (map[string]any, error) {
	if text(op["recipients"]) != "public" {
		ids, err := stringsList(op["recipients"], 64, true)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			if contains(r.node.config.Blocked, id) {
				return nil, errors.New("a criação está em pausa porque um leitor foi bloqueado")
			}
		}
	}
	h := resourceOperationHandle(op)
	bundle, err := r.catalog.AuthorizedBundle(h)
	if err != nil {
		return nil, err
	}
	if bundle == nil {
		current, _, err := r.catalog.Operation(h.Sequence, h.OperationID)
		return current, err
	}
	if _, err = r.node.Store.Put(*bundle, true); err != nil {
		return nil, err
	}
	copied, err := r.node.Store.GetWithTouch(bundle.Manifest.ID, false)
	if err != nil {
		return nil, err
	}
	return r.catalog.Ready(h, copied)
}
func (r *resourceRuntime) finish(op map[string]any) (map[string]any, error) {
	if err := r.ensure(); err != nil {
		return nil, err
	}
	if op["phase"] != "copy-pending" {
		return map[string]any{"operation": op}, nil
	}
	ready, err := r.copy(op)
	if err == nil {
		return map[string]any{"operation": ready}, nil
	}
	if e := r.ensure(); e != nil {
		return nil, e
	}
	h := resourceOperationHandle(op)
	current, _, e := r.catalog.Operation(h.Sequence, h.OperationID)
	if e != nil {
		return nil, e
	}
	if current == nil {
		return nil, err
	}
	return map[string]any{"operation": current, "error": err.Error()}, nil
}
func (r *resourceRuntime) tick() error {
	now := time.Now().UnixMilli()
	if now < r.nextRetry {
		return nil
	}
	r.nextRetry = now + 5000
	if err := r.ensure(); err != nil {
		return err
	}
	state, err := r.catalog.State()
	if err != nil {
		return err
	}
	for _, raw := range state["operations"].([]any) {
		op := raw.(map[string]any)
		if op["phase"] == "copy-pending" {
			_, err = r.finish(op)
			return err
		}
	}
	return nil
}
func (r *resourceRuntime) command(body map[string]any) (any, error) {
	if err := r.ensure(); err != nil {
		return nil, err
	}
	action := text(body["action"])
	if action == "state" && commandShape(body, []string{"action"}, "") {
		return r.catalog.State()
	}
	if (action == "operation" || action == "resume") && commandShape(body, []string{"action", "sequence", "operationId"}, "") {
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
			return nil, errors.New("resultado de criação desconhecido ou retirado")
		}
		return r.finish(op)
	}
	if action != "create" || !commandShape(body, []string{"action", "sequence", "operationId", "content", "recipients", "ttlMs"}, "") {
		return nil, errors.New("comando de recurso inválido")
	}
	request := map[string]any{}
	for key, value := range body {
		if key != "action" {
			request[key] = value
		}
	}
	op, err := r.catalog.Prepare(request, r.readers)
	if err != nil {
		return nil, err
	}
	return r.finish(op)
}
