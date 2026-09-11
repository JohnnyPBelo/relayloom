package app

import (
	"errors"
	"regexp"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

type Collection struct {
	ID        string   `json:"id"`
	OwnerID   string   `json:"ownerId"`
	Title     string   `json:"title"`
	ObjectIDs []string `json:"objectIds"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
}

var collectionPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var titleControls = regexp.MustCompile(`[\x00-\x1f\x7f-\x{009f}]`)

func collectionTitle(value any) (string, error) {
	s, ok := value.(string)
	if !ok || titleControls.MatchString(s) {
		return "", errors.New("nome de colecção inválido")
	}
	s = trimmed(norm.NFC.String(s))
	if s == "" || jsLen(s) > 64 {
		return "", errors.New("use um nome de colecção com 1 a 64 caracteres")
	}
	return s, nil
}
func folded(s string) string { return cases.Lower(language.Und).String(s) }
func validateCollections(value any, owner string) ([]Collection, error) {
	input, ok := value.([]any)
	if !ok || len(input) > 32 || !core.ValidAddress(owner) {
		return nil, errors.New("colecções inválidas")
	}
	result := make([]Collection, 0, len(input))
	ids, titles := map[string]bool{}, map[string]bool{}
	total := 0
	for _, v := range input {
		m, err := object(v)
		if err != nil || len(m) != 6 {
			return nil, errors.New("metadados de colecção inválidos")
		}
		id := text(m["id"])
		if !collectionPattern.MatchString(id) || text(m["ownerId"]) != owner {
			return nil, errors.New("colecção de outra identidade ou inválida")
		}
		title, err := collectionTitle(m["title"])
		if err != nil {
			return nil, err
		}
		created, err := number(m["createdAt"])
		if err != nil || created < 0 {
			return nil, errors.New("data de colecção inválida")
		}
		updated, err := number(m["updatedAt"])
		if err != nil || updated < created {
			return nil, errors.New("data de colecção inválida")
		}
		objects, err := stringsList(m["objectIds"], 256, true)
		if err != nil {
			return nil, err
		}
		seen := map[string]bool{}
		for _, id := range objects {
			if seen[id] {
				return nil, errors.New("referência repetida")
			}
			seen[id] = true
		}
		total += len(objects)
		if total > 2048 || ids[id] || titles[folded(title)] {
			return nil, errors.New("limite ou duplicação de colecções")
		}
		ids[id] = true
		titles[folded(title)] = true
		result = append(result, Collection{id, owner, title, objects, created, updated})
	}
	return result, nil
}
func (n *Node) collectionLocked(command map[string]any) ([]Collection, error) {
	if n.identity == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	action, id := text(command["action"]), text(command["id"])
	if !collectionPattern.MatchString(id) {
		return nil, errors.New("identificador de colecção inválido")
	}
	fields := 2
	if action == "create" || action == "rename" || action == "add" || action == "remove" {
		fields = 3
	}
	if len(command) != fields {
		return nil, errors.New("campos de colecção inválidos")
	}
	// Materialize authorized events before cloning private state; otherwise an
	// add operation could overwrite a newly recorded deletion with a stale copy.
	if action == "add" {
		objects, err := n.objectsLocked()
		if err != nil {
			return nil, err
		}
		if findObject(objects, text(command["objectId"])) == nil {
			return nil, errors.New("só pode guardar conteúdo disponível e autorizado")
		}
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, err
	}
	collections := next.Collections
	now := time.Now().UnixMilli()
	index := -1
	for i, c := range collections {
		if c.ID == id {
			index = i
		}
	}
	if action == "create" {
		title, err := collectionTitle(command["title"])
		if err != nil {
			return nil, err
		}
		if len(collections) >= 32 || index >= 0 {
			return nil, errors.New("limite ou duplicação de colecções")
		}
		for _, c := range collections {
			if folded(c.Title) == folded(title) {
				return nil, errors.New("já existe uma colecção com esse nome")
			}
		}
		collections = append(collections, Collection{id, n.identity.Public.ID, title, []string{}, now, now})
	} else {
		if index < 0 {
			return nil, errors.New("colecção indisponível nesta identidade")
		}
		switch action {
		case "delete":
			collections = append(collections[:index], collections[index+1:]...)
		case "rename":
			title, err := collectionTitle(command["title"])
			if err != nil {
				return nil, err
			}
			for i, c := range collections {
				if i != index && folded(c.Title) == folded(title) {
					return nil, errors.New("já existe uma colecção com esse nome")
				}
			}
			collections[index].Title = title
			collections[index].UpdatedAt = max(now, collections[index].UpdatedAt)
		case "add", "remove":
			objectID := text(command["objectId"])
			if !core.ValidAddress(objectID) {
				return nil, errors.New("endereço inválido")
			}
			items := collections[index].ObjectIDs
			if action == "add" {
				if !contains(items, objectID) {
					total := 0
					for _, c := range collections {
						total += len(c.ObjectIDs)
					}
					if len(items) >= 256 || total >= 2048 {
						return nil, errors.New("limite de referências em colecções")
					}
					collections[index].ObjectIDs = append(items, objectID)
					collections[index].UpdatedAt = max(now, collections[index].UpdatedAt)
				}
			} else {
				filtered := make([]string, 0, len(items))
				for _, v := range items {
					if v != objectID {
						filtered = append(filtered, v)
					}
				}
				collections[index].ObjectIDs = filtered
				collections[index].UpdatedAt = max(now, collections[index].UpdatedAt)
			}
		default:
			return nil, errors.New("acção de colecção desconhecida")
		}
	}
	next.Collections = collections
	if err = n.persistPrivateLocked(next); err != nil {
		return nil, err
	}
	return collections, nil
}
