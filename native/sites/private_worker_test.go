package sites

import (
	"encoding/json"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"os"
	"testing"
)

func TestPrivateRecordsInteropWorker(t *testing.T) {
	control := os.Getenv("RELAYLOOM_SITE_PRIVATE_CONTROL")
	if control == "" {
		t.Skip("parent-owned interop fixture only")
	}
	bytes, err := os.ReadFile(control)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		Database   string          `json:"database"`
		StoreID    string          `json:"storeId"`
		Identity   core.Identity   `json:"identity"`
		Key        string          `json:"key"`
		Expected   json.RawMessage `json:"expected"`
		WriteKey   string          `json:"writeKey"`
		WriteValue json.RawMessage `json:"writeValue"`
		Output     string          `json:"output"`
		Namespace  string          `json:"namespace"`
	}
	if err = json.Unmarshal(bytes, &input); err != nil {
		t.Fatal(err)
	}
	store, err := groupstore.Open(input.Database, input.Identity, groupstore.Options{ExpectedStoreID: input.StoreID})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	expected, err := core.DecodeJSON(input.Expected, PrivateBytes)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := core.Canonical(expected)
	run := RunPrivate
	if input.Namespace == "resource" {
		run = RunResourcePrivate
	} else if input.Namespace == "contribution" {
		run = RunContributionPrivate
	} else if input.Namespace == "contribution-rejection" {
		run = RunContributionRejectionPrivate
	} else if input.Namespace == "contribution-receipt" {
		run = RunContributionReceiptPrivate
	} else if input.Namespace == "contribution-inbox" {
		run = RunContributionInboxPrivate
	} else if input.Namespace != "" && input.Namespace != "site" {
		t.Fatal("unknown private namespace")
	}
	err = store.Update(func(tx *groupstore.Tx) error {
		return run(tx, input.Identity, func(r *PrivateRecords) error {
			value, found, err := r.Read(input.Key)
			if err != nil {
				return err
			}
			got, _ := core.Canonical(value)
			if !found || string(got) != string(want) {
				t.Fatal("Node private value differs")
			}
			if input.WriteKey != "" {
				value, err = core.DecodeJSON(input.WriteValue, PrivateBytes)
				if err != nil {
					return err
				}
				return r.Write(input.WriteKey, value)
			}
			return nil
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	report, _ := json.Marshal(map[string]any{"status": "PASS", "readSHA256": core.Hash(want), "wrote": input.WriteKey != ""})
	if err = os.WriteFile(input.Output, report, 0600); err != nil {
		t.Fatal(err)
	}
}
