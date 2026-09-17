package app

import (
	"errors"
	"sort"
	"strings"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
)

const HistoryPageObjects = 100
const HistoryPageBytes = 4 * 1024 * 1024

type History struct {
	HasMore      bool     `json:"hasMore"`
	NextBefore   *string  `json:"nextBefore"`
	Total        int      `json:"total"`
	AvailableIDs []string `json:"availableIds"`
}
type HistoryPage struct {
	Objects []DisplayObject `json:"objects"`
	History History         `json:"history"`
}

// Summary content is a projection of supported display fields. In particular,
// arbitrary extension fields and nested metadata cannot smuggle large payloads
// into an otherwise bounded attachment-free snapshot. Full /view is unchanged.
func summaryContent(content Content) Content {
	result := Content{}
	if groupaccess.HasBinding(content) {
		for _, field := range []string{"groupAudience", "groupEpoch", "targetEpoch"} {
			if value, ok := content[field].(string); ok {
				result[field] = value
			}
		}
	}
	for _, field := range []string{"type", "text", "title", "conversation", "target", "emoji", "replyTo", "priority"} {
		if value, ok := content[field].(string); ok {
			result[field] = value
		}
	}
	if value, ok := content["value"].(bool); ok {
		result["value"] = value
	}
	if value, exists := content["members"]; exists {
		if cards, err := members(value); err == nil {
			result["members"] = cards
		}
	}
	if text(content["type"]) == "site" {
		if revision, exists := content["siteRevision"]; exists {
			result["siteRevision"] = revision
		}
		if site, exists := content["site"]; exists {
			result["site"] = site
		}
		if theme, ok := content["theme"].(string); ok {
			result["theme"] = theme
		}
		blocks := []any{}
		for _, value := range content["blocks"].([]any) {
			block, _ := object(value)
			summary := map[string]any{}
			for _, field := range []string{"id", "type", "title", "body", "url"} {
				if value, ok := block[field].(string); ok {
					summary[field] = value
				}
			}
			blocks = append(blocks, summary)
		}
		result["blocks"] = blocks
	}
	if attachments, ok := content["attachments"].([]any); ok {
		summaries := make([]any, 0, len(attachments))
		for _, value := range attachments {
			attachment, _ := object(value)
			encoded := text(attachment["data"])
			size := len(strings.TrimRight(encoded, "=")) * 6 / 8
			summaries = append(summaries, map[string]any{"name": text(attachment["name"]), "mime": text(attachment["mime"]), "data": "", "size": size})
		}
		result["attachments"] = summaries
	}
	return result
}
func summarizeObject(object DisplayObject) DisplayObject {
	object.Content = summaryContent(object.Content)
	return object
}

func pageHistory(all []DisplayObject, before string) (HistoryPage, error) {
	objects := append([]DisplayObject{}, all...)
	sort.Slice(objects, func(i, j int) bool {
		if objects[i].Created == objects[j].Created {
			return objects[i].ID < objects[j].ID
		}
		return objects[i].Created < objects[j].Created
	})
	ids := make([]string, 0, len(objects))
	end := len(objects)
	for _, object := range objects {
		ids = append(ids, object.ID)
	}
	if before != "" {
		if !core.ValidAddress(before) {
			return HistoryPage{}, errors.New("cursor de histórico inválido")
		}
		end = -1
		for index, object := range objects {
			if object.ID == before {
				end = index
				break
			}
		}
		if end < 0 {
			return HistoryPage{}, errors.New("cursor de histórico indisponível; actualize o histórico")
		}
	}
	start := end
	used := 2
	for start > 0 && end-start < HistoryPageObjects {
		encoded, err := core.Canonical(objects[start-1])
		if err != nil {
			return HistoryPage{}, err
		}
		extra := len(encoded)
		if start < end {
			extra++
		}
		if used+extra > HistoryPageBytes {
			if start == end {
				return HistoryPage{}, errors.New("resumo excede limite de histórico")
			}
			break
		}
		used += extra
		start--
	}
	page := HistoryPage{Objects: append([]DisplayObject{}, objects[start:end]...), History: History{HasMore: start > 0, Total: len(objects), AvailableIDs: ids}}
	if start > 0 && start < end {
		cursor := objects[start].ID
		page.History.NextBefore = &cursor
	}
	return page, nil
}

