package groupauthority

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

type fixtureRequest struct {
	Identity    core.Identity   `json:"identity"`
	Path        string          `json:"path"`
	StoreID     string          `json:"storeId"`
	Command     string          `json:"command"`
	GroupID     string          `json:"groupId"`
	Expected    string          `json:"expected"`
	OperationID string          `json:"operationId"`
	Create      bool            `json:"create"`
	Barrier     bool            `json:"barrier"`
	Crash       string          `json:"crash"`
	Marker      string          `json:"marker"`
	Output      string          `json:"output"`
	Args        json.RawMessage `json:"args"`
}
type crashStore struct {
	*groupstore.Store
	marker string
}

func (s crashStore) Update(callback func(*groupstore.Tx) error) error {
	return s.Store.Update(func(tx *groupstore.Tx) error {
		if err := callback(tx); err != nil {
			return err
		}
		if err := os.WriteFile(s.marker, []byte("authority-and-operation-staged"), 0600); err != nil {
			return err
		}
		os.Exit(73)
		return nil
	})
}
func TestGroupAuthorityInteropFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_AUTHORITY_FIXTURE")
	if path == "" {
		t.Skip("driven by the Node/Go authority process test")
	}
	data, err := os.ReadFile(path)
	check(t, err)
	var q fixtureRequest
	check(t, json.Unmarshal(data, &q))
	store, err := groupstore.Open(q.Path, q.Identity, groupstore.Options{Create: q.Create, ExpectedStoreID: q.StoreID})
	check(t, err)
	defer store.Close()
	registry, err := New(store, q.Identity)
	check(t, err)
	if q.Crash == "before" {
		registry.store = crashStore{store, q.Marker}
	}
	if q.Barrier {
		fmt.Println("AUTHORITY_WORKER_READY")
		_, err = bufio.NewReader(os.Stdin).ReadString('\n')
		check(t, err)
	}
	args := map[string]any{}
	if len(q.Args) > 0 {
		value, err := core.DecodeJSON(q.Args, 2*1024*1024)
		check(t, err)
		args = value.(map[string]any)
	}
	title, _ := args["title"].(string)
	var result any
	switch q.Command {
	case "create":
		result, err = registry.Create(q.OperationID, title)
	case "commit":
		before, e := registry.PrivateState(q.GroupID, q.Expected)
		check(t, e)
		if before == nil {
			t.Fatal("missing predecessor snapshot")
		}
		result, err = registry.Commit(q.OperationID, q.GroupID, q.Expected, groups.Update{Title: title, Members: before.Members, Joins: []groups.GroupConsent{}})
	case "leave":
		result, err = registry.Leave(q.OperationID, q.GroupID)
	case "close":
		result, err = registry.Close(q.OperationID, q.GroupID, q.Expected)
	case "resume":
		result, err = registry.ResumeCapacity(q.GroupID)
	case "headers":
		anchor, e := registry.Anchor(q.GroupID)
		check(t, e)
		list := args["headers"].([]any)
		epochs := []groups.GroupEpoch{}
		for _, v := range list {
			raw, e := core.Canonical(v)
			check(t, e)
			epoch, e := groups.DecodeEpoch(raw, anchor)
			check(t, e)
			epochs = append(epochs, epoch)
		}
		result, err = registry.ObserveHeaders(q.GroupID, epochs)
	case "snapshot":
		anchor, e := registry.Anchor(q.GroupID)
		check(t, e)
		raw, e := core.Canonical(args["epoch"])
		check(t, e)
		epoch, e := groups.DecodeEpoch(raw, anchor)
		check(t, e)
		raw, e = core.Canonical(args["snapshot"])
		check(t, e)
		snapshot, e := groups.DecodeSnapshot(raw, anchor, epoch)
		check(t, e)
		result, err = registry.ObserveSnapshot(q.GroupID, epoch.ID, snapshot)
	case "inspect":
		state, e := registry.State(q.GroupID)
		if e != nil {
			err = e
			break
		}
		proofs, e := registry.Proofs(q.GroupID, 0, PageLimit)
		check(t, e)
		stop, e := registry.StopEvidence(q.GroupID)
		check(t, e)
		snapshot, e := registry.PrivateState(q.GroupID, q.Expected)
		check(t, e)
		result = map[string]any{"state": state, "proofs": proofs, "stop": stop, "snapshot": snapshot}
	default:
		t.Fatalf("unknown fixture command: %s", q.Command)
	}
	var output map[string]any
	if err != nil {
		output = map[string]any{"error": err.Error()}
	} else {
		storeID, e := store.ID()
		check(t, e)
		accounting, e := store.Accounting()
		check(t, e)
		output = map[string]any{"result": result, "storeId": storeID, "revision": accounting.Revision}
	}
	encoded, err := core.Canonical(output)
	check(t, err)
	check(t, os.WriteFile(q.Output, encoded, 0600))
	if q.Crash == "after" {
		os.Exit(74)
	}
}
