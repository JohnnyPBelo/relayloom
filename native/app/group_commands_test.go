package app

import (
	"errors"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestGroupCommandLostResponseRecoversOnlyCommittedResult(t *testing.T) {
	for _, commit := range []bool{false, true} {
		name := "before-commit"
		if commit {
			name = "after-commit"
		}
		t.Run(name, func(t *testing.T) {
			n, _ := nodeFor(t, "Owner")
			request := map[string]any{"action": "create", "operationId": "96d5891c-f120-4005-8f2d-7c4715d0b916", "title": "Exactly once"}
			injected := errors.New("synthetic response loss")
			database := n.privateDatabase
			n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
				if commit {
					if err := database.Update(callback); err != nil {
						return err
					}
				} else {
					return database.Update(func(tx *groupstore.Tx) error {
						if err := callback(tx); err != nil {
							return err
						}
						return injected
					})
				}
				return injected
			}
			value, err := n.Handle("group-command", request)
			if !errors.Is(err, injected) || value != nil {
				t.Fatalf("uncertain success escaped: %v / %v", value, err)
			}
			n.updateGroupState = nil
			status := apply(t, n, "group-command", map[string]any{"action": "operation", "operationId": request["operationId"]}).(map[string]any)["operation"].(*groupauthority.Result)
			if (status != nil) != commit {
				t.Fatal("recovery did not preserve the actual commit boundary")
			}
			recovered := apply(t, n, "group-command", request).(map[string]any)["operation"].(groupauthority.Result)
			if commit && recovered.GroupID != status.GroupID {
				t.Fatal("lost response created a second operation")
			}
			list := apply(t, n, "group-command", map[string]any{"action": "list"}).(map[string]any)["groups"].([]groupauthority.View)
			if len(list) != 1 || list[0].ID != recovered.GroupID {
				t.Fatal("retry duplicated the group")
			}
		})
	}
}

func TestGroupCommandRejectsStalePrivateDigestAndRecovers(t *testing.T) {
	n, _ := nodeFor(t, "Stale")
	n.privateDigest = "stale"
	request := map[string]any{"action": "create", "operationId": "148b5314-7cc9-4bd1-96f7-6a84e0ec865d", "title": "Must not commit stale"}
	if _, err := n.Handle("group-command", request); err == nil {
		t.Fatal("stale private state allowed group mutation")
	}
	list := apply(t, n, "group-command", map[string]any{"action": "list"}).(map[string]any)["groups"].([]groupauthority.View)
	if len(list) != 0 {
		t.Fatal("stale command partially committed")
	}
	apply(t, n, "group-command", request)
}
