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
