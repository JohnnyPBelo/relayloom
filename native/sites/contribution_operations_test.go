package sites

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestContributionOperationsWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_CONTRIBUTION_OPERATIONS")
	if path == "" {
		t.Skip("parent-owned vector fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 16*1024*1024 {
		t.Fatal("bounded control required", err)
	}
	decoded, err := core.DecodeJSON(data, 16*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	vectors, ok := decoded.([]any)
	if !ok || len(vectors) > 128 {
		t.Fatal("bounded vector list")
	}
	results := []any{}
	for _, raw := range vectors {
		v := raw.(map[string]any)
		owner := docTextValue(v["owner"])
		var result any
		var check error
		context := ContributionFormContext{}
		if c, ok := v["context"].(map[string]any); ok {
			expiry, _ := contributionClock(c["snapshotExpires"])
			context = ContributionFormContext{c["target"], c["form"], c["table"], c["siteScope"], expiry}
		}
		now, _ := docNumber(v["now"])
		switch v["kind"] {
		case "initial":
			result, check = InitialContributionRecord(owner)
		case "request":
			var q map[string]any
			var fp string
			q, fp, check = ContributionCreationRequest(v["input"], owner)
			result = map[string]any{"request": q, "fingerprint": fp}
		case "validate":
			result, check = ValidateContributionRecord(v["record"], owner)
		case "prepare":
			var r, op map[string]any
			r, op, check = PrepareContributionIntent(v["record"], owner, v["input"], context, now)
			result = map[string]any{"record": r, "operation": op}
		case "sign":
			var r, op map[string]any
			r, op, check = SignContributionIntent(v["record"], owner, contributionHandle(v["handle"].(map[string]any)), v["input"], v["certificate"])
			result = map[string]any{"record": r, "operation": op}
		case "queue":
			var record, op map[string]any
			record, op, check = QueueContributionIntent(v["record"], owner, contributionHandle(v["handle"].(map[string]any)), v["descriptor"])
			result = map[string]any{"record": record, "operation": op}
		case "copied":
			var record, op map[string]any
			record, op, check = MarkContributionCopied(v["record"], owner, contributionHandle(v["handle"].(map[string]any)), docTextValue(v["bundleHash"]))
			result = map[string]any{"record": record, "operation": op}
		case "checkCertificate":
			result, check = CheckContributionCertificateBinding(v["record"], owner, contributionHandle(v["handle"].(map[string]any)), v["input"], v["certificate"])
		case "expire":
			result, check = ExpireContributionIntent(v["record"], owner, now)
		case "cancel":
			result, check = CancelContributionIntent(v["record"], owner, contributionHandle(v["handle"].(map[string]any)))
		case "lookup":
			var r, op map[string]any
			var retired bool
			seq, _ := creationNumber(v["sequence"])
			r, op, retired, check = LookupContributionOperation(v["record"], owner, seq, docTextValue(v["operationId"]))
			result = map[string]any{"record": r, "operation": op, "retired": retired}
		default:
			t.Fatal("unknown operation vector")
		}
		if check != nil {
			results = append(results, map[string]any{"name": v["name"], "accepted": false})
		} else {
			results = append(results, map[string]any{"name": v["name"], "accepted": true, "result": result})
		}
	}
	bytes, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".result.json", bytes, 0600); err != nil {
		t.Fatal(err)
	}
}
