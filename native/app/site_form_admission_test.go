package app

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"testing"
)

func TestVersion4RequiresOwnerSnapshot(t *testing.T) {
	owner, err := core.CreateIdentity("Form owner")
	if err != nil {
		t.Fatal(err)
	}
	other, err := core.CreateIdentity("Other signer")
	if err != nil {
		t.Fatal(err)
	}
	payload := runtimeSitePayload("Form version")
	payload["site"].(map[string]any)["version"] = 4
	unsigned, err := core.CreateBundle(owner, "site", payload, nil, true, 3600000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = inspectSiteBundle(unsigned, nil); err == nil {
		t.Fatal("v4 bypassed mandatory snapshot")
	}
	signed, err := sites.CreateContent(owner, "profile", 1, []string{}, payload)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := core.CreateBundle(owner, "site", signed, nil, true, 3600000)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := inspectSiteBundle(valid, nil); err != nil || result == nil {
		t.Fatal("valid owner snapshot rejected", err)
	}
	forged, err := core.CreateBundle(other, "site", signed, nil, true, 3600000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = inspectSiteBundle(forged, nil); err == nil {
		t.Fatal("reader signature replaced site owner")
	}
}
