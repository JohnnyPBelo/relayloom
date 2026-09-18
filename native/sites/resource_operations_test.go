package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestResourceOperationWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_RESOURCE_OPERATIONS_INPUT")
	if path == "" {
		t.Skip("parent-owned vector worker")
	}
	stat, err := os.Stat(path)
	if err != nil || stat.Size() > 16*1024*1024 {
		t.Fatal("bounded input required", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := core.DecodeJSON(data, 16*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	input, err := object(decoded, "owner", "cases")
	if err != nil {
		t.Fatal(err)
	}
	owner := docTextValue(input["owner"])
	cases, ok := input["cases"].([]any)
	if !ok || len(cases) > 256 {
		t.Fatal("bounded cases required")
	}
	results := []any{}
	for _, raw := range cases {
		c, ok := raw.(map[string]any)
		if !ok {
			t.Fatal("case required")
		}
		var value any
		var e error
		seq, _ := docNumber(c["sequence"])
		switch docTextValue(c["action"]) {
		case "initial":
			value, e = InitialResourceRecord(owner)
		case "request":
			var q map[string]any
			var fingerprint string
			q, fingerprint, e = ResourceCreationRequest(c["input"], owner)
			value = map[string]any{"request": q, "fingerprint": fingerprint}
		case "validate":
			value, e = ValidateResourceRecord(c["record"], owner)
		case "prepare":
			var r, op map[string]any
			r, op, e = PrepareResourceCreation(c["record"], owner, c["input"], c["staged"])
			value = map[string]any{"record": r, "operation": op}
		case "lookup":
			var r, op map[string]any
			var retired bool
			r, op, retired, e = LookupResourceOperation(c["record"], owner, seq, docTextValue(c["operationId"]))
			value = map[string]any{"record": r, "operation": op, "retired": retired}
		case "ready":
			value, e = ResourceCopyReady(c["record"], owner, seq, docTextValue(c["operationId"]), docTextValue(c["fingerprint"]), docTextValue(c["bundleHash"]))
		case "expire":
			now, nerr := docNumber(c["now"])
			if nerr != nil {
				e = nerr
			} else {
				value, e = ExpireResourceCreation(c["record"], owner, now)
			}
		default:
			t.Fatal("unknown case")
		}
		if e != nil {
			results = append(results, map[string]any{"error": true})
		} else {
			results = append(results, map[string]any{"value": value})
		}
	}
	output, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".result", output, 0600); err != nil {
		t.Fatal(err)
	}
}
