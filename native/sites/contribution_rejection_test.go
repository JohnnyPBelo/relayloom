package sites

import (
	"encoding/json"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestContributionRejectionWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_CONTRIBUTION_REJECTION_VECTORS")
	if path == "" {
		t.Skip("parent-owned rejection conformance fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 4*1024*1024 {
		t.Fatal("bounded fixture required", err)
	}
	raw, err := core.DecodeJSON(data, 4*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	vectors, ok := raw.([]any)
	if !ok || len(vectors) > 128 {
		t.Fatal("bounded vector list required")
	}
	results := []any{}
	for _, raw := range vectors {
		v := raw.(map[string]any)
		var result any
		var check error
		switch v["kind"] {
		case "create":
			data, err := core.Canonical(v["identity"])
			if err != nil {
				t.Fatal(err)
			}
			var identity core.Identity
			if err = json.Unmarshal(data, &identity); err != nil {
				t.Fatal(err)
			}
			result, check = CreateContributionRejection(identity, v["request"])
		case "request":
			data, err := core.Canonical(v["identity"])
			if err != nil {
				t.Fatal(err)
			}
			var identity core.Identity
			if err = json.Unmarshal(data, &identity); err != nil {
				t.Fatal(err)
			}
			result, check = ValidateContributionRejectionRequest(v["request"], identity.Public)
		case "verify":
			result, check = VerifyContributionRejection(v["rejection"])
		case "match":
			result, check = MatchContributionRejection(v["rejection"], v["proposal"])
		case "envelope":
			data, err := core.Canonical(v["bundle"])
			if err != nil {
				t.Fatal(err)
			}
			var bundle core.Bundle
			bundle, check = core.DecodeBundle(data)
			if check == nil {
				encoded, err := core.Canonical(v["identity"])
				if err != nil {
					t.Fatal(err)
				}
				var owner core.Identity
				if err = json.Unmarshal(encoded, &owner); err != nil {
					t.Fatal(err)
				}
				_, check = core.DecryptBundleAt(bundle, &owner, bundle.Manifest.Created)
			}
			if check == nil {
				result, check = MatchContributionRejectionEnvelope(bundle, v["plaintext"])
			}
		default:
			t.Fatal("unknown vector kind")
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
