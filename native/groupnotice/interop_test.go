package groupnotice

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

// Driven with synthetic keys by tests/native/group-notices.test.ts. Not an API.
func TestNoticeInteropFixture(t *testing.T) {
	request := os.Getenv("RELAYLOOM_NOTICE_FIXTURE")
	if request == "" {
		t.Skip("driven by Node notice interoperability test")
	}
	// The compiled worker is launched from the project root by launchOwned.
	root, err := filepath.Abs(".cache")
	must(t, err)
	inside := func(path string) string {
		abs, err := filepath.Abs(path)
		must(t, err)
		rel, err := filepath.Rel(root, abs)
		must(t, err)
		if rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			t.Fatal("private fixture must stay in project cache")
		}
		return abs
	}
	request = inside(request)
	data, err := os.ReadFile(request)
	must(t, err)
	v, err := core.DecodeJSON(data, 512*1024)
	must(t, err)
	m := v.(map[string]any)
	identity, err := core.DecodeIdentity(encode(t, m["identity"]))
	must(t, err)
	s, err := groupstore.Open(inside(str(m["path"])), identity, groupstore.Options{ExpectedStoreID: str(m["storeId"])})
	must(t, err)
	defer s.Close()
	direction := Direction(str(m["direction"]))
	out := map[string]any{}
	var notice Notice
	if m["notice"] != nil {
		notice, err = Parse(m["notice"])
	}
	if err == nil {
		switch m["action"] {
		case "save":
			err = s.Update(func(tx *groupstore.Tx) error {
				j, e := New(tx, identity.Public)
				if e != nil {
					return e
				}
				result, e := j.Save(direction, notice)
				out["result"] = result
				return e
			})
		case "retire":
			err = s.Update(func(tx *groupstore.Tx) error {
				j, e := New(tx, identity.Public)
				if e != nil {
					return e
				}
				result, e := j.Retire(direction, str(m["id"]))
				out["retired"] = result
				return e
			})
		case "list":
			err = s.View(func(tx *groupstore.Tx) error {
				j, e := New(tx, identity.Public)
				if e != nil {
					return e
				}
				result, e := j.List(direction)
				out["entries"] = result
				return e
			})
		case "seal":
			var bundle core.Bundle
			bundle, err = Seal(identity, notice)
			out["bundle"] = bundle
		case "open":
			var bundle core.Bundle
			bundle, err = core.DecodeBundle(encode(t, m["bundle"]))
			if err == nil {
				var opened Notice
				opened, err = Open(bundle, identity)
				out["opened"] = opened.Raw
			}
		default:
			err = bad("unknown fixture action")
		}
	}
	if err != nil {
		out = map[string]any{"error": err.Error()}
	}
	must(t, os.WriteFile(request+".out", encode(t, out), 0600))
}
