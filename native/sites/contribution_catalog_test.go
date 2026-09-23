package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type contributionCrashDatabase struct {
	store            *groupstore.Store
	exitBeforeCommit int
	holdDir          string
}

func (d contributionCrashDatabase) Update(fn func(*groupstore.Tx) error) error {
	return d.store.Update(func(tx *groupstore.Tx) error {
		err := fn(tx)
		if err == nil && d.holdDir != "" {
			if err = os.WriteFile(filepath.Join(d.holdDir, "envelope-held"), []byte("owned transaction held"), 0600); err != nil {
				return err
			}
			until := time.Now().Add(10 * time.Second)
			for {
				if _, statErr := os.Stat(filepath.Join(d.holdDir, "envelope-release")); statErr == nil {
					break
				}
				if time.Now().After(until) {
					return errors.New("owned transaction hold timed out")
				}
				time.Sleep(5 * time.Millisecond)
			}
		}
		if err == nil && d.exitBeforeCommit != 0 {
			os.Exit(d.exitBeforeCommit)
		}
		return err
	})
}
func TestContributionCatalogWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_CONTRIBUTION_CATALOG_CONTROL")
	if path == "" {
		t.Skip("parent-owned catalogue fixture")
	}
	full, err := filepath.Abs(path)
	if err != nil {
		t.Fatal(err)
	}
	cache, _ := filepath.Abs("../../.cache")
	rel, err := filepath.Rel(cache, full)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || len(rel) >= 3 && rel[:3] == ".."+string(filepath.Separator) {
		t.Fatal("control outside project cache")
	}
	stat, err := os.Stat(full)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > 16*1024*1024 {
		t.Fatal("bounded control required", err)
	}
	data, err := os.ReadFile(full)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := core.DecodeJSON(data, 16*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	input := decoded.(map[string]any)
	encoded, err := core.Canonical(input["identity"])
	if err != nil {
		t.Fatal(err)
	}
	identity, err := core.DecodeIdentity(encoded)
	if err != nil {
		t.Fatal(err)
	}
	database, err := groupstore.Open(docTextValue(input["database"]), identity, groupstore.Options{ExpectedStoreID: docTextValue(input["storeId"])})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	mode := docTextValue(input["mode"])
	code := 0
	if mode == "before-intent-commit" {
		code = 81
	}
	if mode == "before-signature-commit" {
		code = 83
	}
	if mode == "before-envelope-commit" {
		code = 85
	}
	if mode == "before-receipt-commit" || mode == "before-rejection-commit" {
		code = 91
	}
	if mode == "before-queue-commit" {
		code = 87
	}
	holdDir := ""
	if input["holdBeforeCommit"] == true {
		holdDir = filepath.Dir(full)
	}
	catalog := NewContributionCatalog(contributionCrashDatabase{store: database, exitBeforeCommit: code, holdDir: holdDir}, identity)
	if value, ok := input["now"]; ok {
		now, err := docNumber(value)
		if err != nil {
			t.Fatal(err)
		}
		catalog.now = func() int64 { return now }
	}
	load := func() (core.Bundle, error) {
		if input["denyLoad"] == true {
			return core.Bundle{}, errors.New("fixture must not reload source")
		}
		bytes, err := core.Canonical(input["source"])
		if err != nil {
			return core.Bundle{}, err
		}
		return core.DecodeBundle(bytes)
	}
	policy := func(snapshot, owner string) error {
		if value, ok := input["policyNow"]; ok {
			n, err := docNumber(value)
			if err != nil {
				return err
			}
			catalog.now = func() int64 { return n }
		}

		if input["blocked"] == true {
			return errors.New("fixture owner blocked")
		}
		return nil
	}
	commands, ok := input["commands"].([]any)
	if !ok || len(commands) > 256 {
		t.Fatal("bounded command list")
	}
	results := []any{}
	for _, raw := range commands {
		command := raw.(map[string]any)
		if now, ok := command["now"]; ok {
			n, err := docNumber(now)
			if err != nil {
				t.Fatal(err)
			}
			catalog.now = func() int64 { return n }
		}
		var value any
		var err error
		h := ContributionHandle{}
		if raw, ok := command["handle"].(map[string]any); ok {
			h = contributionHandle(raw)
		}
		switch command["action"] {
		case "state":
			value, err = catalog.State()
		case "prepare":
			value, err = catalog.Prepare(command["request"], load, policy)
		case "sign":
			value, err = catalog.Sign(h, policy)
		case "seal":
			value, err = catalog.Seal(h, policy)
		case "bundle":
			value, err = catalog.AuthorizedBundle(h, policy)
		case "queue":
			value, err = catalog.Queue(h, policy)
		case "source":
			value, err = catalog.QueuedSource(h, policy)
		case "receive-receipt":
			bytes, e := core.Canonical(command["bundle"])
			if e != nil {
				t.Fatal(e)
			}
			bundle, e := core.DecodeBundle(bytes)
			if e != nil {
				t.Fatal(e)
			}
			value, err = catalog.ReceiveReceipt(bundle, policy)
		case "receive-rejection":
			bytes, e := core.Canonical(command["bundle"])
			if e != nil {
				t.Fatal(e)
			}
			bundle, e := core.DecodeBundle(bytes)
			if e != nil {
				t.Fatal(e)
			}
			value, err = catalog.ReceiveRejection(bundle, policy)
		case "copied":
			bytes, e := core.Canonical(command["bundle"])
			if e != nil {
				t.Fatal(e)
			}
			bundle, e := core.DecodeBundle(bytes)
			if e != nil {
				t.Fatal(e)
			}
			value, err = catalog.MarkCopied(h, bundle)
		case "certificate":
			value, err = catalog.AuthorizedCertificate(h, policy)
		case "cancel":
			value, err = catalog.Cancel(h)
		case "operation":
			var op map[string]any
			var retired bool
			op, retired, err = catalog.Operation(h.Sequence, h.OperationID)
			value = map[string]any{"operation": op, "retired": retired}
		default:
			t.Fatal("unknown catalogue command")
		}
		if command["expectError"] == true {
			if err == nil {
				t.Fatal("expected command refusal", command["action"])
			}
			results = append(results, map[string]any{"error": true})
			continue
		}
		if err != nil {
			t.Fatal(command["action"], err)
		}
		results = append(results, value)
		if mode == "after-intent" && command["action"] == "prepare" {
			os.Exit(82)
		}
		if mode == "after-signature" && command["action"] == "sign" {
			os.Exit(84)
		}
		if mode == "after-envelope" && command["action"] == "seal" {
			os.Exit(86)
		}
		if (mode == "after-receipt" && command["action"] == "receive-receipt") || (mode == "after-rejection" && command["action"] == "receive-rejection") {
			os.Exit(92)
		}
		if mode == "after-queue" && command["action"] == "queue" {
			os.Exit(88)
		}
	}
	bytes, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(full+".result.json", bytes, 0600); err != nil {
		t.Fatal(err)
	}
}
