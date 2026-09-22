package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestContributionInboxWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_CONTRIBUTION_INBOX_VECTORS")
	if path == "" {
		t.Skip("parent-owned vector fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 16*1024*1024 {
		t.Fatal("bounded fixture required", err)
	}
	raw, err := core.DecodeJSON(data, 16*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	vectors, ok := raw.([]any)
	if !ok || len(vectors) > 128 {
		t.Fatal("bounded vector list")
	}
	results := []any{}
	for _, raw := range vectors {
		v, ok := raw.(map[string]any)
		if !ok {
			t.Fatal("vector object required")
		}
		owner := docTextValue(v["owner"])
		var result any
		var check error
		switch v["kind"] {
		case "initial":
			result, check = InitialContributionInbox(owner)
		case "validate":
			result, check = ValidateContributionInbox(v["record"], owner)
		case "checkCertificate":
			entry, ok := v["entry"].(map[string]any)
			if !ok {
				check = inboxError()
			} else {
				result, check = CheckInboxCertificate(entry, v["certificate"], owner)
			}
		case "observe", "verified", "expire":
			now, err := contributionClock(v["now"])
			if err != nil {
				check = err
				break
			}
			switch v["kind"] {
			case "observe":
				var record, entry map[string]any
				var outcome string
				record, entry, outcome, check = ObserveContributionInbox(v["record"], owner, v["certificate"], v["proof"], now)
				result = map[string]any{"record": record, "entry": entry, "outcome": outcome}
			case "verified":
				var record, entry map[string]any
				record, entry, check = VerifyContributionInboxSource(v["record"], owner, docTextValue(v["id"]), v["proof"], now)
				result = map[string]any{"record": record, "entry": entry}
			case "expire":
				result, check = ExpireContributionInbox(v["record"], owner, now)
			}
		default:
			t.Fatal("unknown vector action")
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
