package transport

import (
	"bytes"
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func assertRetainedAccounting(t *testing.T, router *Router) {
	t.Helper()
	total := 0
	for _, value := range router.retained {
		total += len(value.encoded)
	}
	if router.retainedBytes != total {
		t.Fatalf("retained byte accounting differs from actual entries: tracked=%d actual=%d entries=%d", router.retainedBytes, total, len(router.retained))
	}
	if total > MaxPendingBytes || len(router.retained) > MaxTransfers {
		t.Fatalf("retention bounds exceeded: bytes=%d entries=%d", total, len(router.retained))
	}
}

func TestRetainedReplayAfterSeenEvictionKeepsExactAccounting(t *testing.T) {
	router := routerFor(t, Options{ID: "receiver"})
	// Exercise receive/retention deterministically without OS scheduling or waiting
	// for a TTL. Other tests cover this path over actual sockets and subprocesses.
	source := &Link{active: true, options: LinkOptions{Medium: "retention-fixture"}}
	expires := time.Now().Add(time.Hour).UnixMilli()
	sos, _ := encodedPacket(t, map[string]any{"urgent": "protected packet"}, func(p *packet) { p.priority = SOS; p.expires = expires })
	receive := func(p *packet) {
		t.Helper()
		if err := router.receive(p, source); err != nil {
			t.Fatal(err)
		}
		if _, err := router.Next(context.Background()); err != nil {
			t.Fatal(err)
		}
		router.mu.Lock()
		defer router.mu.Unlock()
		assertRetainedAccounting(t, router)
	}
	receive(sos)
	original := router.retained[sos.id]
	for i := 0; i < 4096; i++ {
		normal, _ := encodedPacket(t, map[string]any{"normal": i}, func(p *packet) { p.expires = expires })
		receive(normal)
	}
	router.mu.Lock()
	forgotten := !router.hasSeenLocked(sos.id, time.Now().UnixMilli())
	protected := router.retained[sos.id] == original
	countBefore, bytesBefore, dropsBefore := len(router.retained), router.retainedBytes, router.counters.Dropped
	router.mu.Unlock()
	if !forgotten || !protected || countBefore != MaxTransfers {
		t.Fatalf("regression precondition missing: seen-forgotten=%v SOS-retained=%v entries=%d", forgotten, protected, countBefore)
	}
	receive(sos)
	router.mu.Lock()
	defer router.mu.Unlock()
	if router.retained[sos.id] != original || router.retainedBytes != bytesBefore || len(router.retained) != countBefore || router.counters.Dropped != dropsBefore {
		t.Fatal("replay replaced its snapshot, consumed more capacity or evicted another packet")
	}
	for id := range router.retained {
		router.removeRetainedLocked(id)
		assertRetainedAccounting(t, router)
	}
	if router.retainedBytes != 0 {
		t.Fatal("phantom bytes remained after every retained entry was removed")
	}
}

func TestRetainedDuplicatePressurePreservesConsentAndExpiresToZero(t *testing.T) {
	router := routerFor(t, Options{})
	expires := time.Now().Add(time.Hour).UnixMilli()
	p, encoded := encodedPacket(t, map[string]any{"value": "first immutable snapshot"}, func(p *packet) { p.priority = SOS; p.expires = expires })
	router.mu.Lock()
	defer router.mu.Unlock()
	original, err := router.retainLocked(p, encoded, true)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < MaxTransfers; i++ {
		normal, wire := encodedPacket(t, map[string]any{"normal": i}, func(p *packet) { p.expires = expires })
		if _, err = router.retainLocked(normal, wire, true); err != nil {
			t.Fatal(err)
		}
	}
	countBefore, bytesBefore, sequenceBefore, dropsBefore := len(router.retained), router.retainedBytes, router.sequence, router.counters.Dropped
	// The ID excludes hops: a replay can arrive through another valid path.
	// Repeated duplicate pressure must not replace local consent metadata or make
	// an already-retained packet run through eviction/admission again.
	alternative := *p
	alternative.hops = []string{p.source, "different-path"}
	alternativeBytes, err := core.Canonical(alternative.object())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8192; i++ {
		duplicate, err := router.retainLocked(&alternative, alternativeBytes, false)
		if err != nil {
			t.Fatal(err)
		}
		if duplicate != original || !duplicate.relayOnly || !bytes.Equal(duplicate.encoded, encoded) {
			t.Fatalf("duplicate pressure changed retained snapshot/consent at attempt %d", i)
		}
		assertRetainedAccounting(t, router)
	}
	if len(router.retained) != countBefore || router.retainedBytes != bytesBefore || router.sequence != sequenceBefore || router.counters.Dropped != dropsBefore {
		t.Fatal("duplicate pressure changed retention capacity/order/drop counters")
	}
	router.maintainLocked(expires)
	assertRetainedAccounting(t, router)
	if len(router.retained) != 0 || router.retainedBytes != 0 {
		t.Fatal("expiry left phantom retained bytes")
	}
	// Positive capacity control: after expiration, a full fresh batch is admitted.
	for i := 0; i < MaxTransfers; i++ {
		fresh, wire := encodedPacket(t, map[string]any{"fresh": fmt.Sprint(i)}, nil)
		if _, err = router.retainLocked(fresh, wire, false); err != nil {
			t.Fatal(err)
		}
		assertRetainedAccounting(t, router)
	}
	if len(router.retained) != MaxTransfers {
		t.Fatal("capacity did not recover after expiry")
	}
}
