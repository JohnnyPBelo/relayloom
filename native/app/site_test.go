package app

import (
	"encoding/base64"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestSiteDocumentSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/site-documents.json")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := core.DecodeJSON(data, 4*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range decoded.([]any) {
		c := v.(map[string]any)
		t.Run(c["name"].(string), func(t *testing.T) {
			err := validateContent(Content{"type": "site", "blocks": []any{}, "theme": "sand", "site": c["site"], "attachments": c["attachments"]})
			if (err == nil) != c["valid"].(bool) {
				t.Fatalf("valid=%v error=%v", c["valid"], err)
			}
		})
	}
}

func TestSiteDocumentImageBoundary(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/site-documents.json")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := core.DecodeJSON(data, 4*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	site := decoded.([]any)[0].(map[string]any)["site"]
	for _, size := range []int{2 * 1024 * 1024, 2*1024*1024 + 1} {
		assets := []any{map[string]any{"mime": "image/png", "data": base64.StdEncoding.EncodeToString(make([]byte, size))}}
		err := validateSite(site, assets)
		if (err == nil) != (size == 2*1024*1024) {
			t.Fatalf("size=%d error=%v", size, err)
		}
	}
}
