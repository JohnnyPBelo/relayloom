package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestResourceDocumentVectors(t *testing.T) {
	path := os.Getenv("RELAYLOOM_RESOURCE_DOCUMENT_INPUT")
	if path == "" {
		t.Skip("parent-owned vector worker")
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > 4*1024*1024 {
		t.Fatal("bounded input required", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := core.DecodeJSON(data, 4*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	cases, ok := decoded.([]any)
	if !ok || len(cases) > 128 {
		t.Fatal("bounded case list required")
	}
	results := []any{}
	for _, raw := range cases {
		c := raw.(map[string]any)
		valid := ValidateDocument(c["site"], []any{}) == nil
		var resources any
		if valid {
			values, err := ResourceBlocks(c["site"].(map[string]any))
			if err != nil {
				t.Fatal(err)
			}
			resources = values
		}
		results = append(results, map[string]any{"accepted": valid, "resources": resources})
	}
	output, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".result", output, 0600); err != nil {
		t.Fatal(err)
	}
}
