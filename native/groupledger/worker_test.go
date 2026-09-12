package groupledger

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestGroupLedgerProcessFixture(t *testing.T) {
	input := os.Getenv("RELAYLOOM_LEDGER_FIXTURE")
	if input == "" {
		t.Skip("driven by real Node/Go ledger processes")
	}
	var q struct {
		Path, StoreID, Output, Crash, Marker string
		Identity                             core.Identity
		Requests                             []struct {
			Kind                          string
			Bundle                        *core.Bundle
			ID                            string
			Entry                         RetryEntry
			Unfinished                    bool
			Retained                      []string
			GroupID, EpochID, OperationID string
		}
	}
	raw, err := os.ReadFile(input)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &q); err != nil {
		t.Fatal(err)
	}
	store, err := groupstore.Open(q.Path, q.Identity, groupstore.Options{ExpectedStoreID: q.StoreID})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	results := []any{}
	err = store.Update(func(tx *groupstore.Tx) error {
		_, err := Run(tx, q.Identity, func(l *Ledger, g *groupauthority.Registry) error {
			for _, r := range q.Requests {
				switch r.Kind {
				case "consider":
					if err := core.VerifyBundle(*r.Bundle); err != nil {
						return err
					}
					content, err := core.DecryptBundle(*r.Bundle, &q.Identity)
					if err != nil {
						return err
					}
					readers := []string{}
					for _, key := range r.Bundle.Manifest.Keys {
						readers = append(readers, key.Reader)
					}
					payload, err := core.Canonical(*r.Bundle)
					if err != nil {
						return err
					}
					candidate := groupaccess.Candidate{ID: r.Bundle.Manifest.ID, Kind: r.Bundle.Manifest.Kind, Author: r.Bundle.Manifest.Author, Readers: readers, Public: r.Bundle.Manifest.PublicKey != nil, Content: content.(map[string]any)}
					value, err := l.Consider(candidate, r.Bundle.Manifest.Expires, int64(len(payload)), nil, time.Now().UnixMilli())
					if err != nil {
						return err
					}
					results = append(results, value)
				case "accepted":
					value, err := l.Accepted(r.ID)
					if err != nil {
						return err
					}
					results = append(results, value)
				case "held":
					value, err := l.Held()
					if err != nil {
						return err
					}
					results = append(results, value)
				case "retry":
					value, err := l.ReconcileRetry(r.Entry, r.Unfinished)
					if err != nil {
						return err
					}
					results = append(results, value)
				case "stop":
					value, err := l.Stop(r.Entry.OperationID)
					if err != nil {
						return err
					}
					results = append(results, value)
				case "retire":
					keep := map[string]bool{}
					for _, id := range r.Retained {
						keep[id] = true
					}
					if err := l.RetireStops(keep); err != nil {
						return err
					}
					results = append(results, true)
				case "losses":
					value, err := l.Losses()
					if err != nil {
						return err
					}
					results = append(results, value)
				case "close":
					value, err := g.Close(r.OperationID, r.GroupID, r.EpochID)
					if err != nil {
						return err
					}
					results = append(results, value)
				default:
					t.Fatalf("unknown fixture command %s", r.Kind)
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		if q.Crash == "before" {
			if err := os.WriteFile(q.Marker, []byte("staged-before-commit"), 0600); err != nil {
				return err
			}
			os.Exit(73)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Crash == "after" {
		if err := os.WriteFile(q.Marker, []byte("committed-before-response"), 0600); err != nil {
			t.Fatal(err)
		}
		os.Exit(74)
	}
	encoded, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(q.Output, encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
