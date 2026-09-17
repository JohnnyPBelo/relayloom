package sites

import (
	"strings"
	"testing"
)

func TestEditingContextOwnerAndPendingShape(t *testing.T) {
	owner := strings.Repeat("a", 64)
	valid := map[string]any{"domain": "relayloom/site-editing/1", "address": "relayloom:site:" + owner + "/profile", "base": strings.Repeat("b", 64), "sequence": int64(2), "recipients": "public", "ttlMs": int64(30 * 86400000), "pending": map[string]any{"operationId": "10000000-0000-0000-0000-000000000000", "requestHash": strings.Repeat("c", 64), "confirmedHeads": []any{strings.Repeat("1", 64), strings.Repeat("2", 64)}}}
	if e := ValidateEditingContext(valid, owner); e != nil {
		t.Fatal(e)
	}
	if e := ValidateEditingContext(valid, strings.Repeat("d", 64)); e == nil {
		t.Fatal("another owner accepted")
	}
	cases := []struct {
		key   string
		value any
	}{{"domain", "wrong"}, {"sequence", 0}, {"sequence", 1.1}, {"sequence", float64(MaxSequence) + 1}, {"address", valid["address"].(string) + "/extra"}, {"base", strings.Repeat("B", 64)}, {"pending", nil}, {"pending", map[string]any{"operationId": "reuse", "requestHash": strings.Repeat("c", 64)}}, {"pending", map[string]any{"operationId": "10000000-0000-0000-0000-000000000000", "requestHash": strings.Repeat("c", 64), "confirmedHeads": []any{owner, owner}}}}
	for i, c := range cases {
		next := map[string]any{}
		for k, v := range valid {
			next[k] = v
		}
		next[c.key] = c.value
		if e := ValidateEditingContext(next, owner); e == nil {
			t.Fatalf("accepted invalid case %d", i)
		}
	}
	if e := ValidateEditingContext(valid, owner); e != nil {
		t.Fatal("validation mutated valid input", e)
	}
}
