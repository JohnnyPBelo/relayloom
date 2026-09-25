package transport

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAcknowledgedNormalHistoryAllowsNewBulk(t *testing.T) {
	sender, receiver := routerFor(t, Options{}), routerFor(t, Options{DisableRelay: true})
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	var mu sync.Mutex
	received := map[string]bool{}
	go func() {
		for {
			value, err := receiver.Next(ctx)
			if err != nil {
				return
			}
			mu.Lock()
			received[value.Route.PacketID] = true
			mu.Unlock()
		}
	}()
	for i := 0; i < MaxTransfers; i++ {
		if _, err := sender.Broadcast(map[string]any{"inventory": i}, Normal, 2*time.Minute, false); err != nil {
			t.Fatal(err)
		}
	}
	address, err := receiver.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = sender.ConnectTCP(address.String()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, func() bool {
		peers := sender.Peers()
		return len(peers) == 1 && peers[0].Connected && peers[0].Queued == 0
	})
	sos, err := sender.Broadcast(map[string]any{"urgent": "positive path control"}, SOS, 2*time.Minute, false)
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, func() bool { mu.Lock(); defer mu.Unlock(); return received[sos] })
	bulk, err := sender.Broadcast(map[string]any{"requested": strings.Repeat("x", 80000)}, Bulk, 2*time.Minute, false)
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, 1500*time.Millisecond, func() bool { mu.Lock(); defer mu.Unlock(); return received[bulk] })
	sender.mu.Lock()
	defer sender.mu.Unlock()
	assertRetainedAccounting(t, sender)
	if sender.retained[sos] == nil {
		t.Fatal("bulk displaced cached SOS")
	}
}

func TestImpossibleBulkAdmissionPreservesIdleCacheAndSOS(t *testing.T) {
	router := routerFor(t, Options{})
	for i := 0; i < 3; i++ {
		if _, err := router.Broadcast(map[string]any{"urgent": i, "body": strings.Repeat("s", 5*1024*1024)}, SOS, 2*time.Minute, false); err != nil {
			t.Fatal(err)
		}
	}
	normal, err := router.Broadcast(map[string]any{"cached": strings.Repeat("n", 512*1024)}, Normal, 2*time.Minute, false)
	if err != nil {
		t.Fatal(err)
	}
	router.mu.Lock()
	beforeCount, beforeBytes := len(router.retained), router.retainedBytes
	original := router.retained[normal]
	router.mu.Unlock()
	if _, err := router.Broadcast(map[string]any{"bulk": strings.Repeat("b", 2*1024*1024)}, Bulk, 2*time.Minute, false); err != ErrCapacity {
		t.Fatalf("expected capacity rejection, got %v", err)
	}
	router.mu.Lock()
	defer router.mu.Unlock()
	assertRetainedAccounting(t, router)
	if len(router.retained) != beforeCount || router.retainedBytes != beforeBytes || router.retained[normal] != original {
		t.Fatal("failed admission changed protected cache")
	}
}
