package transport

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"sync"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const maxControl = 64
const maxACKsPerSecond = 64

type transfer struct {
	*retained
	sent           time.Time
	attempts, next int
	scheduled      uint64
	inFlight       bool
	cancelled      bool
}

func (t *transfer) count() int    { return (len(t.encoded) + FragmentBytes - 1) / FragmentBytes }
func (t *transfer) partial() bool { return t.next > 0 && t.next < t.count() }

type assembly struct {
	parts          map[int][]byte
	count, bytes   int
	since, updated time.Time
}
type wireFrame struct {
	Type  string `json:"t"`
	ID    string `json:"id"`
	Index int    `json:"index,omitempty"`
	Count int    `json:"count,omitempty"`
	Data  string `json:"data,omitempty"`
}

// Link exposes immutable snapshots; its queue and stream lifecycle belong to Router.
type Link struct {
	router                                     *Router
	stream                                     io.ReadWriteCloser
	options                                    LinkOptions
	id                                         string
	active                                     bool
	pending                                    map[string]*transfer
	pendingBytes                               int
	assemblies                                 map[string]*assembly
	assemblyBytes                              int
	controls                                   []string
	controlSet                                 map[string]bool
	acknowledged                               map[string]time.Time
	ackWindow                                  time.Time
	acksWindow                                 int
	receiveWindow                              time.Time
	receiveBytes, receiveFrames, invalidFrames int
	sent, received                             uint64
	turn                                       uint64
	wake                                       chan struct{}
	done                                       chan struct{}
	closeOnce                                  sync.Once
}

func newLink(router *Router, stream io.ReadWriteCloser, options LinkOptions, id string) *Link {
	now := time.Now()
	return &Link{router: router, stream: stream, options: options, id: id, active: true, pending: make(map[string]*transfer), assemblies: make(map[string]*assembly), controlSet: make(map[string]bool), acknowledged: make(map[string]time.Time), ackWindow: now, receiveWindow: now, wake: make(chan struct{}, 1), done: make(chan struct{})}
}
func (l *Link) Snapshot() PeerState {
	l.router.mu.Lock()
	defer l.router.mu.Unlock()
	return l.snapshotLocked()
}
func (l *Link) snapshotLocked() PeerState {
	return PeerState{ID: l.id, Medium: l.options.Medium, Address: l.options.Address, Connected: l.active, Sent: l.sent, Received: l.received, Queued: len(l.pending), PendingBytes: l.pendingBytes, Assemblies: len(l.assemblies), AssemblyBytes: l.assemblyBytes, Controls: len(l.controls)}
}
func (l *Link) Close() error {
	var err error
	l.closeOnce.Do(func() {
		r := l.router
		r.mu.Lock()
		l.active = false
		l.pending = make(map[string]*transfer)
		l.assemblies = make(map[string]*assembly)
		l.controls = nil
		l.controlSet = make(map[string]bool)
		l.acknowledged = make(map[string]time.Time)
		l.pendingBytes = 0
		l.assemblyBytes = 0
		delete(r.links, l)
		close(l.done)
		r.mu.Unlock()
		err = l.stream.Close()
	})
	return err
}
func (l *Link) wakeLocked() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}
func (l *Link) removeTransferLocked(id string) {
	if value := l.pending[id]; value != nil {
		l.pendingBytes -= len(value.encoded)
		delete(l.pending, id)
	}
}

