package sites

import (
	"encoding/json"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

// Node writes bounded vectors under its isolated project temp directory. The
// environment flag only enables this test helper, never the application runtime.
func TestDataTableVectorWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_DATA_VECTOR_INPUT")
	if path == "" {
		t.Skip("vector helper")
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	value, err := core.DecodeJSON(bytes, 4*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	cases, ok := value.([]any)
	if !ok || len(cases) > 256 {
		t.Fatal("invalid vector input")
	}
	results := []bool{}
	for _, value := range cases {
		results = append(results, ValidateDataTable(value) == nil)
	}
	output, err := json.Marshal(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".result", output, 0600); err != nil {
		t.Fatal(err)
	}
}
