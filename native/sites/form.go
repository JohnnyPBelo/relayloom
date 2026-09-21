package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

const SiteFormBytes = 12 * 1024

func formError() error { return errors.New("formulário do site inválido") }

// ParseSiteForm validates an owned declarative value, not submission/owner rights.
func ParseSiteForm(value any) (map[string]any, error) {
	form, err := object(value, "domain", "table", "fields", "contributors")
	if err != nil || form["domain"] != "relayloom/site-form/1" {
		return nil, formError()
	}
	target, err := object(form["table"], "pageId", "blockId")
	if err != nil || !siteIDPattern.MatchString(docTextValue(target["pageId"])) || !siteIDPattern.MatchString(docTextValue(target["blockId"])) {
		return nil, formError()
	}
	fields, ok := form["fields"].([]any)
	if !ok || len(fields) < 1 || len(fields) > SiteTableColumns {
		return nil, formError()
	}
	seen := map[string]bool{}
	for _, raw := range fields {
		f, err := object(raw, "column", "required")
		if err != nil {
			return nil, formError()
		}
		name := docTextValue(f["column"])
		_, boolean := f["required"].(bool)
		if !siteSlugPattern.MatchString(name) || seen[name] || !boolean {
			return nil, formError()
		}
		seen[name] = true
	}
	if form["contributors"] != "readers" {
		public, _, err := resourceScope(form["contributors"])
		if err != nil || public {
			return nil, formError()
		}
	}
	encoded, err := core.Canonical(form)
	if err != nil || len(encoded) > SiteFormBytes {
		return nil, formError()
	}
	return resourceClone(form)
}
func ParseContributionValues(value any) (map[string]any, error) {
	values, ok := value.(map[string]any)
	if !ok || len(values) < 1 || len(values) > SiteTableColumns {
		return nil, formError()
	}
	for key, value := range values {
		if !siteSlugPattern.MatchString(key) {
			return nil, formError()
		}
		switch v := value.(type) {
		case nil, bool:
		case string:
			if docLength(v) > 1000 {
				return nil, formError()
			}
		default:
			if !validDataCell(value, "number") {
				return nil, formError()
			}
		}
	}
	return resourceClone(values)
}
func BindSiteForm(formValue, tableValue any) (map[string]any, map[string]any, error) {
	form, err := ParseSiteForm(formValue)
	if err != nil {
		return nil, nil, err
	}
	if err = ValidateDataTable(tableValue); err != nil {
		return nil, nil, err
	}
	table, err := resourceClone(tableValue.(map[string]any))
	if err != nil {
		return nil, nil, err
	}
	columns, fields := table["columns"].([]any), form["fields"].([]any)
	if len(columns) != len(fields) {
		return nil, nil, formError()
	}
	for i, c := range columns {
		if c.(map[string]any)["id"] != fields[i].(map[string]any)["column"] {
			return nil, nil, formError()
		}
	}
	return form, table, nil
}
func MatchContributionValues(formValue, tableValue, valuesInput any) (map[string]any, error) {
	form, table, err := BindSiteForm(formValue, tableValue)
	if err != nil {
		return nil, err
	}
	values, err := ParseContributionValues(valuesInput)
	if err != nil {
		return nil, err
	}
	fields, columns := form["fields"].([]any), table["columns"].([]any)
	if len(values) != len(columns) {
		return nil, formError()
	}
	for i, c := range columns {
		column, field := c.(map[string]any), fields[i].(map[string]any)
		value, present := values[column["id"].(string)]
		if !present || !validDataCell(value, column["type"].(string)) {
			return nil, formError()
		}
		if field["required"].(bool) {
			if value == nil {
				return nil, formError()
			}
			if text, ok := value.(string); ok && docTrim(text) == "" {
				return nil, formError()
			}
		}
	}
	return values, nil
}
