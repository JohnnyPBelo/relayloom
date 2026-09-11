package transport

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func routerFor(t *testing.T, options Options) *Router {
	t.Helper()
	r, err := New(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r
}
func waitFor(t *testing.T, timeout time.Duration, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatal("transport condition timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
func nextFor(t *testing.T, r *Router) Delivery {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	value, err := r.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func attachPipe(t *testing.T, r *Router) (*Link, net.Conn) {
	t.Helper()
	left, right := net.Pipe()
	link, err := r.Attach(left, LinkOptions{Medium: "test-stream", Address: "net.Pipe", RetryInterval: 50 * time.Millisecond, WriteTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { right.Close() })
	return link, right
}
func encodedPacket(t *testing.T, payload any, changes func(*packet)) (*packet, []byte) {
	t.Helper()
	now := time.Now().UnixMilli()
	p := &packet{source: "raw", created: now, expires: now + 30_000, maxHops: 12, hops: []string{"raw"}, priority: Normal, payload: payload}
	if changes != nil {
		changes(p)
	}
	body, err := core.Canonical(p.body())
	if err != nil {
		t.Fatal(err)
	}
	p.id = core.Hash(body)
	wire, err := core.Canonical(p.object())
	if err != nil {
		t.Fatal(err)
	}
	return p, wire
}
func fragmentBytes(id string, encoded []byte) [][]byte {
	count := (len(encoded) + FragmentBytes - 1) / FragmentBytes
	out := make([][]byte, 0, count)
	for index := 0; index < count; index++ {
		end := (index + 1) * FragmentBytes
		if end > len(encoded) {
			end = len(encoded)
		}
		line, _ := json.Marshal(map[string]any{"t": "part", "id": id, "index": index, "count": count, "data": base64.StdEncoding.EncodeToString(encoded[index*FragmentBytes : end])})
		out = append(out, append(line, '\n'))
	}
	return out
}
func writeAll(t *testing.T, stream io.Writer, data []byte) {
	t.Helper()
	for len(data) > 0 {
		n, err := stream.Write(data)
		if err != nil {
			t.Fatal(err)
		}
		data = data[n:]
	}
}

func TestTCPAndGenericStreamMultihop(t *testing.T) {
	a := routerFor(t, Options{ID: "a"})
	b := routerFor(t, Options{ID: "b"})
	c := routerFor(t, Options{ID: "c"})
	address, err := b.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.ConnectTCP(address.String()); err != nil {
		t.Fatal(err)
	}
	left, right := net.Pipe()
	if _, err = b.Attach(left, LinkOptions{Medium: "byte-stream"}); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Attach(right, LinkOptions{Medium: "byte-stream"}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, func() bool { return len(a.Peers()) == 1 && len(b.Peers()) == 2 })
	payload := map[string]any{"message": strings.Repeat("bridge λ ", 4000)}
	if _, err = a.Broadcast(payload, Normal, 30*time.Second, false); err != nil {
		t.Fatal(err)
	}
	got := nextFor(t, c)
	expected, _ := core.Canonical(payload)
	if !bytes.Equal(got.Payload, expected) {
		t.Fatal("heterogeneous payload changed")
	}
	if fmt.Sprint(got.Route.Hops) != "[a b]" || got.Route.Medium != "byte-stream" {
		t.Fatalf("wrong route: %+v", got.Route)
	}
	b.SetRelay(false)
	if _, err = a.Broadcast(map[string]any{"blocked": true}, Normal, time.Second, false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if _, err = c.Next(ctx); err == nil {
		t.Fatal("relay pause negative control failed")
	}
}
func TestParserReplayTamperTTLAndBounds(t *testing.T) {
	r := routerFor(t, Options{})
	link, peer := attachPipe(t, r)
	p, wire := encodedPacket(t, map[string]any{"value": "accepted"}, nil)
	line := fragmentBytes(p.id, wire)[0]
	writeAll(t, peer, line[:23])
	writeAll(t, peer, line[23:])
	nextFor(t, r)
	// The receiver can write one ACK but this peer deliberately never reads it.
	writeAll(t, peer, bytes.Repeat(line, 5000))
	waitFor(t, time.Second, func() bool { return r.Counters().Duplicates >= 5000 })
	state := link.Snapshot()
	if state.Controls > 1 || state.AssemblyBytes != 0 || state.PendingBytes > MaxPendingBytes {
		t.Fatalf("unbounded duplicate state %+v", state)
	}
	expired, encoded := encodedPacket(t, map[string]any{"expired": true}, func(p *packet) { p.created = time.Now().Add(-time.Second).UnixMilli(); p.expires = p.created + 1 })
	writeAll(t, peer, bytes.Join(fragmentBytes(expired.id, encoded), nil))
	tampered := append([]byte{}, wire...)
	tampered = bytes.Replace(tampered, []byte("accepted"), []byte("modified"), 1)
	writeAll(t, peer, bytes.Join(fragmentBytes(strings.Repeat("f", 64), tampered), nil))
	waitFor(t, time.Second, func() bool { return r.Counters().Rejected >= 2 })
	if r.Counters().Received != 1 {
		t.Fatal("tamper or expiry delivered")
	}
	for i := 0; i < 9; i++ {
		id := core.Hash([]byte(fmt.Sprint("partial", i)))
		line, _ := json.Marshal(map[string]any{"t": "part", "id": id, "index": 0, "count": 3, "data": base64.StdEncoding.EncodeToString(make([]byte, FragmentBytes))})
		writeAll(t, peer, append(line, '\n'))
	}
	waitFor(t, time.Second, func() bool { return link.Snapshot().Assemblies == 8 })
	if link.Snapshot().AssemblyBytes != 8*FragmentBytes {
		t.Fatal("assembly count/memory bounds failed")
	}
	peer.Close()
	waitFor(t, time.Second, func() bool { return !link.Snapshot().Connected })
	if link.Snapshot().AssemblyBytes != 0 {
		t.Fatal("closed assembly storage retained")
	}
}
func TestMalformedFloodAndQueuedExpiry(t *testing.T) {
	r := routerFor(t, Options{})
	link, peer := attachPipe(t, r)
	writeAll(t, peer, bytes.Repeat([]byte("bad\n"), 32))
	waitFor(t, time.Second, func() bool { return !link.Snapshot().Connected })
	if r.Counters().RateLimited == 0 {
		t.Fatal("malformed flood was not limited")
	}
	other := routerFor(t, Options{})
	queued, _ := attachPipe(t, other)
	other.SetLowPower(true)
	for i := 0; i < 90; i++ {
		other.Broadcast(map[string]any{"n": i}, Bulk, 100*time.Millisecond, false)
	}
	if queued.Snapshot().Queued > 62 || queued.Snapshot().PendingBytes > MaxPendingBytes {
		t.Fatal("unbounded output queue")
	}
	waitFor(t, time.Second, func() bool { return queued.Snapshot().Queued == 0 })
	if other.Counters().Dropped == 0 {
		t.Fatal("overflow did not report drops")
	}
}
func TestFragmentPriorityAndFairness(t *testing.T) {
	r := routerFor(t, Options{})
	_, peer := attachPipe(t, r)
	payloadSize := 96 * 1024
	bulk, err := r.Broadcast(map[string]any{"kind": "bulk", "data": strings.Repeat("b", payloadSize)}, Bulk, 30*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(peer)
	observed := []wireFrame{}
	sos := ""
	parts := map[string]map[int][]byte{}
	complete := map[string]bool{}
	deadline := time.Now().Add(5 * time.Second)
	peer.SetDeadline(deadline)
	for len(complete) < 2 {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			t.Fatal(err)
		}
		frame, err := parseFrame(bytes.TrimSuffix(line, []byte{'\n'}))
		if err != nil {
			t.Fatal(err)
		}
		if frame.Type != "part" {
			continue
		}
		observed = append(observed, frame)
		if sos == "" {
			sos, err = r.Broadcast(map[string]any{"kind": "sos", "data": strings.Repeat("s", payloadSize)}, SOS, 30*time.Second, false)
			if err != nil {
				t.Fatal(err)
			}
		}
		if parts[frame.ID] == nil {
			parts[frame.ID] = map[int][]byte{}
		}
		decoded, _ := base64.StdEncoding.DecodeString(frame.Data)
		parts[frame.ID][frame.Index] = decoded
		if len(parts[frame.ID]) == frame.Count {
			complete[frame.ID] = true
			ack, _ := json.Marshal(map[string]any{"t": "ack", "id": frame.ID})
			writeAll(t, peer, append(ack, '\n'))
		}
	}
	firstSOS, lastSOS, lastBulk := -1, -1, -1
	for index, frame := range observed {
		if frame.ID == sos {
			if firstSOS < 0 {
				firstSOS = index
			}
			lastSOS = index
		}
		if frame.ID == bulk {
			lastBulk = index
		}
	}
	if firstSOS < 1 || firstSOS > 4 || lastSOS >= lastBulk {
		t.Fatalf("SOS failed to preempt: %d/%d/%d", firstSOS, lastSOS, lastBulk)
	}
	lastFair, turns := -1, 0
	for index := firstSOS; index < lastSOS; index++ {
		if observed[index].ID == bulk {
			if lastFair >= 0 && index-lastFair > 4 {
				t.Fatal("bulk starved during SOS")
			}
			lastFair = index
			turns++
		}
	}
	if turns < 10 {
		t.Fatal("insufficient fair bulk progress")
	}
	for id, fragments := range parts {
		var encoded []byte
		for i := 0; i < len(fragments); i++ {
			encoded = append(encoded, fragments[i]...)
		}
		decoded, err := decodePacket(encoded)
		if err != nil || decoded.id != id {
			t.Fatalf("fragment reassembly integrity failed: %v", err)
		}
	}
}
func TestReconnectAndRelayConsent(t *testing.T) {
	sender := routerFor(t, Options{})
	receiver := routerFor(t, Options{})
	address, err := receiver.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cancel, err := sender.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	waitFor(t, time.Second, func() bool { return len(sender.Peers()) == 1 })
	receiver.Close()
	sender.Broadcast(map[string]any{"kind": "offline"}, SOS, 10*time.Second, false)
	sender.Broadcast(map[string]any{"kind": "expired"}, Normal, 50*time.Millisecond, false)
	sender.Broadcast(map[string]any{"kind": "seed"}, Bulk, 10*time.Second, true)
	sender.SetRelay(false)
	sender.SetRelay(true)
	time.Sleep(80 * time.Millisecond)
	replacement := routerFor(t, Options{})
	if _, err = replacement.ListenTCP(address.String()); err != nil {
		t.Fatal(err)
	}
	got := nextFor(t, replacement)
	if string(got.Payload) != "{\"kind\":\"offline\"}" {
		t.Fatalf("wrong retained packet: %s", got.Payload)
	}
	ctx, done := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer done()
	if _, err = replacement.Next(ctx); err == nil {
		t.Fatal("expired or cancelled seed replayed")
	}
}

func TestMissingFragmentAndACKRetryOverTCP(t *testing.T) {
	sender := routerFor(t, Options{})
	receiver := routerFor(t, Options{})
	address, err := receiver.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { proxy.Close() })
	connections := make(chan [2]net.Conn, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		front, err := proxy.Accept()
		if err != nil {
			return
		}
		back, err := net.Dial("tcp", address.String())
		if err != nil {
			front.Close()
			return
		}
		connections <- [2]net.Conn{front, back}
		defer front.Close()
		defer back.Close()
		copied := make(chan struct{})
		go func() {
			defer close(copied)
			reader := bufio.NewReader(back)
			dropped := false
			for {
				line, err := reader.ReadBytes('\n')
				if err != nil {
					return
				}
				frame, err := parseFrame(bytes.TrimSuffix(line, []byte{'\n'}))
				if err != nil {
					return
				}
				if frame.Type == "ack" && !dropped {
					dropped = true
					continue
				}
				if _, err = front.Write(line); err != nil {
					return
				}
			}
		}()
		reader := bufio.NewReader(front)
		dropped := false
		for {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return
			}
			frame, err := parseFrame(bytes.TrimSuffix(line, []byte{'\n'}))
			if err != nil {
				return
			}
			if frame.Type == "part" && frame.Index == 1 && !dropped {
				dropped = true
				continue
			}
			if _, err = back.Write(line); err != nil {
				return
			}
		}
	}()
	if _, err = sender.ConnectTCP(proxy.Addr().String()); err != nil {
		t.Fatal(err)
	}
	pair := <-connections
	t.Cleanup(func() { pair[0].Close(); pair[1].Close(); <-done })
	waitFor(t, time.Second, func() bool { return len(sender.Peers()) == 1 && len(receiver.Peers()) == 1 })
	payload := map[string]any{"lost-fragment": strings.Repeat("retry integrity ", 3000)}
	if _, err = sender.Broadcast(payload, Normal, 15*time.Second, false); err != nil {
		t.Fatal(err)
	}
	got := nextFor(t, receiver)
	expected, _ := core.Canonical(payload)
	if !bytes.Equal(got.Payload, expected) {
		t.Fatal("retried bytes changed")
	}
	waitFor(t, 6*time.Second, func() bool { peers := sender.Peers(); return len(peers) == 1 && peers[0].Queued == 0 })
	if sender.Counters().Retransmits < 2 || receiver.Counters().Received != 1 || receiver.Counters().Duplicates == 0 {
		t.Fatalf("retry control failed: %+v %+v", sender.Counters(), receiver.Counters())
	}
}

func TestDeliveryAndDialQueuesAreBounded(t *testing.T) {
	r := routerFor(t, Options{})
	_, peer := attachPipe(t, r)
	for index := 0; index < 70; index++ {
		p, wire := encodedPacket(t, map[string]any{"n": index}, nil)
		writeAll(t, peer, bytes.Join(fragmentBytes(p.id, wire), nil))
	}
	r.mu.Lock()
	queued, size := len(r.deliveries), r.deliveryBytes
	r.mu.Unlock()
	if queued != 64 || size > MaxPendingBytes || r.Counters().Dropped == 0 {
		t.Fatal("local delivery queue was not bounded")
	}
	// Reserve a local port and close it so reconnect attempts fail quickly without contacting external hosts.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	dialer := routerFor(t, Options{})
	for index := 0; index < MaxLinks; index++ {
		if _, err = dialer.ConnectTCP(address); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = dialer.ConnectTCP(address); err != ErrCapacity {
		t.Fatalf("dial queue exceeded limit: %v", err)
	}
}

func TestHopLimitAndValidationBeforeForwarding(t *testing.T) {
	middle := routerFor(t, Options{Validate: func(payload json.RawMessage) error {
		if !bytes.Contains(payload, []byte("accepted")) {
			return fmt.Errorf("invalid application payload")
		}
		return nil
	}})
	target := routerFor(t, Options{})
	source, peer := attachPipe(t, middle)
	_ = source
	left, right := net.Pipe()
	middle.Attach(left, LinkOptions{Medium: "byte-stream"})
	target.Attach(right, LinkOptions{Medium: "byte-stream"})
	bad, encoded := encodedPacket(t, map[string]any{"text": "rejected"}, nil)
	writeAll(t, peer, bytes.Join(fragmentBytes(bad.id, encoded), nil))
	exhausted, encoded := encodedPacket(t, map[string]any{"text": "accepted hop limit"}, func(p *packet) { p.maxHops = 1 })
	writeAll(t, peer, bytes.Join(fragmentBytes(exhausted.id, encoded), nil))
	nextFor(t, middle)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := target.Next(ctx); err == nil {
		t.Fatal("exhausted packet forwarded")
	}
	good, encoded := encodedPacket(t, map[string]any{"text": "accepted valid control"}, nil)
	writeAll(t, peer, bytes.Join(fragmentBytes(good.id, encoded), nil))
	nextFor(t, target)
	if middle.Counters().Rejected != 1 {
		t.Fatal("validation rejection absent")
	}
}
