package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestRejectionOperationsWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_REJECTION_OPERATIONS")
	if path == "" {
		t.Skip("parent-owned vectors")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 8*1024*1024 {
		t.Fatal("bounded fixture required", err)
	}
	raw, err := core.DecodeJSON(data, 8*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	vectors, ok := raw.([]any)
	if !ok || len(vectors) > 128 {
		t.Fatal("bounded vector list")
	}
	results := []any{}
	for _, raw := range vectors {
		v := raw.(map[string]any)
		owner, err := rejectionCard(v["owner"])
		if err != nil {
			t.Fatal(err)
		}
		entry := v["entry"].(map[string]any)
		now, err := contributionClock(v["now"])
		if err != nil {
			t.Fatal(err)
		}
		var result any
		var check error
		switch v["kind"] {
		case "prepare":
			result, check = PrepareRejectionOperation(owner, entry, v["proposal"], docTextValue(v["reason"]), now)
		case "validate":
			result, check = ValidateRejectionOperation(v["operation"], owner.ID, entry)
		case "signed":
			result, check = SignRejectionOperation(v["operation"], owner.ID, entry, v["certificate"], v["stage"], now)
		case "queued":
			result, check = QueueRejectionOperation(v["operation"], owner.ID, entry, v["bundle"], v["stage"], now)
		case "copied":
			b := v["bundle"].(map[string]any)
			result, check = CopyRejectionOperation(v["operation"], owner.ID, entry, docTextValue(b["id"]), docTextValue(b["hash"]), now)
		case "expire":
			result, check = ExpireRejectionOperation(v["operation"], owner.ID, entry, now)
		case "prepare-inbox":
			var r, e map[string]any
			revision, err := contributionClock(v["revision"])
			if err != nil {
				t.Fatal(err)
			}
			r, e, check = RejectContributionInbox(v["record"], owner, docTextValue(entry["id"]), revision, docTextValue(v["reason"]), v["proposal"], now)
			result = map[string]any{"record": r, "entry": e}
		case "update-inbox":
			var r, e map[string]any
			r, e, check = UpdateInboxRejection(v["record"], owner.ID, docTextValue(entry["id"]), v["operation"])
			result = map[string]any{"record": r, "entry": e}
		case "expire-inbox":
			result, check = ExpireContributionInbox(v["record"], owner.ID, now)
		case "validate-inbox":
			result, check = ValidateContributionInbox(v["record"], owner.ID)
		default:
			t.Fatal("unknown vector")
		}
		if check != nil {
			results = append(results, map[string]any{"name": v["name"], "accepted": false})
		} else {
			results = append(results, map[string]any{"name": v["name"], "accepted": true, "result": result})
		}
	}
	encoded, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".result.json", encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
