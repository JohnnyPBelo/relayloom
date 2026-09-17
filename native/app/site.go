package app

import (
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"strings"
)

func validateSite(v any, attachments any) error { return sites.ValidateDocument(v, attachments) }

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
