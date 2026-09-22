package sites

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func TestContributionInteroperability(t *testing.T) {
	input := os.Getenv("RELAYLOOM_CONTRIBUTION_INPUT")
	if input == "" {
		t.Skip("explicit public-vector driver required")
	}
	path, err := filepath.Abs(input)
	if err != nil {
		t.Fatal(err)
	}
	cache, err := filepath.Abs("../../.cache")
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(cache, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		t.Fatal("fixture outside project cache")
	}
	stat, err := os.Lstat(path)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > 2*1024*1024 {
		t.Fatal("fixture file", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	value, err := core.DecodeJSON(data, 2*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	root, err := object(value, "vectors", "form", "table", "request", "now")
	if err != nil {
		t.Fatal(err)
	}
	vectors, ok := root["vectors"].([]any)
	if !ok {
		t.Fatal("vectors")
	}
	result := []any{}
	for _, raw := range vectors {
		vector := raw.(map[string]any)
		kind := vector["kind"].(string)
		candidate := vector["candidate"]
		var check error
		switch kind {
		case "form":
			_, check = ParseSiteForm(candidate)
		case "values":
			_, check = MatchContributionValues(root["form"], root["table"], candidate)
		case "proposal":
			_, check = VerifyContribution(candidate)
		case "publication":
			_, check = VerifyContributionPublicationScope(candidate, vector["audience"])
		case "admission", "submission":
			context := vector["context"].(map[string]any)
			expires, _ := docNumber(context["snapshotExpires"])
			now, _ := docNumber(root["now"])
			resolved := ContributionFormContext{context["target"], context["form"], context["table"], context["siteScope"], expires}
			if kind == "submission" {
				_, check = VerifyContributionForSubmission(candidate, resolved, now)
			} else {
				_, check = VerifyContributionForForm(candidate, resolved, now)
			}
		default:
			t.Fatal("unknown vector", kind)
		}
		accepted := check == nil
		if accepted != vector["valid"].(bool) {
			t.Fatalf("%s accepted=%v: %v", vector["name"], accepted, check)
		}
		result = append(result, map[string]any{"name": vector["name"], "accepted": accepted})
	}
	identity, err := core.CreateIdentity("Visitante Go 🧶")
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := CreateContribution(identity, root["request"])
	if err != nil {
		t.Fatal(err)
	}
	hash, err := ContributionSchemaHash(root["form"], root["table"])
	if err != nil {
		t.Fatal(err)
	}
	request := root["request"].(map[string]any)
	now, _ := docNumber(root["now"])
	if _, err = VerifyContributionForForm(certificate, ContributionFormContext{request["target"], root["form"], root["table"], "public", now + 60000}, now); err != nil {
		t.Fatal(err)
	}
	altered, _ := resourceClone(certificate)
	altered["body"].(map[string]any)["values"].(map[string]any)["name"] = "tampered"
	if _, err = VerifyContribution(altered); err == nil {
		t.Fatal("forged Go contribution accepted")
	}
	wrong, err := core.CreateIdentity("Other signing owner")
	if err != nil {
		t.Fatal(err)
	}
	stolen := identity
	stolen.SignSecret = wrong.SignSecret
	if _, err = CreateContribution(stolen, root["request"]); err == nil {
		t.Fatal("foreign signing secret accepted")
	}
	// Runtime int64 timestamps also obey the JSON-safe integer boundary.
	bad, _ := resourceClone(request)
	bad["created"] = int64(9007199254740992)
	bad["expires"] = int64(9007199254740993)
	if _, err = CreateContribution(identity, bad); err == nil {
		t.Fatal("unsafe runtime timestamp accepted")
	}
	output, err := core.Canonical(map[string]any{"vectors": result, "certificate": certificate, "schemaHash": hash, "goTamperRejected": true, "goForeignSigningKeyRejected": true, "goUnsafeRuntimeTimestampRejected": true})
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(path+".out.json", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err = file.Write(output); err != nil {
		t.Fatal(err)
	}
}

func TestContributionValueRuntimeTypes(t *testing.T) {
	for _, v := range []any{int(0), int64(123), float64(2.5), json.Number("7.5"), false, nil, "texto"} {
		if _, err := ParseContributionValues(map[string]any{"value": v}); err != nil {
			t.Fatal("valid runtime value", v, err)
		}
	}
	for _, v := range []any{uint64(1), []any{}, map[string]any{}, strings.Repeat("x", 1001), json.Number("1e9999"), int64(9007199254740992)} {
		if _, err := ParseContributionValues(map[string]any{"value": v}); err == nil {
			t.Fatal("invalid runtime value", v)
		}
	}
}
