package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"regexp"
	"strconv"
	"strings"
	"unicode"
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
		if !contains(required, k) && !contains(optional, k) {
			return nil, false
		}
	}
	return m, true
}
func siteText(v any, max int) bool { s, ok := v.(string); return ok && jsLen(s) <= max }
func validSiteURL(v string) bool {
	parts := siteURLPattern.FindStringSubmatch(v)
	if parts == nil || jsLen(v) > 2000 || len(parts[1]) > 253 || strings.Contains(sitePercentEscape.ReplaceAllString(v, ""), "%") || strings.ContainsFunc(v, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' || r == '\\' || r < 32 || r == 127 }) {
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
func validateSite(v any, attachments any) error {
	fail := func() error { return errors.New("site declarativo inválido ou acima dos limites") }
	s, ok := siteShape(v, []string{"version", "title", "description", "home", "pages", "design"}, nil)
	if !ok {
		return fail()
	}
	version, e := number(s["version"])
	pages, ok := s["pages"].([]any)
	if e != nil || version != 1 || !ok || len(pages) < 1 || len(pages) > 12 || !siteText(s["title"], 120) || !siteText(s["description"], 500) || !siteIDPattern.MatchString(text(s["home"])) {
		return fail()
	}
	d, ok := siteShape(s["design"], []string{"font", "width", "radius", "accent"}, nil)
	if !ok || !contains([]string{"sans", "serif", "mono"}, text(d["font"])) || !contains([]string{"compact", "standard", "wide"}, text(d["width"])) || !contains([]string{"sharp", "soft", "round"}, text(d["radius"])) || !siteColorPattern.MatchString(text(d["accent"])) {
		return fail()
	}
	ids, slugs, nodes := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, value := range pages {
		p, ok := siteShape(value, []string{"id", "slug", "title", "blocks"}, nil)
		if !ok || !siteIDPattern.MatchString(text(p["id"])) || ids[text(p["id"])] || !siteSlugPattern.MatchString(text(p["slug"])) || slugs[text(p["slug"])] || !siteText(p["title"], 80) || trimmed(text(p["title"])) == "" {
			return fail()
		}
		ids[text(p["id"])] = true
		slugs[text(p["slug"])] = true
	}
	if !ids[text(s["home"])] {
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
		if !ok || !isString || !contains([]string{"image/png", "image/jpeg", "image/webp", "image/gif"}, text(a["mime"])) || len(data)%4 != 0 || !base64Pattern.MatchString(data) {
			return fail()
		}
		assetBytes += len(strings.TrimRight(data, "=")) * 6 / 8
	}
	if assetBytes > 2*1024*1024 {
		return fail()
	}
	var visit func(any, int) error
	visit = func(value any, depth int) error {
		list, ok := value.([]any)
		if !ok || (depth > 3 && len(list) > 0) || len(list) > 24 {
			return fail()
		}
		for _, value := range list {
			b, ok := siteShape(value, []string{"id", "type", "title", "body"}, []string{"url", "format", "children", "media", "style", "limit"})
			if !ok || !siteIDPattern.MatchString(text(b["id"])) || nodes[text(b["id"])] || !contains([]string{"hero", "text", "links", "callout", "heading", "quote", "button", "image", "gallery", "divider", "spacer", "columns", "posts"}, text(b["type"])) || !siteText(b["title"], 120) || !siteText(b["body"], 4000) {
				return fail()
			}
			nodes[text(b["id"])] = true
			if len(nodes) > 128 {
				return fail()
			}
			if f, ok := b["format"]; ok && !contains([]string{"plain", "markdown"}, text(f)) {
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
					if v, ok := st[key]; ok && !contains(allowed, text(v)) {
						return fail()
					}
				}
				if v, ok := st["columns"]; ok {
					n, e := number(v)
					if e != nil || n < 1 || n > 3 {
						return fail()
					}
				}
			}
			if children, ok := b["children"]; ok {
				if text(b["type"]) != "columns" {
					return fail()
				}
				if err := visit(children, depth+1); err != nil {
					return err
				}
			}
			if value, ok := b["media"]; ok {
				media, ok := value.([]any)
				max := 4
				if text(b["type"]) == "image" {
					max = 1
				}
				if !ok || !contains([]string{"image", "gallery"}, text(b["type"])) || len(media) > max {
					return fail()
				}
				for _, v := range media {
					m, ok := siteShape(v, []string{"attachment", "alt"}, nil)
					if !ok {
						return fail()
					}
					i, e := number(m["attachment"])
					if e != nil || i < 0 || i >= int64(len(assets)) || !siteText(m["alt"], 300) {
						return fail()
					}
					a, ok := assets[int(i)].(map[string]any)
					if !ok || !contains([]string{"image/png", "image/jpeg", "image/webp", "image/gif"}, text(a["mime"])) {
						return fail()
					}
				}
			}
			if value, ok := b["limit"]; ok {
				n, e := number(value)
				if text(b["type"]) != "posts" || e != nil || n < 1 || n > 12 {
					return fail()
				}
			}
		}
		return nil
	}
	for _, v := range pages {
		p, _ := v.(map[string]any)
		if e := visit(p["blocks"], 1); e != nil {
			return e
		}
	}
	encoded, err := core.Canonical(v)
	if err != nil || len(encoded) > 128*1024 {
		return fail()
	}
	return nil
}

func siteDraftSummary(value any) any {
	draft, ok := value.(map[string]any)
	if !ok || draft == nil {
		return nil
	}
	result := map[string]any{}
	for k, v := range draft {
		result[k] = v
	}
	if list, ok := draft["attachments"].([]any); ok {
		assets := []any{}
		for _, v := range list {
			a, ok := v.(map[string]any)
			if ok {
				assets = append(assets, map[string]any{"name": a["name"], "mime": a["mime"], "data": "", "size": len(strings.TrimRight(text(a["data"]), "=")) * 6 / 8})
			}
		}
		result["attachments"] = assets
	}
	return result
}
