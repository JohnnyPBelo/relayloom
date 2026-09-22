package transport

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestLocalCancellationRemovesQueuedTCPAndReconnectCopy(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		name := "cancel"
		if !cancel {
			name = "negative-control-delivers"
		}
		t.Run(name, func(t *testing.T) {
			sender := routerFor(t, Options{})
			receiver := routerFor(t, Options{DisableRelay: true})
			sender.SetLowPower(true)
			address, err := receiver.ListenTCP("127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			disconnect, err := sender.ConnectTCP(address.String())
			if err != nil {
				t.Fatal(err)
			}
			defer disconnect()
			waitFor(t, time.Second, func() bool { return len(sender.Peers()) == 1 })
			if _, err := sender.Broadcast(map[string]any{"kind": "cancelled", "body": strings.Repeat("q", 60000)}, Bulk, 10*time.Second, false); err != nil {
				t.Fatal(err)
			}
			if sender.Peers()[0].Queued == 0 {
				t.Fatal("fixture did not queue a real transfer")
			}
			match := func(payload any) bool { m, ok := payload.(map[string]any); return ok && m["kind"] == "cancelled" }
			if cancel {
				if sender.CancelLocal(match) != 1 || sender.CancelLocal(match) != 0 || sender.Peers()[0].Queued != 0 {
					t.Fatal("pending or retained copy survived cancellation")
				}
			}
			if _, err := sender.Broadcast(map[string]any{"kind": "witness"}, Normal, 10*time.Second, false); err != nil {
				t.Fatal(err)
			}
			sender.SetLowPower(false)
			read := func(r *Router) {
				t.Helper()
				count := 1
				if !cancel {
					count = 2
				}
				witness, delivered := false, false
				for i := 0; i < count; i++ {
					got := nextFor(t, r)
					witness = witness || strings.Contains(string(got.Payload), "witness")
					delivered = delivered || strings.Contains(string(got.Payload), "cancelled")
				}
				if !witness || delivered == cancel {
					t.Fatal("missing positive witness or wrong cancelled-packet result")
				}
				ctx, done := context.WithTimeout(context.Background(), 300*time.Millisecond)
				defer done()
				if _, err := r.Next(ctx); err == nil {
					t.Fatal("unexpected extra packet")
				}
			}
			read(receiver)
			receiver.Close()
			replacement := routerFor(t, Options{DisableRelay: true})
			if _, err := replacement.ListenTCP(address.String()); err != nil {
				t.Fatal(err)
			}
			read(replacement)
		})
	}
}

func TestLocalCancellationPreservesForeignOriginRelay(t *testing.T) {
	a := routerFor(t, Options{})
	b := routerFor(t, Options{})
	c := routerFor(t, Options{DisableRelay: true})
	b.SetLowPower(true)
	address, err := b.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	disconnect, err := a.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	defer disconnect()
	waitFor(t, time.Second, func() bool { return len(a.Peers()) == 1 })
	if _, err := a.Broadcast(map[string]any{"kind": "foreign origin"}, Bulk, 10*time.Second, false); err != nil {
		t.Fatal(err)
	}
	nextFor(t, b)
	address, err = c.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	disconnectC, err := b.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	defer disconnectC()
	waitFor(t, time.Second, func() bool { return len(b.Peers()) == 2 })
	if b.CancelLocal(func(any) bool { return true }) != 0 {
		t.Fatal("cancellation discarded another origin's traffic")
	}
	b.SetLowPower(false)
	if !strings.Contains(string(nextFor(t, c).Payload), "foreign origin") {
		t.Fatal("foreign copy lost")
	}
}

func TestCancelLocalIDsPreservesEqualPayloadAndForeignPacket(t *testing.T) {
	a, b, c := routerFor(t, Options{}), routerFor(t, Options{}), routerFor(t, Options{DisableRelay: true})
	b.SetLowPower(true)
	address, err := b.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	disconnect, err := a.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	defer disconnect()
	waitFor(t, time.Second, func() bool { return len(a.Peers()) == 1 })
	payload := map[string]any{"kind": "same-source-bytes"}
	foreign, err := a.Broadcast(payload, Bulk, 10*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	nextFor(t, b)
	address, err = c.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	disconnectC, err := b.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	defer disconnectC()
	waitFor(t, time.Second, func() bool { return len(b.Peers()) == 2 })
	removed, err := b.Broadcast(payload, Bulk, 10*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(3 * time.Millisecond)
	kept, err := b.Broadcast(payload, Bulk, 10*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	if removed == kept || b.CancelLocalIDs([]string{removed, foreign}) != 1 || b.CancelLocalIDs([]string{removed, foreign}) != 0 {
		t.Fatal("local packet identity cancellation failed")
	}
	b.SetLowPower(false)
	ids := map[string]bool{}
	for i := 0; i < 2; i++ {
		ids[nextFor(t, c).Route.PacketID] = true
	}
	if !ids[foreign] || !ids[kept] || ids[removed] {
		t.Fatal("wrong packets preserved")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err = c.Next(ctx); err == nil {
		t.Fatal("cancelled packet arrived")
	}
}

func TestBroadcastUntilBindsAbsoluteDeadline(t *testing.T) {
	r := routerFor(t, Options{})
	deadline := time.Now().Add(time.Second).UnixMilli()
	id, err := r.BroadcastUntil(map[string]any{"kind": "source"}, Bulk, 2*time.Minute, false, deadline)
	if err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	expires := r.retained[id].packet.expires
	r.mu.Unlock()
	if expires != deadline {
		t.Fatal("deadline changed during packet construction")
	}
	if _, err = r.BroadcastUntil(map[string]any{"kind": "source"}, Bulk, 2*time.Minute, false, time.Now().UnixMilli()-1); err == nil {
		t.Fatal("expired authorization accepted")
	}
}
