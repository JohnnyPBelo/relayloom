package sites

import (
	"encoding/json"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

var siteIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
var siteSlugPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
var siteColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var siteURLPattern = regexp.MustCompile(`^https://([A-Za-z0-9.-]+)(:([0-9]{1,5}))?([/?#].*)?$`)
var siteHostLabel = regexp.MustCompile(`(?i)^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
var siteNumericHost = regexp.MustCompile(`(?i)^([0-9]+|0x[0-9a-f]*)$`)
var siteIPv4Part = regexp.MustCompile(`^(0|[1-9][0-9]{0,2})$`)
var sitePercentEscape = regexp.MustCompile(`(?i)%[0-9a-f]{2}`)

func siteShape(v any, required, optional []string) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, false
	}
	for _, k := range required {
		if _, ok := m[k]; !ok {
			return nil, false
		}
	}
	for k := range m {
		if !docContains(required, k) && !docContains(optional, k) {
			return nil, false
		}
	}
	return m, true
}
func siteText(v any, max int) bool { s, ok := v.(string); return ok && docLength(s) <= max }
func validSiteURL(v string) bool {
	parts := siteURLPattern.FindStringSubmatch(v)
	if parts == nil || docLength(v) > 2000 || len(parts[1]) > 253 || strings.Contains(sitePercentEscape.ReplaceAllString(v, ""), "%") || strings.ContainsFunc(v, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' || r == '\\' || r < 32 || r == 127 }) {
		return false
	}
	if parts[3] != "" {
		p, e := strconv.Atoi(parts[3])
		if e != nil || p > 65535 {
			return false
		}
	}
	labels := strings.Split(parts[1], ".")
	for _, label := range labels {
		if !siteHostLabel.MatchString(label) {
			return false
		}
	}
	if siteNumericHost.MatchString(labels[len(labels)-1]) {
		if len(labels) != 4 {
			return false
		}
		for _, label := range labels {
			n, err := strconv.Atoi(label)
			if err != nil || !siteIPv4Part.MatchString(label) || n > 255 {
				return false
			}
		}
	}
	return true
}

// An authored declarative site is bounded before canonicalisation or rendering.
// It carries no executable source, arbitrary CSS, database commands or remote media URLs.
func ValidateDocument(v any, attachments any) error {
	fail := func() error { return errors.New("site declarativo inválido ou acima dos limites") }
	s, ok := siteShape(v, []string{"version", "title", "description", "home", "pages", "design"}, nil)
	if !ok {
		return fail()
	}
	version, e := docNumber(s["version"])
	pages, ok := s["pages"].([]any)
	if e != nil || (version != 1 && version != 2 && version != 3 && version != 4) || !ok || len(pages) < 1 || len(pages) > 12 || !siteText(s["title"], 120) || !siteText(s["description"], 500) || !siteIDPattern.MatchString(docTextValue(s["home"])) {
		return fail()
	}
	d, ok := siteShape(s["design"], []string{"font", "width", "radius", "accent"}, nil)
	if !ok || !docContains([]string{"sans", "serif", "mono"}, docTextValue(d["font"])) || !docContains([]string{"compact", "standard", "wide"}, docTextValue(d["width"])) || !docContains([]string{"sharp", "soft", "round"}, docTextValue(d["radius"])) || !siteColorPattern.MatchString(docTextValue(d["accent"])) {
		return fail()
	}
	ids, slugs, nodes := map[string]bool{}, map[string]bool{}, map[string]bool{}
	resources := map[string]string{}
	locations := map[string]string{}
	allNodes := map[string]map[string]any{}
	forms := []map[string]any{}
	for _, value := range pages {
		p, ok := siteShape(value, []string{"id", "slug", "title", "blocks"}, nil)
		if !ok || !siteIDPattern.MatchString(docTextValue(p["id"])) || ids[docTextValue(p["id"])] || !siteSlugPattern.MatchString(docTextValue(p["slug"])) || slugs[docTextValue(p["slug"])] || !siteText(p["title"], 80) || docTrim(docTextValue(p["title"])) == "" {
			return fail()
		}
		ids[docTextValue(p["id"])] = true
		slugs[docTextValue(p["slug"])] = true
	}
	if !ids[docTextValue(s["home"])] {
		return fail()
	}
	assets, _ := attachments.([]any)
	if len(assets) > 4 {
		return fail()
	}
	assetBytes := 0
	for _, v := range assets {
		a, ok := v.(map[string]any)
		data, isString := a["data"].(string)
		if !ok || !isString || !docContains([]string{"image/png", "image/jpeg", "image/webp", "image/gif"}, docTextValue(a["mime"])) || len(data)%4 != 0 || !siteBase64Syntax(data) {
			return fail()
		}
		assetBytes += len(strings.TrimRight(data, "=")) * 6 / 8
	}
	if assetBytes > 2*1024*1024 {
		return fail()
	}
	var visit func(any, int, string) error
	visit = func(value any, depth int, pageID string) error {
		list, ok := value.([]any)
		if !ok || (depth > 3 && len(list) > 0) || len(list) > 24 {
			return fail()
		}
		for _, value := range list {
			b, ok := siteShape(value, []string{"id", "type", "title", "body"}, []string{"url", "format", "children", "media", "style", "limit", "data", "reference", "form"})
			if !ok || !siteIDPattern.MatchString(docTextValue(b["id"])) || nodes[docTextValue(b["id"])] || !docContains([]string{"hero", "text", "links", "callout", "heading", "quote", "button", "image", "gallery", "divider", "spacer", "columns", "posts", "table", "resource", "form"}, docTextValue(b["type"])) || !siteText(b["title"], 120) || !siteText(b["body"], 4000) {
				return fail()
			}
			data, hasData := b["data"]
			if docTextValue(b["type"]) == "table" {
				if version < 2 || !hasData || ValidateDataTable(data) != nil {
					return fail()
				}
			} else if hasData {
				return fail()
			}
			refValue, hasRef := b["reference"]
			if docTextValue(b["type"]) == "resource" {
				if _, hasURL := b["url"]; version < 3 || !hasRef || hasURL {
					return fail()
				}
				ref, err := ParseResourceReference(refValue)
				if err != nil {
					return err
				}
				encoded, err := core.Canonical(ref)
				if err != nil {
					return err
				}
				id := docTextValue(ref["bundleId"])
				if previous, exists := resources[id]; exists && previous != string(encoded) {
					return fail()
				}
				resources[id] = string(encoded)
				if len(resources) > 32 {
					return fail()
				}
			} else if hasRef {
				return fail()
			}
			formValue, hasForm := b["form"]
			if docTextValue(b["type"]) == "form" {
				if _, hasURL := b["url"]; version != 4 || !hasForm || hasURL {
					return fail()
				}
				form, err := ParseSiteForm(formValue)
				if err != nil {
					return err
				}
				forms = append(forms, form)
			} else if hasForm {
				return fail()
			}
			locations[docTextValue(b["id"])] = pageID
			allNodes[docTextValue(b["id"])] = b
			nodes[docTextValue(b["id"])] = true
			if len(nodes) > 128 {
				return fail()
			}
			if f, ok := b["format"]; ok && !docContains([]string{"plain", "markdown"}, docTextValue(f)) {
				return fail()
			}
			if value, ok := b["url"]; ok {
				u, isString := value.(string)
				if !isString {
					return fail()
				}
				if strings.HasPrefix(u, "page:") {
					if !ids[strings.TrimPrefix(u, "page:")] {
						return fail()
					}
				} else if u != "" && !validSiteURL(u) {
					return fail()
				}
			}
			if value, ok := b["style"]; ok {
				st, ok := siteShape(value, nil, []string{"align", "tone", "columns", "space"})
				if !ok {
					return fail()
				}
				for key, allowed := range map[string][]string{"align": {"left", "center", "right"}, "tone": {"surface", "soft", "accent"}, "space": {"compact", "normal", "large"}} {
					if v, ok := st[key]; ok && !docContains(allowed, docTextValue(v)) {
						return fail()
					}
				}
				if v, ok := st["columns"]; ok {
					n, e := docNumber(v)
					if e != nil || n < 1 || n > 3 {
						return fail()
					}
				}
			}
			if children, ok := b["children"]; ok {
				if docTextValue(b["type"]) != "columns" {
					return fail()
				}
				if err := visit(children, depth+1, pageID); err != nil {
					return err
				}
			}
			if value, ok := b["media"]; ok {
				media, ok := value.([]any)
				max := 4
				if docTextValue(b["type"]) == "image" {
					max = 1
				}
				if !ok || !docContains([]string{"image", "gallery"}, docTextValue(b["type"])) || len(media) > max {
					return fail()
				}
				for _, v := range media {
					m, ok := siteShape(v, []string{"attachment", "alt"}, nil)
					if !ok {
						return fail()
					}
					i, e := docNumber(m["attachment"])
					if e != nil || i < 0 || i >= int64(len(assets)) || !siteText(m["alt"], 300) {
						return fail()
					}
					a, ok := assets[int(i)].(map[string]any)
					if !ok || !docContains([]string{"image/png", "image/jpeg", "image/webp", "image/gif"}, docTextValue(a["mime"])) {
						return fail()
					}
				}
			}
			if value, ok := b["limit"]; ok {
				n, e := docNumber(value)
				if docTextValue(b["type"]) != "posts" || e != nil || n < 1 || n > 12 {
					return fail()
				}
			}
		}
		return nil
	}
	for _, v := range pages {
		p, _ := v.(map[string]any)
		if e := visit(p["blocks"], 1, docTextValue(p["id"])); e != nil {
			return e
		}
	}
	for _, form := range forms {
		target := form["table"].(map[string]any)
		id := target["blockId"].(string)
		destination := allNodes[id]
		if destination == nil || locations[id] != target["pageId"] || destination["type"] != "table" {
			return fail()
		}
		if _, _, err := BindSiteForm(form, destination["data"]); err != nil {
			return err
		}
	}
	encoded, err := core.Canonical(v)
	if err != nil || len(encoded) > 128*1024 {
		return fail()
	}
	return nil
}

// Equivalent to the original base64 alphabet/padding regexp, without the
// regexp interpreter cost on multi-megabyte image strings. Length and
// decoded byte bounds remain separate schema checks.
func siteBase64Syntax(data string) bool {
	padding := 0
	for i := 0; i < len(data); i++ {
		c := data[i]
		if c == '=' {
			padding++
			if padding > 2 {
				return false
			}
			continue
		}
		if padding != 0 || !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/') {
			return false
		}
	}
	return true
}

func docTextValue(v any) string { s, _ := v.(string); return s }
func docNumber(v any) (int64, error) {
	var f float64
	switch n := v.(type) {
	case json.Number:
		var e error
		f, e = n.Float64()
		if e != nil {
			return 0, e
		}
	case float64:
		f = n
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	default:
		return 0, errors.New("inteiro inválido")
	}
	if math.IsNaN(f) || math.IsInf(f, 0) || math.Trunc(f) != f || math.Abs(f) > 9007199254740991 {
		return 0, errors.New("inteiro inválido")
	}
	return int64(f), nil
}
func docLength(s string) int {
	count := 0
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && n == 1 && i+2 < len(s) && s[i] == 0xed && s[i+1] >= 0xa0 && s[i+1] <= 0xbf && s[i+2]&0xc0 == 0x80 {
			i += 3
			count++
			continue
		}
		i += n
		if r > 0xffff {
			count += 2
		} else {
			count++
		}
	}
	return count
}
func docTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return r == 9 || r == 10 || r == 11 || r == 12 || r == 13 || r == 32 || r == 0xa0 || r == 0x1680 || (r >= 0x2000 && r <= 0x200a) || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
	})
}
func docContains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// ResourceBlocks requires an already validated document from an authenticated
// snapshot. It does not authenticate resource bytes or grant reading rights.
type ResourceBlock struct {
	PageID    string         `json:"pageId"`
	BlockID   string         `json:"blockId"`
	Reference map[string]any `json:"reference"`
}

func ResourceBlocks(site map[string]any) ([]ResourceBlock, error) {
	result := []ResourceBlock{}
	var visit func([]any, string) error
	visit = func(nodes []any, pageID string) error {
		for _, value := range nodes {
			node := value.(map[string]any)
			if node["type"] == "resource" {
				ref, err := ParseResourceReference(node["reference"])
				if err != nil {
					return err
				}
				result = append(result, ResourceBlock{pageID, docTextValue(node["id"]), ref})
			}
			if children, ok := node["children"].([]any); ok {
				if err := visit(children, pageID); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, raw := range site["pages"].([]any) {
		if err := visit(raw.(map[string]any)["blocks"].([]any), docTextValue(raw.(map[string]any)["id"])); err != nil {
			return nil, err
		}
	}
	return result, nil
}
