package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupcontrol"
	"github.com/JohnnyPBelo/relayloom/native/groups"
)

func TestGroupControlResponsesRespectProducerQuota(t *testing.T) {
	n, original, _, _ := groupConfirmationFixture(t)
	if err := n.Store.SetQuota(2 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	group := apply(t, n, "group-command", map[string]any{"action": "state", "groupId": original.Content["conversation"]}).(map[string]any)["group"].(groupauthority.View)
	var first string
	for i := 0; i < 16; i++ {
		key := fmt.Sprintf("large-response-%d", i)
		err := n.groupSync.output(key, func() (core.Bundle, error) {
			headers := []any{}
			for j := 0; j < 16; j++ {
				headers = append(headers, map[string]any{"unverifiedTail": strings.Repeat("x", 15000)})
			}
			return groupcontrol.Seal(*n.identity, map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": group.ID, "to": original.Author.ID, "from": i, "headers": headers, "head": *group.Head}, []core.PublicIdentity{original.Author})
		}, false, 10000)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = n.groupSync.published[key]
			if first == "" {
				t.Fatal("positive control not stored")
			}
			if err := n.Store.Pin(first, true); err != nil {
				t.Fatal(err)
			}
		}
		bytes := int64(0)
		for _, m := range n.Store.List() {
			if m.Kind != "group-control" || m.Author.ID != n.identity.Public.ID {
				continue
			}
			b, err := n.Store.GetWithTouch(m.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := core.Canonical(b)
			if err != nil {
				t.Fatal(err)
			}
			bytes += int64(len(encoded))
		}
		if bytes > n.Store.Stats().Quota/4 {
			t.Fatalf("responses occupied %d; producer limit %d", bytes, n.Store.Stats().Quota/4)
		}
	}
	if !n.Store.IsPinned(first) || !n.Store.Has(first) {
		t.Fatal("pinned control evicted by responses")
	}
	small, err := groupcontrol.Seal(*n.identity, map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": group.ID, "to": original.Author.ID, "from": 0, "headers": []any{map[string]any{"tail": strings.Repeat("x", 15000)}}, "head": *group.Head}, []core.PublicIdentity{original.Author})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = n.Store.Put(small, false); err != nil {
		t.Fatal(err)
	}
	headers := []any{}
	for i := 0; i < 16; i++ {
		headers = append(headers, map[string]any{"tail": strings.Repeat("y", 15000)})
	}
	replacement, err := groupcontrol.Seal(*n.identity, map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": group.ID, "to": original.Author.ID, "from": 1, "headers": headers, "head": *group.Head}, []core.PublicIdentity{original.Author})
	if err != nil {
		t.Fatal(err)
	}
	kept, err := n.groupSync.retain(replacement, true)
	if err != nil || kept {
		t.Fatalf("impossible replacement: kept=%t err=%v", kept, err)
	}
	if !n.Store.Has(small.Manifest.ID) {
		t.Fatal("failed admission discarded an earlier control")
	}
	if err := n.Store.SetQuota(64 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	wireBudget := newGroupSynchronizer(n)
	bytesSent := 0
	for i := 0; i < 20; i++ {
		key := fmt.Sprintf("wire-budget-%d", i)
		err := wireBudget.output(key, func() (core.Bundle, error) {
			return groupcontrol.Seal(*n.identity, map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": group.ID, "to": original.Author.ID, "from": i, "headers": headers, "head": *group.Head}, []core.PublicIdentity{original.Author})
		}, false, 10000)
		if err != nil {
			t.Fatal(err)
		}
		if id := wireBudget.published[key]; id != "" {
			b, err := n.Store.GetWithTouch(id, false)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := core.Canonical(b)
			if err != nil {
				t.Fatal(err)
			}
			bytesSent += len(encoded)
		}
	}
	if bytesSent <= 3*1024*1024 || bytesSent > 4*1024*1024 {
		t.Fatalf("wire byte bound/positive control failed: %d", bytesSent)
	}
	if wireBudget.sent >= 20 {
		t.Fatal("wire byte budget never stopped outputs")
	}
}

func TestGroupControlUnknownGroupCannotEnrol(t *testing.T) {
	n, _ := nodeFor(t, "Not enrolled")
	n.cancel()
	n.wg.Wait()
	owner, err := core.CreateIdentity("Untrusted inviter")
	if err != nil {
		t.Fatal(err)
	}
	created, err := groups.CreateGroup(owner, "No automatic admission")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := groups.CreateInvitation(owner, created.Anchor, created.Epoch, n.identity.Public)
	if err != nil {
		t.Fatal(err)
	}
	// A globally valid consent can exist on another installation; it is not a
	// local user action and must not silently enrol this fresh profile.
	consent, err := groups.AcceptInvitation(*n.identity, created.Anchor, created.Epoch, invite)
	if err != nil {
		t.Fatal(err)
	}
	joined, err := groups.CreateSuccessor(owner, created.Anchor, created.Epoch, created.Snapshot, groups.Update{Title: "Valid but not locally accepted", Members: []core.PublicIdentity{owner.Public, n.identity.Public}, Joins: []groups.GroupConsent{consent}})
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := core.CreateBundle(owner, "group-control", Content{"type": "group-control", "version": 1, "action": "snapshot", "groupId": created.Anchor.ID, "epoch": joined.Epoch, "snapshot": joined.Snapshot}, []core.PublicIdentity{n.identity.Public}, false, groupcontrol.TTL)
	if err != nil {
		t.Fatal(err)
	}
	n.groupSync.receive(bundle, false)
	list := apply(t, n, "group-command", map[string]any{"action": "list"}).(map[string]any)["groups"].([]groupauthority.View)
	if len(list) != 0 {
		t.Fatal("network carrier silently enrolled an unknown group")
	}
	apply(t, n, "group-command", map[string]any{"action": "remember", "operationId": operationFor(9530), "anchor": created.Anchor, "parent": created.Epoch, "invitation": invite})
	apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": created.Anchor.ID, "headers": []groups.GroupEpoch{created.Epoch, joined.Epoch}})
	n.groupSync.receive(bundle, true)
	value := apply(t, n, "group-command", map[string]any{"action": "private-state", "groupId": created.Anchor.ID, "epochId": joined.Epoch.ID}).(map[string]any)["snapshot"]
	if snapshot, ok := value.(*groups.GroupSnapshot); ok && snapshot != nil {
		t.Fatal("remote signature substituted for local consent")
	}
}

func TestGroupControlFailedIndexWritesConsumeOutputBudget(t *testing.T) {
	n, original, sink, _ := groupConfirmationFixture(t)
	index := filepath.Join(n.Dir, "store", "index.json")
	backup := index + ".budget-backup"
	if err := os.Rename(index, backup); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(index, 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Remove(index); err != nil {
			t.Error(err)
		}
		if err := os.Rename(backup, index); err != nil {
			t.Error(err)
		}
	})
	group := apply(t, n, "group-command", map[string]any{"action": "state", "groupId": original.Content["conversation"]}).(map[string]any)["group"].(groupauthority.View)
	calls := 0
	failures := 0
	for i := 0; i < 80; i++ {
		err := n.groupSync.output(fmt.Sprintf("failed-%d", i), func() (core.Bundle, error) {
			calls++
			return groupcontrol.Seal(*n.identity, map[string]any{"type": "group-control", "version": 1, "action": "headers", "groupId": group.ID, "to": original.Author.ID, "from": i, "headers": []any{}, "head": *group.Head}, []core.PublicIdentity{original.Author})
		}, false, 10000)
		if err != nil {
			failures++
		}
	}
	if calls != 64 || failures != 64 || n.groupSync.budget != 64 || n.groupSync.sent != 0 {
		t.Fatalf("fallible side effects bypassed work budget: calls=%d errors=%d budget=%d sent=%d", calls, failures, n.groupSync.budget, n.groupSync.sent)
	}
	noGroupSendPacket(t, sink)
}

func TestGroupControlInvalidSnapshotStillCommitsVerifiedRemovalHeader(t *testing.T) {
	n, original, _, owner := groupConfirmationFixture(t)
	oldEpoch := text(original.Content["groupEpoch"])
	groupID := text(original.Content["conversation"])
	changed := apply(t, owner, "group-command", map[string]any{"action": "commit", "operationId": operationFor(9510), "groupId": groupID, "expected": oldEpoch, "title": "Remove the reader", "members": []core.PublicIdentity{owner.identity.Public}, "joins": []any{}}).(map[string]any)["group"].(groupauthority.View)
	bundle, err := core.CreateBundle(*owner.identity, "group-control", Content{"type": "group-control", "version": 1, "action": "snapshot", "groupId": groupID, "epoch": *changed.Head, "snapshot": map[string]any{"invalid": "private state"}}, []core.PublicIdentity{n.identity.Public}, false, groupcontrol.TTL)
	if err != nil {
		t.Fatal(err)
	}
	n.groupSync.receive(bundle, false)
	state := apply(t, n, "group-command", map[string]any{"action": "state", "groupId": groupID}).(map[string]any)["group"].(groupauthority.View)
	if state.Status != "removed" || state.Head.ID != changed.Head.ID {
		t.Fatal("invalid private data rolled back a verified removal")
	}
	if _, err = n.Handle("send", map[string]any{"operationId": operationFor(9511), "content": Content{"type": "message", "text": "Cannot cross the received fence", "conversation": groupID, "groupEpoch": oldEpoch, "groupAudience": "epoch"}, "recipients": []string{original.Author.ID}}); err == nil {
		t.Fatal("stale send passed after a valid removal with bad snapshot")
	}
}
