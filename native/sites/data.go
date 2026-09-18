package sites

import (
	"encoding/json"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"math"
	"regexp"
	"time"
)

const SiteTableBytes = 64 * 1024
const SiteTableColumns = 12
const SiteTableRows = 256

var dataDate = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)

// ValidateDataTable accepts the same authored data as the portable renderer.
// This validator does not evaluate a query or give its reader signing authority.
func ValidateDataTable(value any) error {
	invalid := func() error { return errors.New("dados declarativos do site inválidos") }
	table, err := object(value, "domain", "columns", "rows")
	if err != nil {
		return invalid()
	}
	if table["domain"] != "relayloom/site-table/1" {
		return invalid()
	}
	columns, ok := table["columns"].([]any)
	if !ok || len(columns) < 1 || len(columns) > SiteTableColumns {
		return invalid()
	}
	rows, ok := table["rows"].([]any)
	if !ok || len(rows) > SiteTableRows {
		return invalid()
	}
	types := map[string]string{}
	keys := []string{}
	for _, raw := range columns {
		column, err := object(raw, "id", "label", "type")
		if err != nil {
			return invalid()
		}
		id, kind := docTextValue(column["id"]), docTextValue(column["type"])
		label, ok := column["label"].(string)
		if !siteSlugPattern.MatchString(id) || types[id] != "" || !ok || docLength(label) > 80 || docTrim(label) == "" || !docContains([]string{"text", "number", "boolean", "date", "link"}, kind) {
			return invalid()
		}
		types[id] = kind
		keys = append(keys, id)
	}
	ids := map[string]bool{}
	for _, raw := range rows {
		row, err := object(raw, "id", "values")
		if err != nil {
			return invalid()
		}
		id := docTextValue(row["id"])
		if !siteSlugPattern.MatchString(id) || ids[id] {
			return invalid()
		}
		ids[id] = true
		cells, err := object(row["values"], keys...)
		if err != nil {
			return invalid()
		}
		for _, key := range keys {
			if !validDataCell(cells[key], types[key]) {
				return invalid()
			}
		}
	}
	encoded, err := core.Canonical(value)
	if err != nil || len(encoded) > SiteTableBytes {
		return invalid()
	}
	return nil
}
func validDataCell(value any, kind string) bool {
	if value == nil {
		return true
	}
	switch kind {
	case "text":
		text, ok := value.(string)
		return ok && docLength(text) <= 1000
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "number":
		var number float64
		switch v := value.(type) {
		case json.Number:
			var err error
			number, err = v.Float64()
			if err != nil {
				return false
			}
		case float64:
			number = v
		case int:
			number = float64(v)
		case int64:
			number = float64(v)
		default:
			return false
		}
		return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Abs(number) <= 9007199254740991
	case "date":
		text, ok := value.(string)
		if !ok || !dataDate.MatchString(text) {
			return false
		}
		date, err := time.Parse("2006-01-02", text)
		return err == nil && date.Format("2006-01-02") == text
	case "link":
		text, ok := value.(string)
		return ok && validSiteURL(text)
	}
	return false
}