// DiscardAssembly is scoped to this peer's inbound partial transfer only.
func (l *Link) DiscardAssembly(id string) {
	if !validID(id) {
		return
	}
	l.router.mu.Lock()
	defer l.router.mu.Unlock()
	l.removeAssemblyLocked(id)
}
func (l *Link) notifyCancelLocked(id string) {
	if stream, ok := l.stream.(interface{ CancelPacket(string) }); ok {
		stream.CancelPacket(id)
	}
}
func (l *Link) cancelTransferLocked(id string) {
	if value := l.pending[id]; value != nil {
		if value.inFlight {
			value.cancelled = true
		} else if value.next > 0 {
			l.notifyCancelLocked(id)
		}
	}
	l.removeTransferLocked(id)
}
func (l *Link) removeAssemblyLocked(id string) {
	if value := l.assemblies[id]; value != nil {
		l.assemblyBytes -= value.bytes
		delete(l.assemblies, id)
	}
}
func (l *Link) maintainLocked(now time.Time) {
	for id, value := range l.pending {
		if value.packet.expires <= now.UnixMilli() {
			l.removeTransferLocked(id)
		}
	}
	for id, value := range l.assemblies {
		if now.Sub(value.updated) > 120*time.Second || now.Sub(value.since) > time.Hour {
			l.removeAssemblyLocked(id)
		}
	}
	for id, at := range l.acknowledged {
		if now.Sub(at) >= time.Second {
			delete(l.acknowledged, id)
		}
	}
	if now.Sub(l.ackWindow) >= time.Second {
		l.ackWindow = now
		l.acksWindow = 0
	}
}
func (l *Link) enqueueLocked(value *retained) bool {
	if !l.active || l.pending[value.packet.id] != nil || value.packet.expires <= time.Now().UnixMilli() {
		return false
	}
	limit, slots := MaxPendingBytes-64*1024, MaxTransfers-2
	if value.packet.priority == SOS {
		limit = MaxPendingBytes
		slots = MaxTransfers
	}
	for len(l.pending) >= slots || l.pendingBytes+len(value.encoded) > limit {
		var victim *transfer
		for _, old := range l.pending {
			if old.inFlight || priorityRank(old.packet.priority) <= priorityRank(value.packet.priority) || (old.next != 0 && old.next != old.count()) {
				continue
			}
			if victim == nil || priorityRank(old.packet.priority) > priorityRank(victim.packet.priority) || (old.packet.priority == victim.packet.priority && old.sequence > victim.sequence) {
				victim = old
			}
		}
		if victim == nil {
			l.router.counters.Dropped++
			return false
		}
		l.removeTransferLocked(victim.packet.id)
		l.router.counters.Dropped++
	}
	l.pending[value.packet.id] = &transfer{retained: value}
	l.pendingBytes += len(value.encoded)
	l.wakeLocked()
	return true
}
func (l *Link) acknowledgeLocked(id string, now time.Time) {
	if l.controlSet[id] || now.Sub(l.acknowledged[id]) < time.Second {
		return
	}
	if len(l.controls) >= maxControl {
		l.router.counters.Dropped++
		return
	}
	l.controls = append(l.controls, id)
	l.controlSet[id] = true
	l.wakeLocked()
}
func validID(id string) bool {
	if len(id) != 64 {
		return false
	}
	for _, char := range id {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
func parseFrame(line []byte) (wireFrame, error) {
	var result wireFrame
	value, err := core.DecodeJSON(line, MaxFrameBytes)
	if err != nil {
		return result, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return result, errors.New("invalid frame")
	}
	result.Type, _ = object["t"].(string)
	result.ID, _ = object["id"].(string)
	if !validID(result.ID) {
		return result, errors.New("invalid frame ID")
	}
	if result.Type == "ack" {
		return result, nil
	}
	if result.Type != "part" {
		return result, errors.New("invalid frame type")
	}
	index, okIndex := integer(object["index"])
	count, okCount := integer(object["count"])
	data, okData := object["data"].(string)
	if !okIndex || !okCount || !okData || count < 1 || count > MaxPacketBytes/FragmentBytes || index < 0 || index >= count || len(data) > 2868 {
		return result, errors.New("invalid fragment")
	}
	result.Index = int(index)
	result.Count = int(count)
	result.Data = data
	return result, nil
}
func (l *Link) readLoop() {
	defer l.router.wg.Done()
	defer l.Close()
	reader := bufio.NewReaderSize(l.stream, MaxFrameBytes+1)
	for {
		line, err := reader.ReadSlice('\n')
		if len(line) > 0 {
			r := l.router
			r.mu.Lock()
			now := time.Now()
			if now.Sub(l.receiveWindow) >= time.Second {
				l.receiveWindow = now
				l.receiveBytes = 0
				l.receiveFrames = 0
				l.invalidFrames = 0
			}
			l.receiveBytes += len(line)
			l.received += uint64(len(line))
			l.receiveFrames++
			limited := l.receiveBytes > 12*1024*1024 || l.receiveFrames > 8192
			if limited {
				r.counters.RateLimited++
			}
			r.mu.Unlock()
			if limited {
				return
			}
		}
		if err != nil {
			if errors.Is(err, bufio.ErrBufferFull) {
				l.router.mu.Lock()
				l.router.counters.Rejected++
				l.router.mu.Unlock()
			}
			return
		}
		line = line[:len(line)-1]
		if len(line) == 0 {
			continue
		} // Serial reopen delimiter; never an application frame.
		if len(line) > MaxFrameBytes {
			return
		}
		frame, frameErr := parseFrame(line)
		if frameErr == nil {
			frameErr = l.frame(frame)
		}
		if frameErr != nil {
			r := l.router
			r.mu.Lock()
			r.counters.Rejected++
			l.invalidFrames++
			limited := l.invalidFrames >= 32
			if limited {
				r.counters.RateLimited++
			}
			r.mu.Unlock()
			if limited {
				return
			}
		}
	}
}
func (l *Link) frame(frame wireFrame) error {
	r := l.router
	now := time.Now()
	if frame.Type == "ack" {
		r.mu.Lock()
		l.removeTransferLocked(frame.ID)
		l.wakeLocked()
		r.mu.Unlock()
		return nil
	}
	data, err := base64.StdEncoding.Strict().DecodeString(frame.Data)
	if err != nil || len(data) < 1 || len(data) > FragmentBytes || (frame.Index < frame.Count-1 && len(data) != FragmentBytes) || base64.StdEncoding.EncodeToString(data) != frame.Data {
		return errors.New("invalid fragment encoding")
	}
	r.mu.Lock()
	if !l.active {
		r.mu.Unlock()
		return ErrClosed
	}
	l.maintainLocked(now)
	if r.hasSeenLocked(frame.ID, now.UnixMilli()) {
		r.counters.Duplicates++
		l.acknowledgeLocked(frame.ID, now)
		r.mu.Unlock()
		return nil
	}
	value := l.assemblies[frame.ID]
	if value == nil {
		if len(l.assemblies) >= MaxAssemblies {
			r.mu.Unlock()
			return ErrCapacity
		}
		value = &assembly{parts: make(map[int][]byte), count: frame.Count, since: now, updated: now}
		l.assemblies[frame.ID] = value
	}
	prior, exists := value.parts[frame.Index]
	if frame.Count != value.count || (exists && !bytes.Equal(prior, data)) {
		l.removeAssemblyLocked(frame.ID)
		r.mu.Unlock()
		return errors.New("fragment changed")
	}
	if !exists {
		if value.bytes+len(data) > MaxPacketBytes || l.assemblyBytes+len(data) > MaxPendingBytes {
			l.removeAssemblyLocked(frame.ID)
			r.mu.Unlock()
			return ErrCapacity
		}
		value.parts[frame.Index] = data
		value.bytes += len(data)
		l.assemblyBytes += len(data)
		value.updated = now
	}
	if len(value.parts) != value.count {
		r.mu.Unlock()
		return nil
	}
	l.removeAssemblyLocked(frame.ID)
	r.mu.Unlock()
	encoded := make([]byte, 0, value.bytes)
	for index := 0; index < value.count; index++ {
		encoded = append(encoded, value.parts[index]...)
	}
	p, err := decodePacket(encoded)
	if err != nil {
		return err
	}
	if p.id != frame.ID {
		return errors.New("fragment ID mismatch")
	}
	if err = r.receive(p, l); err != nil {
		return err
	}
	r.mu.Lock()
	if l.active {
		l.acknowledgeLocked(frame.ID, time.Now())
	}
	r.mu.Unlock()
	return nil
}
func (l *Link) selectLocked(now time.Time) *transfer {
	counts := map[Priority]int{SOS: 0, Normal: 0, Bulk: 0}
	partialCount := 0
	ready := make([]*transfer, 0, len(l.pending))
	waiting := make(map[Priority]bool)
	for _, value := range l.pending {
		if value.partial() {
			counts[value.packet.priority]++
			partialCount++
		}
		if !(l.router.lowPower && value.packet.priority == Bulk) && (value.next < value.count() || now.Sub(value.sent) >= l.options.RetryInterval) {
			ready = append(ready, value)
		}
	}
	for _, value := range ready {
		if counts[value.packet.priority] == 0 {
			waiting[value.packet.priority] = true
		}
	}
	due := ready[:0]
	for _, value := range ready {
		if value.partial() {
			due = append(due, value)
			continue
		}
		priority := value.packet.priority
		if priority == SOS {
			if counts[SOS] >= 7 {
				continue
			}
		} else if counts[Normal]+counts[Bulk] >= 6 || counts[priority] >= 5 {
			continue
		}
		reserved := len(waiting)
		if waiting[priority] {
			reserved--
		}
		if partialCount < MaxAssemblies-reserved {
			due = append(due, value)
		}
	}
	fair := (l.turn+1)%4 == 0
	sort.Slice(due, func(i, j int) bool {
		a, b := due[i], due[j]
		if !fair && a.packet.priority != b.packet.priority {
			return priorityRank(a.packet.priority) < priorityRank(b.packet.priority)
		}
		if a.scheduled != b.scheduled {
			return a.scheduled < b.scheduled
		}
		return a.sequence < b.sequence
	})
	if len(due) == 0 {
		return nil
	}
	return due[0]
}
func (l *Link) writeBytes(data []byte) bool {
	timer := time.AfterFunc(l.options.WriteTimeout, func() { l.Close() })
	defer timer.Stop()
	if stream, ok := l.stream.(interface{ SetWriteDeadline(time.Time) error }); ok {
		if err := stream.SetWriteDeadline(time.Now().Add(l.options.WriteTimeout)); err != nil {
			return false
		}
	}
	written := 0
	for len(data) > 0 {
		count, err := l.stream.Write(data)
		written += count
		if count > 0 {
			data = data[count:]
		}
		if err != nil || count == 0 {
			return false
		}
	}
	l.router.mu.Lock()
	l.sent += uint64(written)
	active := l.active
	l.router.mu.Unlock()
	return active
}
func (l *Link) writeLoop() {
	defer l.router.wg.Done()
	defer l.Close()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	controlTurn := true
	for {
		r := l.router
		r.mu.Lock()
		if !l.active {
			r.mu.Unlock()
			return
		}
		now := time.Now()
		l.maintainLocked(now)
		value := l.selectLocked(now)
		ack := ""
		if l.acksWindow < maxACKsPerSecond && len(l.controls) > 0 {
			ack = l.controls[0]
		}
		var encoded []byte
		var err error
		isControl := ack != "" && (controlTurn || value == nil)
		if isControl {
			l.acksWindow++
			l.acknowledged[ack] = now
			encoded, err = json.Marshal(map[string]any{"t": "ack", "id": ack})
		} else if value != nil {
			l.turn++
			if value.next >= value.count() {
				value.next = 0
			}
			if value.next == 0 {
				value.attempts++
				if value.attempts > 1 {
					r.counters.Retransmits++
				}
			}
			value.inFlight = true
			start := value.next * FragmentBytes
			end := start + FragmentBytes
			if end > len(value.encoded) {
				end = len(value.encoded)
			}
			encoded, err = json.Marshal(map[string]any{"t": "part", "id": value.packet.id, "index": value.next, "count": value.count(), "data": base64.StdEncoding.EncodeToString(value.encoded[start:end])})
		}
		r.mu.Unlock()
		if encoded == nil {
			select {
			case <-l.done:
				return
			case <-r.ctx.Done():
				return
			case <-l.wake:
			case <-ticker.C:
				r.mu.Lock()
				r.maintainLocked(time.Now().UnixMilli())
				r.mu.Unlock()
			}
			continue
		}
		if err != nil || !l.writeBytes(append(encoded, '\n')) {
			return
		}
		r.mu.Lock()
		if isControl {
			if len(l.controls) > 0 && l.controls[0] == ack {
				l.controls = l.controls[1:]
				delete(l.controlSet, ack)
			}
			controlTurn = false
		} else {
			value.inFlight = false
			if value.cancelled {
				l.notifyCancelLocked(value.packet.id)
			}
			value.next++
			value.scheduled = l.turn
			if value.next == value.count() {
				value.sent = time.Now()
			}
			controlTurn = true
		}
		r.mu.Unlock()
	}
}