// Read and verify only the object and the semantic ACL references it needs.
// This is independent of pagination and returns the full object for explicit
// view/attachment requests. Every distinct dependency is decrypted at most once.
func (n *Node) authorizedObjectLocked(id string, touch bool) (*DisplayObject, error) {
	if n.identity == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	if !core.ValidAddress(id) {
		return nil, errors.New("endereço inválido")
	}
	loaded := make(map[string]*DisplayObject)
	groupAllowed := map[string]bool{}
	var load func(string, int) (*DisplayObject, error)
	load = func(current string, depth int) (*DisplayObject, error) {
		if old := loaded[current]; old != nil {
			return old, nil
		}
		if depth > 2 {
			return nil, errors.New("referências de autorização inválidas")
		}
		bundle, err := n.Store.GetWithTouch(current, touch && current == id)
		if err != nil {
			return nil, err
		}
		if contains(n.config.Blocked, bundle.Manifest.Author.ID) && (current == id || bundle.Manifest.Kind != "group") {
			return nil, errors.New("autor bloqueado")
		}
		object, err := n.displayLocked(bundle)
		if err != nil {
			return nil, err
		}
		loaded[current] = object
		if groupaccess.HasBinding(object.Content) {
			allowed, err := n.observeGroupLocked(current, n.protectedGroupContentLocked())
			if err != nil {
				return nil, err
			}
			if !allowed {
				return nil, errors.New("sem autorização de leitura do grupo")
			}
			groupAllowed[current] = true
			return object, nil
		}
		if related(object.Kind) {
			target := text(object.Content["target"])
			if !core.ValidAddress(target) {
				return nil, errors.New("alvo inválido")
			}
			original, err := load(target, depth+1)
			if err != nil {
				return nil, err
			}
			if related(original.Kind) {
				return nil, errors.New("alvo inválido")
			}
		} else if object.Kind == "message" && !strings.HasPrefix(text(object.Content["conversation"]), "dm:") {
			group, err := load(text(object.Content["conversation"]), depth+1)
			if err != nil {
				return nil, err
			}
			if group.Kind != "group" {
				return nil, errors.New("grupo inválido")
			}
		}
		return object, nil
	}
	target, err := load(id, 0)
	if err != nil {
		return nil, err
	}
	all := make([]DisplayObject, 0, len(loaded))
	for _, object := range loaded {
		all = append(all, *object)
	}
	if !groupAllowed[id] && !authorized(*target, all) {
		return nil, errors.New("sem autorização de leitura")
	}
	// A journalled deletion/edit survives loss of its original wire event.
	if mutation, ok := n.private.Mutations[id]; ok && mutation.Author == target.Author.ID {
		target.Deleted = mutation.Deleted
		target.EditedText = mutation.Text
	}
	return target, nil
}

func (n *Node) attachmentLocked(id string, index int64) (map[string]any, error) {
	if index < 0 || index >= 4 {
		return nil, errors.New("anexo indisponível")
	}
	display, err := n.materializedObjectLocked(id)
	if err != nil {
		return nil, err
	}
	if display.Deleted {
		return nil, errors.New("conteúdo eliminado pelo autor")
	}
	attachments, ok := display.Content["attachments"].([]any)
	if !ok || index < 0 || index >= int64(len(attachments)) {
		return nil, errors.New("anexo indisponível")
	}
	attachment, err := object(attachments[index])
	if err != nil {
		return nil, err
	}
	return map[string]any{"name": text(attachment["name"]), "mime": text(attachment["mime"]), "data": text(attachment["data"])}, nil
}

// On-demand reads need pending mutations for this target, not every cached
// attachment. This also handles valid events received while locked when both
// event and original remain available after unlock.
func (n *Node) materializedObjectLocked(id string) (*DisplayObject, error) {
	display, err := n.authorizedObjectLocked(id, true)
	if err != nil {
		return nil, err
	}
	if !related(display.Kind) {
		for _, manifest := range n.Store.List() {
			if (manifest.Kind != "edit" && manifest.Kind != "delete") || contains(n.config.Blocked, manifest.Author.ID) {
				continue
			}
			bundle, err := n.Store.GetWithTouch(manifest.ID, false)
			if err != nil {
				continue
			}
			event, err := n.displayLocked(bundle)
			if err != nil || text(event.Content["target"]) != id {
				continue
			}
			if groupaccess.HasBinding(event.Content) {
				if _, err = n.observeGroupLocked(event.ID, n.protectedGroupContentLocked()); err != nil {
					return nil, err
				}
				continue
			}
			if err = n.journalMutationLocked(event, manifest, display); err != nil {
				return nil, err
			}
		}
	}
	if mutation, ok := n.private.Mutations[id]; ok && mutation.Author == display.Author.ID {
		display.Deleted = mutation.Deleted
		display.EditedText = mutation.Text
	}
	return display, nil
}
