package groupaccess

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestGroupAccessProcessFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_ACCESS_FIXTURE")
	if path == "" {
		t.Skip("driven by the Node/Go signed group-access test")
	}
	var q struct {
		Path, StoreID, Output string
		Identity              core.Identity
		Requests              []struct {
			Bundle           *core.Bundle
			Prior, Target    *AcceptedContext
			GroupID, EpochID string
		}
		CloseGroup, CloseEpoch, CloseOperation string
	}
	raw, err := os.ReadFile(path)
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
		_, err := groupauthority.InTransaction(tx, q.Identity, func(g *groupauthority.Registry) error {
			access, err := New(g, q.Identity.Public)
			if err != nil {
				return err
			}
			for _, r := range q.Requests {
				if r.Bundle == nil {
					result, err := access.Retry(r.GroupID, r.EpochID)
					if err != nil {
						return err
					}
					results = append(results, result)
					continue
				}
				if err := core.VerifyBundle(*r.Bundle); err != nil {
					results = append(results, map[string]string{"status": "invalid-bundle"})
					continue
				}
				decoded, err := core.DecryptBundle(*r.Bundle, &q.Identity)
				if err != nil {
					results = append(results, map[string]string{"status": "unreadable"})
					continue
				}
				content, ok := decoded.(map[string]any)
				if !ok {
					t.Fatal("fixture content is not an object")
				}
				readers := []string{}
				for _, key := range r.Bundle.Manifest.Keys {
					readers = append(readers, key.Reader)
				}
				candidate := Candidate{ID: r.Bundle.Manifest.ID, Kind: r.Bundle.Manifest.Kind, Author: r.Bundle.Manifest.Author, Readers: readers, Public: r.Bundle.Manifest.PublicKey != nil, Content: content}
				result, err := access.Decide(candidate, r.Prior, r.Target)
				if err != nil {
					return err
				}
				results = append(results, result)
			}
			if q.CloseGroup != "" {
				before, err := access.Retry(q.CloseGroup, q.CloseEpoch)
				if err != nil {
					return err
				}
				if _, err = g.Close(q.CloseOperation, q.CloseGroup, q.CloseEpoch); err != nil {
					return err
				}
				after, err := access.Retry(q.CloseGroup, q.CloseEpoch)
				if err != nil {
					return err
				}
				results = append(results, map[string]any{"before": before, "after": after})
			}
			return nil
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := core.Canonical(results)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(q.Output, encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
