package profiledb

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilelock"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

func TestProfileDatabaseInteropFixture(t *testing.T) {
	input := os.Getenv("RELAYLOOM_PROFILE_DB_FIXTURE")
	if input == "" {
		t.Skip("driven by the Node/Go private-state process test")
	}
	var q struct {
		Directory    string
		Identity     core.Identity
		Legacy       string
		SourceDigest string
		Next         string
		Expected     string
		Mode         string
		Output       string
		Marker       string
	}
	raw, err := os.ReadFile(input)
	check(t, err)
	check(t, json.Unmarshal(raw, &q))
	lease, err := profilelock.Acquire(q.Directory)
	check(t, err)
	defer lease.Close()
	legacy, err := base64.StdEncoding.DecodeString(q.Legacy)
	check(t, err)
	db, err := Open(q.Directory, q.Identity, func() (Legacy, error) { return Legacy{legacy, q.SourceDigest}, nil })
	check(t, err)
	defer db.Close()
	if q.Mode != "read" {
		next, err := base64.StdEncoding.DecodeString(q.Next)
		check(t, err)
		if q.Mode == "before-commit" {
			err = db.Update(func(tx *groupstore.Tx) error {
				if _, err := profilestate.Write(tx, next, &q.Expected); err != nil {
					return err
				}
				if err := tx.Put("fence:interop", []byte("left"), groupstore.Checkpoint); err != nil {
					return err
				}
				if err := os.WriteFile(q.Marker, []byte("private-and-fence-staged"), 0600); err != nil {
					return err
				}
				os.Exit(76)
				return nil
			})
			check(t, err)
		} else {
			_, err = db.Write(next, q.Expected)
			check(t, err)
		}
	}
	state, err := db.Read()
	check(t, err)
	output, err := core.Canonical(map[string]any{"bytes": base64.StdEncoding.EncodeToString(state.Bytes), "digest": state.Digest, "binding": db.Binding()})
	check(t, err)
	check(t, os.WriteFile(q.Output, output, 0600))
	if q.Mode == "after-commit" {
		os.Exit(77)
	}
}
