package app

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func operationFor(index int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012x", index) }
func sendBody(index int, content Content, readers []string) map[string]any {
	return map[string]any{"operationId": operationFor(index), "content": map[string]any(content), "recipients": readers}
}
func sendFor(t *testing.T, n *Node, index int, content Content, readers []string) map[string]any {
	t.Helper()
	return apply(t, n, "send", sendBody(index, content, readers)).(map[string]any)
}
func outboxFor(t *testing.T, n *Node, operation string) map[string]any {
	t.Helper()
	state, err := n.State()
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range state["outbox"].([]map[string]any) {
		if item["operationId"] == operation {
			return item
		}
	}
	t.Fatal("outbox item absent")
	return nil
}
func restartFor(t *testing.T, n *Node) *Node {
	t.Helper()
	dir := n.Dir
	if err := n.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := NewNode(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { next.Close() })
	return next
}
func numberFor(t *testing.T, value any) int64 {
	t.Helper()
	n, err := number(value)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
func waitOutboxFor(t *testing.T, n *Node, operation, status string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		item := outboxFor(t, n, operation)
		if item["status"] == status {
			return item
		}
		time.Sleep(40 * time.Millisecond)
	}
	t.Fatalf("outbox did not become %s: %v", status, outboxFor(t, n, operation))
	return nil
}
func fixtureConfirmation(t *testing.T, author core.Identity, kind, target string, readers []core.PublicIdentity, public bool) core.Bundle {
	t.Helper()
	bundle, err := core.CreateBundle(author, kind, Content{"type": kind, "target": target}, readers, public, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	return bundle
}

func TestOutboxOfflineRestartRelayDisabledAndRecipientTCP(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	b, bob := nodeFor(t, "Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob})
	apply(t, a, "settings", map[string]any{"relay": false})
	apply(t, b, "settings", map[string]any{"relay": false})
	body := sendBody(1, Content{"type": "message", "text": "Durable offline secret"}, []string{bob.ID})
	result := apply(t, a, "send", body).(map[string]any)
	id := result["id"].(string)
	if result["accepted"] != true || !a.Store.IsPinned(id) {
		t.Fatal("offline send not durably reserved")
	}
	if numberFor(t, result["outbox"].(map[string]any)["attempts"]) != 0 {
		t.Fatal("offline transport attempt")
	}
	stored, err := a.Store.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	original, _ := core.Canonical(stored)
	privateBytes, err := os.ReadFile(filepath.Join(a.Dir, "private-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(privateBytes, []byte("Durable offline secret")) || bytes.Contains(privateBytes, []byte(operationFor(1))) || bytes.Contains(privateBytes, []byte(bob.ID)) {
		t.Fatal("private outbox leaked in cleartext")
	}
	a = restartFor(t, a)
	locked, err := a.State()
	if err != nil || len(locked["outbox"].([]map[string]any)) != 0 {
		t.Fatal("locked outbox leaked", err)
	}
	apply(t, a, "unlock", map[string]any{"password": password})
	duplicate := apply(t, a, "send", body).(map[string]any)
	if duplicate["id"] != id || duplicate["accepted"] != true {
		t.Fatal("restart lost idempotency")
	}
	stored, err = a.Store.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := core.Canonical(stored)
	if !bytes.Equal(original, after) {
		t.Fatal("restart changed signed bytes")
	}
	if err := a.Start(-1, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	if err := b.Start(0, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	apply(t, a, "connect", map[string]any{"host": "127.0.0.1", "port": b.TCPPort})
	received := waitOutboxFor(t, a, operationFor(1), "received")
	if numberFor(t, received["readCount"]) != 0 || a.Store.IsPinned(id) {
		t.Fatal("delivery treated as read, or automatic reserve retained")
	}
	apply(t, b, "view", map[string]any{"id": id})
	read := waitOutboxFor(t, a, operationFor(1), "read")
	if numberFor(t, read["recipientCount"]) != 1 || numberFor(t, read["readCount"]) != 1 {
		t.Fatal("recipient counts incorrect")
	}
	if findObject(objectsFor(t, b), id).Author.ID != alice.ID {
		t.Fatal("network content author changed")
	}
}

func TestOutboxIdempotencyAndValidation(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	body := sendBody(2, Content{"type": "message", "text": strings.Repeat("😀", 100)}, []string{bob.Public.ID, bob.Public.ID})
	first := apply(t, a, "send", body).(map[string]any)
	body["recipients"] = []string{bob.Public.ID}
	body["ttlMs"] = core.DefaultTTL
	again := apply(t, a, "send", body).(map[string]any)
	if first["id"] != again["id"] || len(a.Store.List()) != 1 {
		t.Fatal("equivalent request duplicated bundle")
	}
	if jsLen(text(again["outbox"].(map[string]any)["preview"])) != 160 {
		t.Fatal("preview exceeded UTF-16 bound")
	}
	body["content"] = map[string]any{"type": "message", "text": "changed"}
	if _, err := a.Handle("send", body); err == nil {
		t.Fatal("changed operation accepted")
	}
	for _, invalid := range []map[string]any{
		{"operationId": "00000000-0000-1000-8000-000000000003", "content": map[string]any{"type": "message", "text": "x"}, "recipients": []string{bob.Public.ID}},
		sendBody(3, Content{"type": "post", "text": "x"}, []string{bob.Public.ID}),
		sendBody(3, Content{"type": "message", "text": "x"}, []string{alice.ID}),
		{"operationId": operationFor(3), "content": map[string]any{"type": "message", "text": "x"}, "recipients": "public"},
	} {
		if _, err := a.Handle("send", invalid); err == nil {
			t.Fatal("invalid durable send accepted")
		}
	}
	if len(a.Store.List()) != 1 || len(a.private.Outbox) != 1 {
		t.Fatal("invalid operation mutated storage")
	}
	if _, ok := again["outbox"].(map[string]any)["fingerprint"]; ok {
		t.Fatal("internal fingerprint exposed")
	}
	if _, ok := again["outbox"].(map[string]any)["phase"]; ok {
		t.Fatal("internal phase exposed")
	}
	if _, ok := again["outbox"].(map[string]any)["confirmations"]; ok {
		t.Fatal("duplicate internal confirmation map exposed")
	}
}

func TestOutboxPreparingRecoveryMissingCorruptAndExpired(t *testing.T) {
	for _, mode := range []string{"ready-boundary", "missing-boundary", "corrupt", "expired"} {
		t.Run(mode, func(t *testing.T) {
			a, _ := nodeFor(t, "Sender")
			bob, _ := core.CreateIdentity("Recipient")
			apply(t, a, "contact", map[string]any{"contact": bob.Public})
			body := sendBody(4, Content{"type": "message", "text": "original"}, []string{bob.Public.ID})
			if mode == "expired" {
				body["ttlMs"] = 1000
			}
			result := apply(t, a, "send", body).(map[string]any)
			id := result["id"].(string)
			a.mu.Lock()
			if mode == "ready-boundary" || mode == "missing-boundary" {
				next, err := copyPrivate(a.private, a.identity.Public.ID)
				if err != nil {
					t.Fatal(err)
				}
				r := next.Outbox[operationFor(4)]
				r.Phase = "preparing"
				next.Outbox[r.OperationID] = r
				if err = a.persistPrivateLocked(next); err != nil {
					t.Fatal(err)
				}
			}
			a.mu.Unlock()
			if mode == "missing-boundary" {
				if err := a.Store.Remove(id); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "corrupt" {
				paths, err := filepath.Glob(filepath.Join(a.Dir, "store", "objects", id+".json"))
				if err != nil {
					t.Fatal(err)
				}
				if len(paths) != 1 {
					t.Fatal("object fixture path missing")
				}
				if err = os.WriteFile(paths[0], []byte("corrupt"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "expired" {
				time.Sleep(1100 * time.Millisecond)
			}
			a = restartFor(t, a)
			apply(t, a, "unlock", map[string]any{"password": password})
			again := apply(t, a, "send", body).(map[string]any)
			if again["id"] != id {
				t.Fatal("recovery regenerated original")
			}
			item := again["outbox"].(map[string]any)
			want := "unavailable"
			if mode == "ready-boundary" {
				want = "pending"
			}
			if mode == "expired" {
				want = "expired"
			}
			if item["status"] != want || again["accepted"] != (mode == "ready-boundary") {
				t.Fatalf("recovery status mismatch: %v", item)
			}
			retry := apply(t, a, "outbox-retry", map[string]any{"operationId": operationFor(4)}).(map[string]any)
			if retry["id"] != id || numberFor(t, retry["outbox"].(map[string]any)["attempts"]) != 0 {
				t.Fatal("retry regenerated or attempted unavailable/expired bytes")
			}
			if mode != "ready-boundary" && a.Store.IsPinned(id) {
				t.Fatal("automatic reserve not released")
			}
		})
	}
}

func TestOutboxStorageAndJournalFailureBoundaries(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	apply(t, a, "settings", map[string]any{"quota": 1024 * 1024})
	body := sendBody(5, Content{"type": "message", "text": "attachment", "attachments": []any{map[string]any{"name": "a.bin", "mime": "application/octet-stream", "data": strings.Repeat("A", 1200000)}}}, []string{bob.Public.ID})
	if _, err := a.Handle("send", body); err == nil {
		t.Fatal("over-quota send accepted")
	}
	item := outboxFor(t, a, operationFor(5))
	if item["status"] != "unavailable" || len(a.Store.List()) != 0 {
		t.Fatal("failed admission left accepted bytes")
	}
	again := apply(t, a, "send", body).(map[string]any)
	if again["accepted"] != false || again["id"] != item["id"] {
		t.Fatal("failed operation was not idempotent")
	}
	path := filepath.Join(a.Dir, "private-state.json")
	if err := os.Rename(path, path+".saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	body = sendBody(6, Content{"type": "message", "text": "journal failure"}, []string{bob.Public.ID})
	if _, err := a.Handle("send", body); err == nil {
		t.Fatal("failed journal accepted send")
	}
	if a.identity != nil || len(a.private.Outbox) != 0 || len(a.Store.List()) != 0 {
		t.Fatal("uncertain journal failure did not lock before further writes")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path+".saved", path); err != nil {
		t.Fatal(err)
	}
	apply(t, a, "unlock", map[string]any{"password": password})
	if outboxFor(t, a, operationFor(5))["status"] != "unavailable" {
		t.Fatal("recovering journal lost the earlier operation")
	}
}

func TestOutboxConfirmationsPerMemberACLReplayAndHistory(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Bob")
	carol, _ := core.CreateIdentity("Carol")
	eve, _ := core.CreateIdentity("Eve")
	for _, p := range []core.PublicIdentity{bob.Public, carol.Public} {
		apply(t, a, "contact", map[string]any{"contact": p})
	}
	result := sendFor(t, a, 7, Content{"type": "message", "text": "two recipients"}, []string{bob.Public.ID, carol.Public.ID})
	id := result["id"].(string)
	readers := []core.PublicIdentity{alice, bob.Public, carol.Public}
	for _, fake := range []core.Bundle{
		fixtureConfirmation(t, eve, "delivery", id, append(readers, eve.Public), false),
		fixtureConfirmation(t, bob, "delivery", id, nil, true),
		fixtureConfirmation(t, bob, "delivery", id, []core.PublicIdentity{alice}, false),
		fixtureConfirmation(t, *a.identity, "delivery", id, readers, false),
		fixtureConfirmation(t, bob, "delivery", core.Hash([]byte("other target")), readers, false),
	} {
		if err := receiveBundleFor(t, a, fake); err != nil {
			t.Fatal(err)
		}
	}
	if numberFor(t, outboxFor(t, a, operationFor(7))["receivedCount"]) != 0 {
		t.Fatal("forgery advanced recipient state")
	}
	delivery, err := core.CreateBundleAt(bob, "delivery", Content{"type": "delivery", "target": id}, readers, false, core.DefaultTTL, time.Now().Add(-24*time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()
	if err := receiveBundleFor(t, a, delivery); err != nil {
		t.Fatal(err)
	}
	partial := outboxFor(t, a, operationFor(7))
	if partial["status"] != "pending" || numberFor(t, partial["receivedCount"]) != 1 || !a.Store.IsPinned(id) {
		t.Fatal("partial delivery completed group")
	}
	firstAt := a.private.Outbox[operationFor(7)].Confirmations[bob.Public.ID].ReceivedAt
	if firstAt < before || firstAt > time.Now().UnixMilli() {
		t.Fatal("confirmation did not use local observation clock")
	}
	if err := receiveBundleFor(t, a, delivery); err != nil {
		t.Fatal(err)
	}
	reissue := fixtureConfirmation(t, bob, "delivery", id, readers, false)
	if err := receiveBundleFor(t, a, reissue); err != nil {
		t.Fatal(err)
	}
	if a.private.Outbox[operationFor(7)].Confirmations[bob.Public.ID].ReceivedAt != firstAt {
		t.Fatal("replay/reissue changed first timestamp")
	}
	readCarol := fixtureConfirmation(t, carol, "receipt", id, readers, false)
	if _, err := a.Store.Put(readCarol, false); err != nil {
		t.Fatal(err)
	}
	// A receipt outside the latest 100 objects must still be aggregated.
	for i := 0; i < 105; i++ {
		bundle, err := core.CreateBundle(*a.identity, "post", Content{"type": "post", "text": fmt.Sprint(i)}, nil, true, core.DefaultTTL)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.Store.Put(bundle, false); err != nil {
			t.Fatal(err)
		}
	}
	state, err := a.State()
	if err != nil {
		t.Fatal(err)
	}
	if len(state["objects"].([]DisplayObject)) != 100 || findObject(state["objects"].([]DisplayObject), readCarol.Manifest.ID) != nil {
		t.Fatal("history fixture not paginated")
	}
	received := outboxFor(t, a, operationFor(7))
	if received["status"] != "received" || numberFor(t, received["readCount"]) != 1 || a.Store.IsPinned(id) {
		t.Fatal("read did not imply received for every member")
	}
	readBob := fixtureConfirmation(t, bob, "receipt", id, readers, false)
	if err := receiveBundleFor(t, a, readBob); err != nil {
		t.Fatal(err)
	}
	if outboxFor(t, a, operationFor(7))["status"] != "read" {
		t.Fatal("all reads not aggregated")
	}
	for _, event := range []core.Bundle{delivery, reissue, readBob, readCarol} {
		if err := a.Store.Remove(event.Manifest.ID); err != nil {
			t.Fatal(err)
		}
	}
	a = restartFor(t, a)
	apply(t, a, "unlock", map[string]any{"password": password})
	if outboxFor(t, a, operationFor(7))["status"] != "read" || a.private.Outbox[operationFor(7)].Confirmations[bob.Public.ID].ReceivedAt != firstAt {
		t.Fatal("receipt eviction/restart regressed confirmations")
	}
}

func TestOutboxBlockedGroupViewAndManualPin(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	b, bob := nodeFor(t, "Bob")
	carol, _ := core.CreateIdentity("Carol")
	for _, p := range []core.PublicIdentity{bob, carol.Public} {
		apply(t, a, "contact", map[string]any{"contact": p})
	}
	cards := []core.PublicIdentity{alice, bob, carol.Public}
	group, err := core.CreateBundle(carol, "group", Content{"type": "group", "title": "Fixed group created by Carol", "members": cards}, cards, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range []*Node{a, b} {
		if _, err := node.Store.Put(group, true); err != nil {
			t.Fatal(err)
		}
	}
	result := sendFor(t, a, 8, Content{"type": "message", "text": "group", "conversation": group.Manifest.ID, "attachments": []any{map[string]any{"name": "a.txt", "mime": "text/plain", "data": "aGk="}}}, []string{bob.ID, carol.Public.ID})
	id := result["id"].(string)
	if _, err := a.Handle("action", map[string]any{"action": "pin", "target": id, "value": false}); err == nil {
		t.Fatal("pending reserve unpinned")
	}
	apply(t, a, "action", map[string]any{"action": "pin", "target": id, "value": true})
	apply(t, a, "action", map[string]any{"action": "block", "target": carol.Public.ID, "value": true})
	blocked := outboxFor(t, a, operationFor(8))
	if blocked["status"] != "blocked" || !a.Store.IsPinned(id) || !pendingOutbox(a.private.Outbox[operationFor(8)], time.Now().UnixMilli()) {
		t.Fatal("blocked pending lost reserve")
	}
	transfer(t, a, b, id)
	apply(t, b, "action", map[string]any{"action": "block", "target": carol.Public.ID, "value": true})
	view := apply(t, b, "view", map[string]any{"id": id}).(DisplayObject)
	if view.ID != id {
		t.Fatal("blocked group denied view")
	}
	visible := objectsFor(t, b)
	if findObject(visible, id) == nil || findObject(visible, group.Manifest.ID) != nil {
		t.Fatal("blocked creator invalidated another author's message, or leaked its own group")
	}
	if _, err := b.Handle("view", map[string]any{"id": group.Manifest.ID}); err == nil {
		t.Fatal("dependency allowance exposed blocked creator's object")
	}
	attachment := apply(t, b, "attachment", map[string]any{"id": id, "index": 0}).(map[string]any)
	if attachment["data"] != "aGk=" {
		t.Fatal("blocked group denied attachment")
	}
	b.mu.Lock()
	b.syncLocked()
	b.mu.Unlock()
	for _, m := range b.Store.List() {
		if m.Kind == "receipt" || m.Kind == "delivery" {
			t.Fatal("automatic confirmation widened blocked reader roster")
		}
	}
	apply(t, b, "action", map[string]any{"action": "block", "target": carol.Public.ID, "value": false})
	// A failed automatic confirmation cannot fail a successful view.
	if err := b.Router.Close(); err != nil {
		t.Fatal(err)
	}
	apply(t, b, "view", map[string]any{"id": id})
	apply(t, a, "action", map[string]any{"action": "block", "target": carol.Public.ID, "value": false})
	for _, who := range []core.Identity{*b.identity, carol} {
		event := fixtureConfirmation(t, who, "delivery", id, []core.PublicIdentity{alice, bob, carol.Public}, false)
		if err := receiveBundleFor(t, a, event); err != nil {
			t.Fatal(err)
		}
	}
	if outboxFor(t, a, operationFor(8))["status"] != "received" || !a.Store.IsPinned(id) {
		t.Fatal("automatic release lost manual pin")
	}
	apply(t, a, "action", map[string]any{"action": "pin", "target": id, "value": false})
	if a.Store.IsPinned(id) {
		t.Fatal("terminal manual unpin failed")
	}
}

func TestOutboxAttemptFailureAndRetryPolicy(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Bob")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	result := sendFor(t, a, 9, Content{"type": "message", "text": "saved"}, []string{bob.Public.ID})
	if err := a.Router.Close(); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	now := time.Now().UnixMilli()
	if err := a.attemptOutboxLocked(operationFor(9), now); err != nil {
		t.Fatal(err)
	}
	r := a.private.Outbox[operationFor(9)]
	if r.Attempts != 1 || r.NextAttemptAt != now+2200 || r.LastError == "" {
		t.Fatal("failed transport attempt was not journalled safely")
	}
	if err := a.attemptOutboxLocked(operationFor(9), now+1); err != nil {
		t.Fatal(err)
	}
	if a.private.Outbox[operationFor(9)].Attempts != 1 {
		t.Fatal("retry bypassed backoff")
	}
	if err := a.attemptOutboxLocked(operationFor(9), now+2200); err != nil {
		t.Fatal(err)
	}
	if a.private.Outbox[operationFor(9)].NextAttemptAt != now+2200+4400 {
		t.Fatal("retry backoff did not grow")
	}
	a.mu.Unlock()
	item := outboxFor(t, a, operationFor(9))
	if result["accepted"] != true || item["accepted"] != true || item["status"] != "pending" {
		t.Fatal("transport error undid local acceptance")
	}
	if retryDelay(1000000) != 60000 || retryDelay(1) != 2200 {
		t.Fatal("retry cap invalid")
	}
}

func TestOutboxAutomaticDeliveryBoundAndEvictionReissue(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	b, bob := nodeFor(t, "Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob})
	for i := 10; i < 14; i++ {
		result := sendFor(t, a, i, Content{"type": "message", "text": fmt.Sprint(i)}, []string{bob.ID})
		transfer(t, a, b, result["id"].(string))
	}
	apply(t, b, "settings", map[string]any{"relay": false})
	b.mu.Lock()
	b.syncLocked()
	b.mu.Unlock()
	deliveries := []core.Manifest{}
	for _, m := range b.Store.List() {
		if m.Kind == "delivery" {
			deliveries = append(deliveries, m)
		}
	}
	if len(deliveries) != 2 {
		t.Fatalf("automatic issuance exceeded/perished bound: %d", len(deliveries))
	}
	b.mu.Lock()
	b.syncLocked()
	b.mu.Unlock()
	count := 0
	for _, m := range b.Store.List() {
		if m.Kind == "delivery" {
			count++
		}
	}
	if count != 4 {
		t.Fatal("retained delivery did not suppress duplicates")
	}
	if err := b.Store.Remove(deliveries[0].ID); err != nil {
		t.Fatal(err)
	}
	b.mu.Lock()
	b.syncLocked()
	b.mu.Unlock()
	count = 0
	for _, m := range b.Store.List() {
		if m.Kind == "delivery" {
			count++
		}
	}
	if count != 4 {
		t.Fatal("evicted delivery did not permit bounded reissue")
	}
	// An intermediary without the private reader key never acknowledges receipt.
	c, _ := nodeFor(t, "Intermediary")
	for _, m := range a.Store.List() {
		transfer(t, a, c, m.ID)
	}
	c.mu.Lock()
	c.syncLocked()
	c.mu.Unlock()
	for _, m := range c.Store.List() {
		if (m.Kind == "delivery" || m.Kind == "receipt") && m.Author.ID != alice.ID {
			t.Fatal("unreadable intermediary issued receipt")
		}
	}
}

func TestOutboxRestoredSchemaBoundsAndPendingAdmission(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	sendFor(t, a, 20, Content{"type": "message", "text": "seed"}, []string{bob.Public.ID})
	a.mu.Lock()
	seed := a.private.Outbox[operationFor(20)]
	a.mu.Unlock()
	for _, mutate := range []func(map[string]any){
		func(m map[string]any) { delete(m, "manualPin") },
		func(m map[string]any) { m["author"] = bob.Public.ID },
		func(m map[string]any) { m["phase"] = "delivered" },
		func(m map[string]any) { m["priority"] = "urgent" },
		func(m map[string]any) { m["preview"] = strings.Repeat("😀", 81) },
		func(m map[string]any) { m["lastError"] = strings.Repeat("x", 241) },
		func(m map[string]any) { m["created"] = -1 },
		func(m map[string]any) { m["attempts"] = outboxAttemptLimit + 1 },
		func(m map[string]any) { m["bytes"] = core.MaxBundleBytes + 1 },
		func(m map[string]any) { m["confirmations"] = map[string]any{seed.Author: map[string]any{}} },
		func(m map[string]any) {
			m["confirmations"] = map[string]any{bob.Public.ID: map[string]any{"readAt": time.Now().UnixMilli()}}
		},
	} {
		value, _ := cloneValue(seed)
		record, _ := object(value)
		mutate(record)
		if _, err := parseOutbox(map[string]any{seed.OperationID: record}, seed.Author, time.Now().UnixMilli()); err == nil {
			t.Fatal("invalid journal record restored")
		}
	}
	makeRecords := func(count int, size int64, terminal bool) map[string]any {
		result := map[string]any{}
		for i := 0; i < count; i++ {
			r := seed
			r.OperationID = operationFor(100 + i)
			r.ID = core.Hash([]byte(r.OperationID))
			r.Bytes = size
			if terminal {
				r.Phase = "unavailable"
			}
			v, _ := cloneValue(r)
			result[r.OperationID] = v
		}
		return result
	}
	if _, err := parseOutbox(makeRecords(129, seed.Bytes, false), seed.Author, time.Now().UnixMilli()); err == nil {
		t.Fatal("129 pending restored")
	}
	if _, err := parseOutbox(makeRecords(9, 4*1024*1024, false), seed.Author, time.Now().UnixMilli()); err == nil {
		t.Fatal("over 32 MiB pending restored")
	}
	if _, err := parseOutbox(makeRecords(257, seed.Bytes, true), seed.Author, time.Now().UnixMilli()); err == nil {
		t.Fatal("257 total restored")
	}
	if _, err := parseOutbox(makeRecords(128, seed.Bytes, false), seed.Author, time.Now().UnixMilli()); err != nil {
		t.Fatal("128 pending rejected", err)
	}
	// Fill the real pinned store and persist once; admission may not evict a
	// pending operation, even while the reader is blocked.
	a.mu.Lock()
	next, err := copyPrivate(a.private, a.identity.Public.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 127; i++ {
		prepared, err := a.prepareLocked(Content{"type": "message", "text": fmt.Sprint(i)}, []string{bob.Public.ID}, 0)
		if err != nil {
			t.Fatal(err)
		}
		bundle := prepared.bundle
		if _, err := a.Store.Put(bundle, true); err != nil {
			t.Fatal(err)
		}
		encoded, _ := core.Canonical(bundle)
		r := seed
		r.OperationID = operationFor(1000 + i)
		r.ID = bundle.Manifest.ID
		r.Created = bundle.Manifest.Created
		r.Expires = bundle.Manifest.Expires
		r.Bytes = int64(len(encoded))
		r.Preview = fmt.Sprint(i)
		next.Outbox[r.OperationID] = r
	}
	if err := a.persistPrivateLocked(next); err != nil {
		t.Fatal(err)
	}
	a.mu.Unlock()
	if _, err := a.Handle("send", sendBody(9999, Content{"type": "message", "text": "overflow"}, []string{bob.Public.ID})); err == nil {
		t.Fatal("129th pending admitted")
	}
	if len(a.private.Outbox) != 128 || len(a.Store.List()) != 128 {
		t.Fatal("pending admission evicted an intent")
	}
	apply(t, a, "action", map[string]any{"action": "block", "target": bob.Public.ID, "value": true})
	for _, r := range a.private.Outbox {
		if !pendingOutbox(r, time.Now().UnixMilli()) || !a.Store.IsPinned(r.ID) {
			t.Fatal("blocked pending was terminal")
		}
	}
}

func TestOutboxTerminalMetadataEvictsOldestOnly(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	sendFor(t, a, 30, Content{"type": "message", "text": "pending seed"}, []string{bob.Public.ID})
	a.mu.Lock()
	seed := a.private.Outbox[operationFor(30)]
	next, err := copyPrivate(a.private, a.identity.Public.ID)
	if err != nil {
		t.Fatal(err)
	}
	oldest := ""
	for i := 0; i < 255; i++ {
		r := seed
		r.OperationID = operationFor(2000 + i)
		r.ID = core.Hash([]byte(r.OperationID))
		r.Phase = "unavailable"
		r.Created -= int64(1000 - i)
		r.Expires -= int64(1000 - i)
		next.Outbox[r.OperationID] = r
		if i == 0 {
			oldest = r.OperationID
		}
	}
	if err = a.persistPrivateLocked(next); err != nil {
		t.Fatal(err)
	}
	a.mu.Unlock()
	sendFor(t, a, 31, Content{"type": "message", "text": "admit"}, []string{bob.Public.ID})
	if len(a.private.Outbox) != 256 {
		t.Fatal("metadata bound exceeded")
	}
	if _, ok := a.private.Outbox[oldest]; ok {
		t.Fatal("oldest terminal metadata retained")
	}
	if _, ok := a.private.Outbox[operationFor(30)]; !ok || !a.Store.IsPinned(seed.ID) {
		t.Fatal("pending intent evicted for metadata")
	}
}

func TestOutboxReadSurvivesAdmissionEvictingOriginal(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	limited, err := core.NewContentStore(filepath.Join(a.Dir, "receipt-eviction"), core.DefaultQuota, 2)
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	a.Store = limited
	a.mu.Unlock()
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	result := sendFor(t, a, 40, Content{"type": "message", "text": "receipt eviction boundary"}, []string{bob.Public.ID})
	id := result["id"].(string)
	time.Sleep(5 * time.Millisecond)
	delivery := fixtureConfirmation(t, bob, "delivery", id, []core.PublicIdentity{alice, bob.Public}, false)
	if err = receiveBundleFor(t, a, delivery); err != nil {
		t.Fatal(err)
	}
	if outboxFor(t, a, operationFor(40))["status"] != "received" || a.Store.IsPinned(id) {
		t.Fatal("delivery fixture did not release reserve")
	}
	// Unpin touches the original; make the receipt newer so admission chooses
	// the original as the unpinned LRU entry.
	time.Sleep(5 * time.Millisecond)
	if _, err = a.Store.Get(delivery.Manifest.ID); err != nil {
		t.Fatal(err)
	}
	read := fixtureConfirmation(t, bob, "receipt", id, []core.PublicIdentity{alice, bob.Public}, false)
	if err = receiveBundleFor(t, a, read); err != nil {
		t.Fatal(err)
	}
	if a.Store.Has(id) {
		t.Fatal("read admission fixture did not evict original")
	}
	if outboxFor(t, a, operationFor(40))["status"] != "read" {
		t.Fatal("authorized read lost at store admission boundary")
	}
}

func TestOutboxByteReserveRejectsAdmissionWithoutEviction(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	content := Content{"type": "message", "text": "large private reserve", "attachments": []any{map[string]any{"name": "reserve.bin", "mime": "application/octet-stream", "data": strings.Repeat("A", 3000000)}}}
	for i := 0; i < 8; i++ {
		sendFor(t, a, 10000+i, content, []string{bob.Public.ID})
	}
	if _, err := a.Handle("send", sendBody(10008, content, []string{bob.Public.ID})); err == nil {
		t.Fatal("over 32 MiB pending send admitted")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	used := int64(0)
	for _, record := range a.private.Outbox {
		used += record.Bytes
		if !a.Store.IsPinned(record.ID) {
			t.Fatal("existing pending bytes evicted")
		}
	}
	if len(a.private.Outbox) != 8 || len(a.Store.List()) != 8 || used > outboxBytesLimit {
		t.Fatal("failed byte admission mutated reserve")
	}
}

func TestOutboxFlushBoundsPriorityAndLockedSuppression(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	b, bob := nodeFor(t, "Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob})
	priorities := []string{"bulk", "normal", "sos", "bulk", "normal", "sos"}
	for i, priority := range priorities {
		sendFor(t, a, 11000+i, Content{"type": "message", "text": fmt.Sprint(i), "priority": priority}, []string{bob.ID})
	}
	if err := b.Start(0, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	apply(t, a, "connect", map[string]any{"host": "127.0.0.1", "port": b.TCPPort})
	deadline := time.Now().Add(3 * time.Second)
	for {
		a.mu.Lock()
		if a.connectedOutboxLocked() {
			break
		}
		a.mu.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("TCP fixture did not connect")
		}
		time.Sleep(10 * time.Millisecond)
	}
	a.flushOutboxLocked(time.Now().UnixMilli())
	for i, priority := range priorities {
		r := a.private.Outbox[operationFor(11000+i)]
		want := int64(0)
		if priority == "sos" {
			want = 1
		}
		if r.Attempts != want {
			t.Fatalf("flush exceeded two/SOS ordering: %s=%d", priority, r.Attempts)
		}
	}
	a.mu.Unlock()
	apply(t, a, "lock", map[string]any{})
	a.mu.Lock()
	a.syncLocked()
	if len(a.private.Outbox) != 0 {
		t.Fatal("locked sync exposed durable journal")
	}
	a.mu.Unlock()
	state, err := a.State()
	if err != nil || len(state["outbox"].([]map[string]any)) != 0 {
		t.Fatal("locked snapshot exposed outbox", err)
	}
	policy := state["outboxPolicy"].(map[string]any)
	if policy["idempotency"] != "retained-records" || numberFor(t, policy["maxRecords"]) != 256 || numberFor(t, policy["maxPending"]) != 128 || numberFor(t, policy["maxPendingBytes"]) != 32*1024*1024 {
		t.Fatal("retained-operation policy absent while locked")
	}
}

func TestOutboxHistoricalConfirmationSurvivesContentExpiry(t *testing.T) {
	a, alice := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	body := sendBody(12000, Content{"type": "message", "text": "short lived confirmed"}, []string{bob.Public.ID})
	body["ttlMs"] = 1000
	result := apply(t, a, "send", body).(map[string]any)
	id := result["id"].(string)
	read := fixtureConfirmation(t, bob, "receipt", id, []core.PublicIdentity{alice, bob.Public}, false)
	if err := receiveBundleFor(t, a, read); err != nil {
		t.Fatal(err)
	}
	if outboxFor(t, a, operationFor(12000))["status"] != "read" {
		t.Fatal("read not observed before expiry")
	}
	time.Sleep(1100 * time.Millisecond)
	a = restartFor(t, a)
	apply(t, a, "unlock", map[string]any{"password": password})
	item := outboxFor(t, a, operationFor(12000))
	if item["status"] != "read" || item["contentExpired"] != true || item["retained"] != false || item["accepted"] != false {
		t.Fatal("expiry regressed historical confirmation", item)
	}
}

func TestOutboxAfterWriteErrorRetainsOperation(t *testing.T) {
	for _, failureAt := range []int{1, 2} {
		t.Run(fmt.Sprint(failureAt), func(t *testing.T) {
			a, _ := nodeFor(t, "Sender")
			bob, _ := core.CreateIdentity("Recipient")
			apply(t, a, "contact", map[string]any{"contact": bob.Public})
			writes := 0
			injected := errors.New("injected error after persisted rename")
			a.mu.Lock()
			a.writePrivateFile = func(path string, next PrivateState, identity core.Identity) error {
				if err := writePrivate(path, next, identity); err != nil {
					return err
				}
				writes++
				if writes == failureAt {
					return injected
				}
				return nil
			}
			a.mu.Unlock()
			body := sendBody(13000, Content{"type": "message", "text": "uncertain completion"}, []string{bob.Public.ID})
			if _, err := a.Handle("send", body); !errors.Is(err, injected) {
				t.Fatal("original persistence error was not preserved", err)
			}
			a.mu.Lock()
			record, exists := a.private.Outbox[operationFor(13000)]
			a.writePrivateFile = nil
			unlocked := a.identity != nil
			a.mu.Unlock()
			if !exists || !unlocked {
				t.Fatal("successful authenticated readback lost operation")
			}
			again := apply(t, a, "send", body).(map[string]any)
			if again["id"] != record.ID || again["accepted"] != (failureAt == 2) {
				t.Fatal("ambiguous completion regenerated or falsely accepted", again)
			}
			if numberFor(t, again["outbox"].(map[string]any)["attempts"]) != 0 {
				t.Fatal("broadcast before recovered acceptance")
			}
			a = restartFor(t, a)
			apply(t, a, "unlock", map[string]any{"password": password})
			if apply(t, a, "send", body).(map[string]any)["id"] != record.ID {
				t.Fatal("readback operation changed after restart")
			}
		})
	}
}

func TestOutboxUnreadableUncertainWriteLocksUntilRecovery(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	var saved []byte
	var operationID string
	injected := errors.New("injected uncertain persistence")
	a.mu.Lock()
	a.writePrivateFile = func(path string, next PrivateState, identity core.Identity) error {
		if err := writePrivate(path, next, identity); err != nil {
			return err
		}
		var err error
		saved, err = os.ReadFile(path)
		if err != nil {
			return err
		}
		operationID = next.Outbox[operationFor(14000)].ID
		if err = os.WriteFile(path, []byte("unreadable encrypted state"), 0600); err != nil {
			return err
		}
		return injected
	}
	a.mu.Unlock()
	body := sendBody(14000, Content{"type": "message", "text": "must not overwrite unknown state"}, []string{bob.Public.ID})
	if _, err := a.Handle("send", body); !errors.Is(err, injected) {
		t.Fatal("original uncertain error lost", err)
	}
	state, err := a.State()
	if err != nil || state["locked"] != true || len(state["outbox"].([]map[string]any)) != 0 {
		t.Fatal("failed readback did not lock", err)
	}
	if _, err := a.Handle("send", body); err == nil {
		t.Fatal("new write overwrote uncertain journal")
	}
	if len(a.Store.List()) != 0 {
		t.Fatal("uncertain preparation admitted bytes")
	}
	a.mu.Lock()
	a.writePrivateFile = nil
	a.mu.Unlock()
	if err := os.WriteFile(filepath.Join(a.Dir, "private-state.json"), saved, 0600); err != nil {
		t.Fatal(err)
	}
	apply(t, a, "unlock", map[string]any{"password": password})
	again := apply(t, a, "send", body).(map[string]any)
	if again["id"] != operationID || again["accepted"] != false {
		t.Fatal("recovered uncertain preparation regenerated bundle")
	}
}

func TestOutboxWarmStateDoesNotRehydrateReservedAttachment(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	result := sendFor(t, a, 15000, Content{"type": "message", "text": "warm metadata", "attachments": []any{map[string]any{"name": "large.bin", "mime": "application/octet-stream", "data": strings.Repeat("A", 2500000)}}}, []string{bob.Public.ID})
	if _, err := a.State(); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	var baseline, before, after runtime.MemStats
	runtime.ReadMemStats(&baseline)
	_ = a.Store.List()
	runtime.ReadMemStats(&before)
	state, err := a.stateLocked()
	runtime.ReadMemStats(&after)
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	// Store.List intentionally reads/hashes encrypted bytes to reject changed
	// disk content. Snapshot overhead beyond that verification must remain
	// metadata-sized; no repeated List, JSON body parsing or decryption.
	verification := before.TotalAlloc - baseline.TotalAlloc
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > verification+1024*1024 {
		t.Fatalf("warm outbox state rehydrated reserved attachment: %d allocated bytes beyond %d verification baseline", allocated, verification)
	}
	object := findObject(state["objects"].([]DisplayObject), result["id"].(string))
	if object == nil || text(object.Content["attachments"].([]any)[0].(map[string]any)["data"]) != "" {
		t.Fatal("snapshot leaked attachment body")
	}
	// Fresh manifest verification must still reject on-disk changes after the
	// metadata cache has warmed.
	id := result["id"].(string)
	if err := os.WriteFile(filepath.Join(a.Dir, "store", "objects", id+".json"), []byte("corrupt after warm snapshot"), 0600); err != nil {
		t.Fatal(err)
	}
	if outboxFor(t, a, operationFor(15000))["status"] != "unavailable" {
		t.Fatal("warm snapshot trusted stale reserved bytes")
	}
}

func TestOutboxManualRetryCooldownAndOfflineDueCheckpoint(t *testing.T) {
	a, _ := nodeFor(t, "Sender")
	bob, _ := core.CreateIdentity("Recipient")
	apply(t, a, "contact", map[string]any{"contact": bob.Public})
	sendFor(t, a, 16000, Content{"type": "message", "text": "manual offline retry"}, []string{bob.Public.ID})
	retry := apply(t, a, "outbox-retry", map[string]any{"operationId": operationFor(16000)}).(map[string]any)["outbox"].(map[string]any)
	if numberFor(t, retry["attempts"]) != 0 || numberFor(t, retry["nextAttemptAt"]) == 0 {
		t.Fatal("offline manual retry did not preserve due checkpoint")
	}
	apply(t, a, "lock", map[string]any{})
	apply(t, a, "unlock", map[string]any{"password": password})
	a.mu.Lock()
	next, err := copyPrivate(a.private, a.identity.Public.ID)
	if err != nil {
		t.Fatal(err)
	}
	r := next.Outbox[operationFor(16000)]
	r.Attempts = 8
	r.LastAttemptAt = time.Now().UnixMilli()
	r.NextAttemptAt = r.LastAttemptAt + 60000
	next.Outbox[r.OperationID] = r
	if err := a.persistPrivateLocked(next); err != nil {
		t.Fatal(err)
	}
	a.mu.Unlock()
	if _, err := a.Handle("outbox-retry", map[string]any{"operationId": operationFor(16000)}); err == nil {
		t.Fatal("manual retry bypassed 2.2 second cooldown")
	}
	a.mu.Lock()
	next, err = copyPrivate(a.private, a.identity.Public.ID)
	if err != nil {
		t.Fatal(err)
	}
	r = next.Outbox[operationFor(16000)]
	r.LastAttemptAt -= 3000
	next.Outbox[r.OperationID] = r
	if err = a.persistPrivateLocked(next); err != nil {
		t.Fatal(err)
	}
	a.mu.Unlock()
	before := time.Now().UnixMilli()
	retry = apply(t, a, "outbox-retry", map[string]any{"operationId": operationFor(16000)}).(map[string]any)["outbox"].(map[string]any)
	if due := numberFor(t, retry["nextAttemptAt"]); due < before || due > time.Now().UnixMilli() || numberFor(t, retry["attempts"]) != 8 {
		t.Fatal("manual retry did not shorten elapsed automatic backoff safely")
	}
}

func TestOutboxSnapshotExpiryDuringJournalWriteKeepsReservationConsistent(t *testing.T) {
	for _, responseKind := range []string{"state", "send", "retry"} {
		t.Run(responseKind, func(t *testing.T) {
			a, _ := nodeFor(t, "Snapshot sender")
			bob, _ := core.CreateIdentity("Snapshot recipient")
			apply(t, a, "contact", map[string]any{"contact": bob.Public})
			body := sendBody(16000, Content{"type": "message", "text": "expires during snapshot persistence"}, []string{bob.Public.ID})
			body["ttlMs"] = 3000
			result := apply(t, a, "send", body).(map[string]any)
			id := result["id"].(string)
			a.mu.Lock()
			defer a.mu.Unlock()
			next, err := copyPrivate(a.private, a.identity.Public.ID)
			if err != nil {
				t.Fatal(err)
			}
			r := next.Outbox[operationFor(16000)]
			r.Phase = "preparing"
			next.Outbox[r.OperationID] = r
			if err = a.persistPrivateLocked(next); err != nil {
				t.Fatal(err)
			}
			if r.Expires <= time.Now().UnixMilli() {
				t.Fatal("fixture expired before the snapshot boundary")
			}
			crossedDeadline := false
			a.writePrivateFile = func(path string, state PrivateState, identity core.Identity) error {
				if state.Outbox[r.OperationID].Phase == "ready" && !crossedDeadline {
					time.Sleep(time.Until(time.UnixMilli(r.Expires + 25)))
					crossedDeadline = true
				}
				return writePrivate(path, state, identity)
			}
			defer func() { a.writePrivateFile = nil }()
			var entry map[string]any
			if responseKind == "state" {
				state, stateErr := a.stateLocked()
				err = stateErr
				if err == nil {
					entry = state["outbox"].([]map[string]any)[0]
				}
			} else {
				var response any
				if responseKind == "send" {
					response, err = a.sendLocked(body)
				} else {
					response, err = a.retryOutboxLocked(r.OperationID)
				}
				if err == nil {
					entry = response.(map[string]any)["outbox"].(map[string]any)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if !crossedDeadline || time.Now().UnixMilli() <= r.Expires {
				t.Fatal("control did not cross expiry during the actual journal write")
			}
			if entry["status"] == "expired" && a.Store.IsPinned(id) {
				t.Fatal("response advertises expiry before releasing the automatic reservation")
			}
			a.writePrivateFile = nil
			state, err := a.stateLocked()
			if err != nil {
				t.Fatal(err)
			}
			entry = state["outbox"].([]map[string]any)[0]
			if entry["status"] != "expired" || a.Store.IsPinned(id) {
				t.Fatal("subsequent snapshot did not expire and release the original reservation")
			}
			if entry["id"] != id || numberFor(t, entry["receivedCount"]) != 0 {
				t.Fatal("expiry changed the original id or fabricated delivery")
			}
		})
	}
}
