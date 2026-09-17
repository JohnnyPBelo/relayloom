package sites

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func identity(t *testing.T, name string) core.Identity {
	t.Helper()
	v, err := core.CreateIdentity(name)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func digest(t *testing.T, value any) string {
	t.Helper()
	v, err := DocumentHash(value)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func successor(t *testing.T, owner core.Identity, parents []Revision, value any) Revision {
	t.Helper()
	r, err := CreateSuccessor(owner, "profile", parents, digest(t, value))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestPublicNodeVectors(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/site-revisions.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Owner        core.PublicIdentity `json:"owner"`
		Address      string              `json:"address"`
		Payload      json.RawMessage     `json:"payload"`
		DocumentHash string              `json:"documentHash"`
		First        json.RawMessage     `json:"first"`
		Selections   []struct {
			Name      string            `json:"name"`
			Revisions []json.RawMessage `json:"revisions"`
			Expected  Selection         `json:"expected"`
		} `json:"selections"`
		Invalid []struct {
			Name     string          `json:"name"`
			Revision json.RawMessage `json:"revision"`
		} `json:"invalid"`
	}
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	address, err := Address(f.Owner.ID, "profile")
	if err != nil || address != f.Address {
		t.Fatal("stable address differs", err)
	}
	owner, name, err := ParseAddress(address)
	if err != nil || owner != f.Owner.ID || name != "profile" {
		t.Fatal("address parsing differs", err)
	}
	payload, err := core.DecodeJSON(f.Payload, PayloadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if digest(t, payload) != f.DocumentHash {
		t.Fatal("canonical payload differs from Node")
	}
	first, err := DecodeRevision(f.First)
	if err != nil {
		t.Fatal(err)
	}
	if err = VerifySnapshot(first, payload, owner, name); err != nil {
		t.Fatal(err)
	}
	if VerifySnapshot(first, map[string]any{"title": "forged"}, owner, name) == nil {
		t.Fatal("changed payload accepted")
	}
	for _, c := range f.Selections {
		t.Run(c.Name, func(t *testing.T) {
			revisions := []Revision{}
			for _, raw := range c.Revisions {
				r, err := DecodeRevision(raw)
				if err != nil {
					t.Fatal(err)
				}
				revisions = append(revisions, r)
			}
			got, err := ClassifyRevisions(owner, name, revisions)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, c.Expected) {
				t.Fatalf("selection differs: got %+v expected %+v", got, c.Expected)
			}
		})
	}
	for _, c := range f.Invalid {
		t.Run(c.Name, func(t *testing.T) {
			if _, err := DecodeRevision(c.Revision); err == nil {
				t.Fatal("invalid Node fixture accepted")
			}
		})
	}
}

func TestOwnershipAndHistory(t *testing.T) {
	a, b := identity(t, "Owner"), identity(t, "Reader")
	one := successor(t, a, nil, "first")
	left := successor(t, a, []Revision{one}, "left")
	right := successor(t, a, []Revision{one}, "right")
	selection, err := ClassifyRevisions(a.Public.ID, "profile", []Revision{right, one, left, one})
	if err != nil || selection.Status != "conflict" || len(selection.Heads) != 2 {
		t.Fatal("fork not detected", err)
	}
	merged := successor(t, a, selection.Heads, "selected by owner")
	for _, parent := range selection.Heads {
		if err := VerifyHistoryLink(merged, parent); err != nil {
			t.Fatal(err)
		}
	}
	selection, err = ClassifyRevisions(a.Public.ID, "profile", []Revision{one, merged})
	if err != nil || selection.Number != 3 || selection.Heads[0].ID != merged.ID || len(selection.MissingHistory) != 2 {
		t.Fatal("newer header lost on replay", err)
	}
	readOnly := a
	readOnly.SignSecret = a.BoxSecret
	if _, err = CreateSuccessor(readOnly, "profile", []Revision{one}, digest(t, "forged")); err == nil {
		t.Fatal("reading key granted authorship")
	}
	readOnly.SignSecret = b.SignSecret
	if _, err = CreateSuccessor(readOnly, "profile", []Revision{one}, digest(t, "forged")); err == nil {
		t.Fatal("another signing key granted authorship")
	}
	if _, err = CreateSuccessor(b, "profile", []Revision{one}, digest(t, "forged")); err == nil {
		t.Fatal("foreign predecessor accepted")
	}
	if VerifySnapshot(one, "first", b.Public.ID, "profile") == nil || VerifySnapshot(one, "first", a.Public.ID, "other") == nil {
		t.Fatal("wrong site accepted")
	}
}

func TestBoundsAndMalformedEncoding(t *testing.T) {
	owner := identity(t, "Limits")
	hash := digest(t, "payload")
	ids := make([]string, Predecessors)
	for i := range ids {
		ids[i] = strings.Repeat("0", 62) + "0123456789abcdef"[i:i+1] + "0"
	}
	valid, err := CreateRevision(owner, "profile", 2, ids, hash)
	if err != nil {
		t.Fatal(err)
	}
	ids[0] = strings.Repeat("f", 64)
	if err = VerifyRevision(valid); err != nil {
		t.Fatal("caller mutated signed predecessor list", err)
	}
	if _, err = CreateRevision(owner, "profile", 2, append(ids, strings.Repeat("f", 64)), hash); err == nil {
		t.Fatal("too many parents accepted")
	}
	if _, err = CreateRevision(owner, "profile", 2, []string{valid.Body.Previous[0], valid.Body.Previous[0]}, hash); err == nil {
		t.Fatal("duplicate parents accepted")
	}
	if _, err = ClassifyRevisions(owner.Public.ID, "profile", make([]Revision, Headers+1)); err == nil {
		t.Fatal("unbounded headers")
	}
	if _, err = DocumentHash(strings.Repeat("x", PayloadBytes+1)); err == nil {
		t.Fatal("unbounded payload")
	}
	last, err := CreateRevision(owner, "profile", MaxSequence, nil, hash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = CreateSuccessor(owner, "profile", []Revision{last}, hash); err == nil {
		t.Fatal("counter overflow")
	}
	for _, input := range []string{"null", "{}", `{"body":{}}`, strings.Repeat(" ", CertificateBytes+1)} {
		if _, err = DecodeRevision([]byte(input)); err == nil {
			t.Fatal("invalid encoding accepted")
		}
	}
	for _, input := range []string{"relayloom:site:" + owner.Public.ID + "/../bad", "relayloom:site:" + owner.Public.ID + "/profile?x=1", "relayloom:site:" + owner.Public.ID + "/Profile"} {
		if _, _, err = ParseAddress(input); err == nil {
			t.Fatal("ambiguous address accepted")
		}
	}
}
