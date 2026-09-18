package sites

import (
	"os"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

// Test-only process oracle. Wire fixtures are decoded with the same strict
// parser as native content; successful references are emitted canonically.
func TestResourceVectorWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_SITE_RESOURCE_VECTORS")
	if path == "" {
		t.Skip("external vector worker only")
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > 16*1024*1024 {
		t.Fatal("invalid bounded vector input", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	value, err := core.DecodeJSON(data, 16*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	corpus, err := object(value, "resources", "scopes", "envelope")
	if err != nil {
		t.Fatal(err)
	}
	resources, ok := corpus["resources"].([]any)
	if !ok || len(resources) > 128 {
		t.Fatal("bounded resource vectors required")
	}
	results := make([]any, 0, len(resources))
	for _, resource := range resources {
		reference, err := DescribeResource(resource, corpus["envelope"])
		if err != nil {
			results = append(results, nil)
			continue
		}
		if _, err = MatchResource(reference, resource, corpus["envelope"]); err != nil {
			t.Fatal(err)
		}
		results = append(results, reference)
	}
	scopes, ok := corpus["scopes"].([]any)
	if !ok || len(scopes) > 128 {
		t.Fatal("bounded scope vectors required")
	}
	permissions := make([]any, 0, len(scopes))
	for _, raw := range scopes {
		pair, ok := raw.([]any)
		if !ok || len(pair) != 2 {
			t.Fatal("scope pair required")
		}
		allowed, err := ResourceScopeCoversSite(pair[0], pair[1])
		if err != nil {
			permissions = append(permissions, nil)
		} else {
			permissions = append(permissions, allowed)
		}
	}
	encoded, err := core.Canonical(map[string]any{"resources": results, "scopes": permissions})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".result", encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
