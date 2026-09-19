package sites

import (
	"strings"
	"testing"
)

func TestResourceScopeRuntimeAndWireShapes(t *testing.T) {
	a, b := strings.Repeat("a", 64), strings.Repeat("b", 64)
	for _, site := range []any{[]string{a}, []any{a}} {
		for _, resource := range []any{[]string{a, b}, []any{a, b}} {
			allowed, err := ResourceScopeCoversSite(site, resource)
			if err != nil || !allowed {
				t.Fatal("equivalent runtime/wire audiences differ", err)
			}
		}
		if allowed, err := ResourceScopeCoversSite(site, "public"); err != nil || !allowed {
			t.Fatal("public resource control", err)
		}
		if allowed, err := ResourceScopeCoversSite("public", site); err != nil || allowed {
			t.Fatal("private resource widened to public", err)
		}
	}
	for _, bad := range []any{[]string{}, []string{a, a}, []string{b, a}, []string{"bad"}, make([]string, 65), []any{a, 42}} {
		if _, err := ResourceScopeCoversSite(bad, "public"); err == nil {
			t.Fatal("invalid audience accepted")
		}
	}
	if allowed, err := ResourceScopeCoversSite([]string{a, b}, []string{a}); err != nil || allowed {
		t.Fatal("missing reader accepted", err)
	}
}
