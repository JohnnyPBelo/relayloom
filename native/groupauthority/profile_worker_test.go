package groupauthority

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profiledb"
	"github.com/JohnnyPBelo/relayloom/native/profilelock"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

func TestGroupProfileTransactionFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_GROUP_SCOPE_FIXTURE")
	if path == "" {
		t.Skip("driven by the real Node/Go group/private transaction test")
	}
	var q struct {
		Directory, Mode, OperationID, Title, Next, Expected, Output, Marker string
		Identity                                                            core.Identity
	}
	raw, err := os.ReadFile(path)
	check(t, err)
	check(t, json.Unmarshal(raw, &q))
	lease, err := profilelock.Acquire(q.Directory)
	check(t, err)
	defer lease.Close()
	db, err := profiledb.Open(q.Directory, q.Identity, func() (profiledb.Legacy, error) {
		return profiledb.Legacy{}, errors.New("fixture requires committed database; no legacy fallback")
	})
	check(t, err)
	defer db.Close()
	if q.Mode != "read" {
		next, err := base64.StdEncoding.DecodeString(q.Next)
		check(t, err)
		check(t, db.Update(func(tx *groupstore.Tx) error {
			_, err := InTransaction(tx, q.Identity, func(g *Registry) error {
				if _, err := g.Create(q.OperationID, q.Title); err != nil {
					return err
				}
				if _, err := profilestate.Write(tx, next, &q.Expected); err != nil {
					return err
				}
				if q.Mode == "before" {
					if err := os.WriteFile(q.Marker, []byte("group-and-private-staged"), 0600); err != nil {
						return err
					}
					os.Exit(73)
				}
				return nil
			})
			return err
		}))
		if q.Mode == "after" {
			check(t, os.WriteFile(q.Marker, []byte("group-and-private-committed"), 0600))
			os.Exit(74)
		}
	}
	state, err := db.Read()
	check(t, err)
	g, err := New(db.Store(), q.Identity)
	check(t, err)
	operation, err := g.OperationStatus(q.OperationID)
	check(t, err)
	list, err := g.List()
	check(t, err)
	output, err := core.Canonical(map[string]any{"bytes": base64.StdEncoding.EncodeToString(state.Bytes), "digest": state.Digest, "operation": operation, "groups": list})
	check(t, err)
	check(t, os.WriteFile(q.Output, output, 0600))
}
