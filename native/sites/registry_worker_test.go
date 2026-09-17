package sites

import (
	"bytes"
	"encoding/json"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"testing"
)

func TestRegistryInteropWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_SITE_REGISTRY_INPUT")
	if path == "" {
		t.Skip("parent-owned registry vectors")
	}
	data, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	if len(data) > 16*1024*1024 {
		t.Fatal("vector budget")
	}
	var input struct {
		OwnerID string `json:"ownerId"`
		Name    string `json:"name"`
		Cases   []struct {
			Label       string          `json:"label"`
			Action      string          `json:"action"`
			Record      json.RawMessage `json:"record"`
			Request     json.RawMessage `json:"request"`
			Revision    json.RawMessage `json:"revision"`
			BundleID    string          `json:"bundleId"`
			Sequence    int64           `json:"sequence"`
			ID          string          `json:"id"`
			Fingerprint string          `json:"fingerprint"`
			Expected    json.RawMessage `json:"expected"`
			Error       bool            `json:"error"`
		} `json:"cases"`
	}
	if e = json.Unmarshal(data, &input); e != nil {
		t.Fatal(e)
	}
	for _, c := range input.Cases {
		t.Run(c.Label, func(t *testing.T) {
			r, err := DecodeRecord(c.Record, input.OwnerID, input.Name)
			var result any
			if err == nil {
				switch c.Action {
				case "begin":
					var q Reservation
					q, err = DecodeReservation(c.Request)
					if err == nil {
						result, err = Begin(r, q)
					}
				case "observe":
					var revision Revision
					revision, err = DecodeRevision(c.Revision)
					if err == nil {
						result, err = Observe(r, revision, c.BundleID)
					}
				case "lookup":
					result, err = Lookup(r, c.Sequence, c.ID, c.Fingerprint)
				case "state":
					var state RecordState
					var base, key string
					state, err = State(r)
					if err == nil {
						base, err = BaseHash(r)
					}
					if err == nil {
						key, err = RecordKey(r.OwnerID, r.Name)
					}
					result = map[string]any{"state": state, "base": base, "key": key}
				case "decode":
					result = r
				default:
					result, err = Finish(r, c.Sequence, c.ID, c.Fingerprint, c.Action)
				}
			}
			if c.Error {
				if err == nil {
					t.Fatal("negative control unexpectedly succeeded")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			expected, err := core.DecodeJSON(c.Expected, RecordBytes*2)
			if err != nil {
				t.Fatal(err)
			}
			want, err := core.Canonical(expected)
			if err != nil {
				t.Fatal(err)
			}
			got, err := core.Canonical(result)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("result mismatch: got %s expected %s", got, want)
			}
		})
	}
}
