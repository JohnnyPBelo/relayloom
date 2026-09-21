package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

type ResolvedContributionForm struct {
	Context     ContributionFormContext
	Owner       core.PublicIdentity
	Title       string
	Description string
}

func ParseContributionFormLookup(value any) (map[string]any, error) {
	q, err := object(value, "action", "snapshotId", "pageId", "formId")
	if err != nil || q["action"] != "form" || !core.ValidAddress(docTextValue(q["snapshotId"])) || !siteIDPattern.MatchString(docTextValue(q["pageId"])) || !siteIDPattern.MatchString(docTextValue(q["formId"])) {
		return nil, errors.New("pedido de formulário inválido")
	}
	return map[string]any{"action": "form", "snapshotId": q["snapshotId"], "pageId": q["pageId"], "formId": q["formId"]}, nil
}

// ResolveContributionForm receives only authenticated/decrypted envelope data
// from the local runtime. Caller enforces block/withdrawal and session policy.
func ResolveContributionForm(input any, bundle core.Bundle, plaintext any, visitor string, now int64) (*ResolvedContributionForm, error) {
	lookup, err := ParseContributionFormLookup(input)
	if err != nil {
		return nil, err
	}
	m := bundle.Manifest
	if m.ID != lookup["snapshotId"] || m.Kind != "site" {
		return nil, errors.New("snapshot do formulário diferente do pedido")
	}
	parsed, err := VerifyContent(plaintext, m.Author, "")
	if err != nil {
		return nil, err
	}
	document := parsed.Content["site"].(map[string]any)
	var find func([]any, string) map[string]any
	find = func(nodes []any, id string) map[string]any {
		for _, raw := range nodes {
			node := raw.(map[string]any)
			if node["id"] == id {
				return node
			}
			if children, ok := node["children"].([]any); ok {
				if found := find(children, id); found != nil {
					return found
				}
			}
		}
		return nil
	}
	locate := func(pageID, id string) map[string]any {
		for _, raw := range document["pages"].([]any) {
			page := raw.(map[string]any)
			if page["id"] == pageID {
				return find(page["blocks"].([]any), id)
			}
		}
		return nil
	}
	node := locate(docTextValue(lookup["pageId"]), docTextValue(lookup["formId"]))
	if node == nil || node["type"] != "form" {
		return nil, errors.New("formulário inexistente neste snapshot")
	}
	form, err := ParseSiteForm(node["form"])
	if err != nil {
		return nil, err
	}
	target := form["table"].(map[string]any)
	tableNode := locate(target["pageId"].(string), target["blockId"].(string))
	if tableNode == nil || tableNode["type"] != "table" {
		return nil, formError()
	}
	form, table, err := BindSiteForm(form, tableNode["data"])
	if err != nil {
		return nil, err
	}
	address, _ := Address(parsed.Revision.Body.Owner.ID, parsed.Revision.Body.Name)
	context := ContributionFormContext{Target: map[string]any{"site": address, "snapshotId": m.ID, "revisionId": parsed.Revision.ID, "pageId": lookup["pageId"], "formId": lookup["formId"]}, Form: form, Table: table, SiteScope: readersOf(bundle), SnapshotExpires: m.Expires}
	if err = AuthorizeContributionContext(context, visitor, now); err != nil {
		return nil, err
	}
	return &ResolvedContributionForm{context, m.Author, docTextValue(node["title"]), docTextValue(node["body"])}, nil
}
func DescribeContributionForm(found *ResolvedContributionForm) (map[string]any, error) {
	context := found.Context
	form, table, err := BindSiteForm(context.Form, context.Table)
	if err != nil {
		return nil, err
	}
	fields := []any{}
	for i, raw := range table["columns"].([]any) {
		c := raw.(map[string]any)
		f := form["fields"].([]any)[i].(map[string]any)
		fields = append(fields, map[string]any{"id": c["id"], "label": c["label"], "type": c["type"], "required": f["required"]})
	}
	hash, err := ContributionSchemaHash(form, table)
	if err != nil {
		return nil, err
	}
	return resourceClone(map[string]any{"target": context.Target, "owner": found.Owner, "title": found.Title, "description": found.Description, "fields": fields, "contributors": form["contributors"], "siteScope": context.SiteScope, "schemaHash": hash, "expires": context.SnapshotExpires})
}
