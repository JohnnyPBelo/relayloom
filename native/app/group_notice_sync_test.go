package app

import (
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupnotice"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func TestNoticeCancellationRecoversStaleStateOutsideRouterLock(t *testing.T) {
	n, _ := nodeFor(t, "Notice cancellation")
	n.cancel()
	n.wg.Wait()
	created := apply(t, n, "group-command", map[string]any{"action": "create", "operationId": operationFor(9710), "title": "Cancellation"}).(map[string]any)["group"].(groupauthority.View)
	reader, err := core.CreateIdentity("Invitation reader")
	if err != nil {
		t.Fatal(err)
	}
	apply(t, n, "group-command", map[string]any{"action": "invite", "operationId": operationFor(9711), "groupId": created.ID, "expected": created.Head.ID, "card": reader.Public})
	entries := apply(t, n, "group-command", map[string]any{"action": "notice-outbox"}).(map[string]any)["notices"].([]groupnotice.Entry)
	value, err := groupnotice.Parse(entries[0].Notice)
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := groupnotice.Seal(*n.identity, value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = n.Store.Put(bundle, false); err != nil {
		t.Fatal(err)
	}
	if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Normal, time.Minute, false); err != nil {
		t.Fatal(err)
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	previous := n.privateDigest
	n.privateDigest = strings.Repeat("0", 64) // a stale in-memory mirror, not disk corruption
	n.cancelStaleNoticesLocked()
	if n.identity == nil || n.privateDigest != previous {
		t.Fatal("cancellation did not recover the authenticated state")
	}
}
