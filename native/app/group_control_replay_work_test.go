package app

import (
	"fmt"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

func TestVerifiedControlReplayAvoidsReapplicationAndKeepsSafetyHeaders(t *testing.T) {
	n, _ := nodeFor(t, "Replay work")
	n.cancel()
	n.wg.Wait()
	group := apply(t, n, "group-command", map[string]any{"action": "create", "operationId": operationFor(9790), "title": "Epoch0"}).(map[string]any)["group"].(groupauthority.View)
	for i := 1; i <= 10; i++ {
		group = apply(t, n, "group-command", map[string]any{"action": "commit", "operationId": operationFor(9790 + i), "groupId": group.ID, "expected": group.Head.ID, "title": fmt.Sprintf("Epoch%d", i), "members": []core.PublicIdentity{n.identity.Public}, "joins": []any{}}).(map[string]any)["group"].(groupauthority.View)
	}
	count := 0
	for _, m := range n.Store.List() {
		if m.Kind == "group-control" {
			count++
		}
	}
	if count != 11 {
		t.Fatalf("expected11 cached controls, got%d", count)
	}
	anchor := apply(t, n, "group-command", map[string]any{"action": "proofs", "groupId": group.ID, "from": 0}).(map[string]any)["anchor"].(groups.GroupAnchor)
	applications := 0
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		applications++
		return n.privateDatabase.Update(callback)
	}
	n.groupSync.recover()
	if applications != 0 {
		t.Fatalf("incorporated proof reapplied %d times", applications)
	}
	closed, err := groups.CloseGroup(*n.identity, anchor, *group.Head)
	if err != nil {
		t.Fatal(err)
	}
	b, err := core.CreateBundle(*n.identity, "group-control", map[string]any{"type": "group-control", "version": 1, "action": "snapshot", "groupId": group.ID, "epoch": closed, "snapshot": map[string]any{"invalid": "tail"}}, nil, false, 3600000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = n.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
	n.groupSync.receive(b, false)
	if applications == 0 {
		t.Fatal("new closure header skipped")
	}
	state := apply(t, n, "group-command", map[string]any{"action": "state", "groupId": group.ID}).(map[string]any)["group"].(groupauthority.View)
	if state.Status != "closed" {
		t.Fatal("bad snapshot suppressed valid closure")
	}
}
