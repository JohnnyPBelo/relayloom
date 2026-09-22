// Package transport implements RelayLoom's bounded experimental stream router.
// TCP is implemented; Attach accepts an ordered byte stream, not a radio driver.
package transport

import (
	"container/list"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const (
	MaxPacketBytes  = 6 * 1024 * 1024
	MaxPendingBytes = 16 * 1024 * 1024
	FragmentBytes   = 2048
	MaxFrameBytes   = 4096
	MaxTransfers    = 64
	MaxAssemblies   = 8
	MaxLinks        = 24
	MaxHops         = 12
	MaxTTL          = time.Hour
)

type Priority string

const (
	SOS    Priority = "sos"
	Normal Priority = "normal"
	Bulk   Priority = "bulk"
)

var (
	ErrClosed   = errors.New("router closed")
	ErrCapacity = errors.New("router capacity exceeded")
)

type Options struct {
	ID           string
	DisableRelay bool
	Validate     func(json.RawMessage) error
}
type LinkOptions struct {
	Medium        string
	Address       string
	RetryInterval time.Duration
	WriteTimeout  time.Duration
}
type Route struct {
	Hops     []string `json:"hops"`
	Medium   string   `json:"medium"`
	Source   string   `json:"source"`
	PacketID string   `json:"packetId"`
}
type Delivery struct {
	Payload json.RawMessage `json:"payload"`
	Route   Route           `json:"route"`
}
type Counters struct {
	Received    uint64 `json:"received"`
	Forwarded   uint64 `json:"forwarded"`
	Duplicates  uint64 `json:"duplicates"`
	Rejected    uint64 `json:"rejected"`
	Dropped     uint64 `json:"dropped"`
	Retransmits uint64 `json:"retransmits"`
	RateLimited uint64 `json:"rateLimited"`
}
type PeerState struct {
	ID            string `json:"id"`
	Medium        string `json:"medium"`
	Address       string `json:"address"`
	Connected     bool   `json:"connected"`
	Sent          uint64 `json:"sent"`
	Received      uint64 `json:"received"`
	Queued        int    `json:"queued"`
	PendingBytes  int    `json:"pendingBytes"`
	Assemblies    int    `json:"assemblies"`
	AssemblyBytes int    `json:"assemblyBytes"`
	Controls      int    `json:"controls"`
}
type packet struct {
	id, source       string
	created, expires int64
	maxHops          int
	hops             []string
	priority         Priority
	payload          any
}

func (p *packet) body() map[string]any {
	return map[string]any{"source": p.source, "created": p.created, "expires": p.expires, "maxHops": p.maxHops, "priority": string(p.priority), "payload": p.payload}
}
func (p *packet) object() map[string]any {
	body := p.body()
	body["id"] = p.id
	body["hops"] = p.hops
	return body
}

type retained struct {
	packet    *packet
	encoded   []byte
	relayOnly bool
	sequence  uint64
}
type seenEntry struct {
	id      string
	expires int64
}

// Router is safe for concurrent use. Next supplies a bounded local delivery queue.
type Router struct {
	mu                       sync.Mutex
	id                       string
	options                  Options
	relay, lowPower, stopped bool
	ctx                      context.Context
	cancel                   context.CancelFunc
	wg                       sync.WaitGroup
	links                    map[*Link]struct{}
	connectors               map[uint64]struct{}
	listener                 net.Listener
	retained                 map[string]*retained
	retainedBytes            int
	sequence                 uint64
	seen                     map[string]*list.Element
	seenOrder                *list.List
	deliveries               []Delivery
	deliveryBytes            int
	deliveryWake             chan struct{}
	counters                 Counters
}

func randomID(bytes int) (string, error) {
	data := make([]byte, bytes)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}
func validName(s string) bool { return s != "" && len(utf16.Encode([]rune(s))) <= 128 }
func priorityRank(p Priority) int {
	if p == SOS {
		return 0
	}
	if p == Normal {
		return 1
	}
	return 2
}
func validPriority(p Priority) bool { return p == SOS || p == Normal || p == Bulk }
func New(options Options) (*Router, error) {
	id := options.ID
	var err error
	if id == "" {
		id, err = randomID(16)
		if err != nil {
			return nil, err
		}
	}
	if !validName(id) {
		return nil, errors.New("invalid router ID")
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Router{id: id, options: options, relay: !options.DisableRelay, ctx: ctx, cancel: cancel, links: make(map[*Link]struct{}), connectors: make(map[uint64]struct{}), retained: make(map[string]*retained), seen: make(map[string]*list.Element), seenOrder: list.New(), deliveryWake: make(chan struct{}, 1)}, nil
}
func (r *Router) ID() string         { return r.id }
func (r *Router) Counters() Counters { r.mu.Lock(); defer r.mu.Unlock(); return r.counters }
func (r *Router) Peers() []PeerState {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]PeerState, 0, len(r.links))
	for link := range r.links {
		out = append(out, link.snapshotLocked())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
func (r *Router) SetRelay(enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.relay = enabled
	if !enabled {
		for id, value := range r.retained {
			if value.relayOnly {
				r.removeRetainedLocked(id)
			}
		}
		for link := range r.links {
			for id, value := range link.pending {
				if value.relayOnly {
					link.cancelTransferLocked(id)
				}
			}
		}
	}
}
func (r *Router) SetLowPower(enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lowPower = enabled
	for link := range r.links {
		link.wakeLocked()
	}
}

// CancelLocal retires our own packets and future fragments across all adapters.
// The trusted predicate runs under the router mutex and must be pure. A frame
// already handed to the operating system and remote copies cannot be recalled.
func (r *Router) CancelLocal(match func(any) bool) int {
	return r.cancelLocalWithID(func(value any, _ string) bool { return match(value) })
}

// CancelLocalIDs cannot retire a packet originated by another peer.
func (r *Router) CancelLocalIDs(ids []string) int {
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	return r.cancelLocalWithID(func(_ any, id string) bool { return wanted[id] })
}

func (r *Router) cancelLocalWithID(match func(any, string) bool) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	removed := map[string]bool{}
	for id, value := range r.retained {
		if value.packet.source == r.id && match(value.packet.payload, id) {
			r.removeRetainedLocked(id)
			removed[id] = true
		}
	}
	for link := range r.links {
		for id, value := range link.pending {
			if value.packet.source == r.id && match(value.packet.payload, id) {
				link.cancelTransferLocked(id)
				removed[id] = true
			}
		}
	}
	return len(removed)
}
func (r *Router) Next(ctx context.Context) (Delivery, error) {
	for {
		r.mu.Lock()
		if len(r.deliveries) > 0 {
			value := r.deliveries[0]
			r.deliveries[0] = Delivery{}
			r.deliveries = r.deliveries[1:]
			r.deliveryBytes -= len(value.Payload)
			if len(r.deliveries) > 0 {
				select {
				case r.deliveryWake <- struct{}{}:
				default:
				}
			}
			r.mu.Unlock()
			return value, nil
		}
		closed := r.stopped
		r.mu.Unlock()
		if closed {
			return Delivery{}, ErrClosed
		}
		select {
		case <-ctx.Done():
			return Delivery{}, ctx.Err()
		case <-r.ctx.Done():
			return Delivery{}, ErrClosed
		case <-r.deliveryWake:
		}
	}
}
func (r *Router) removeRetainedLocked(id string) {
	if old := r.retained[id]; old != nil {
		r.retainedBytes -= len(old.encoded)
		delete(r.retained, id)
	}
}
func (r *Router) hasSeenLocked(id string, now int64) bool {
	entry := r.seen[id]
	if entry == nil {
		return false
	}
	if entry.Value.(seenEntry).expires <= now {
		delete(r.seen, id)
		r.seenOrder.Remove(entry)
		return false
	}
	return true
}
func (r *Router) rememberLocked(p *packet) {
	if r.seen[p.id] != nil {
		return
	}
	if len(r.seen) >= 4096 {
		old := r.seenOrder.Front()
		delete(r.seen, old.Value.(seenEntry).id)
		r.seenOrder.Remove(old)
	}
	r.seen[p.id] = r.seenOrder.PushBack(seenEntry{p.id, p.expires})
}
func (r *Router) maintainLocked(now int64) {
	for id, value := range r.retained {
		if value.packet.expires <= now {
			r.removeRetainedLocked(id)
		}
	}
	for element := r.seenOrder.Front(); element != nil; {
		next := element.Next()
		value := element.Value.(seenEntry)
		if value.expires <= now {
			delete(r.seen, value.id)
			r.seenOrder.Remove(element)
		}
		element = next
	}
}
func (r *Router) retainLocked(p *packet, encoded []byte, relayOnly bool) (*retained, error) {
	r.maintainLocked(time.Now().UnixMilli())
	// Priority retention can outlive the bounded seen history. A replay must
	// reuse its immutable snapshot before capacity admission: overwriting it
	// would count its bytes twice and could evict unrelated pending content.
	if existing := r.retained[p.id]; existing != nil {
		return existing, nil
	}
	for len(r.retained) >= MaxTransfers || r.retainedBytes+len(encoded) > MaxPendingBytes {
		var victim *retained
		for _, value := range r.retained {
			if priorityRank(value.packet.priority) < priorityRank(p.priority) {
				continue
			}
			if victim == nil || priorityRank(value.packet.priority) > priorityRank(victim.packet.priority) || (value.packet.priority == victim.packet.priority && value.sequence < victim.sequence) {
				victim = value
			}
		}
		if victim == nil {
			r.counters.Dropped++
			return nil, ErrCapacity
		}
		r.removeRetainedLocked(victim.packet.id)
		r.counters.Dropped++
	}
	r.sequence++
	value := &retained{p, encoded, relayOnly, r.sequence}
	r.retained[p.id] = value
	r.retainedBytes += len(encoded)
	return value, nil
}

// Broadcast snapshots payload before returning. relayOnly marks inventory/seed traffic
// that must be discarded when relaying is paused; it is never added to the wire.
func (r *Router) Broadcast(payload any, priority Priority, ttl time.Duration, relayOnly bool) (string, error) {
	return r.broadcast(payload, priority, ttl, relayOnly, 0)
}

// BroadcastUntil binds a locally authorized transfer to an absolute deadline,
// including time spent copying/canonicalizing its payload.
func (r *Router) BroadcastUntil(payload any, priority Priority, ttl time.Duration, relayOnly bool, deadlineMS int64) (string, error) {
	if deadlineMS <= 0 {
		return "", errors.New("invalid authorization deadline")
	}
	return r.broadcast(payload, priority, ttl, relayOnly, deadlineMS)
}
func (r *Router) broadcast(payload any, priority Priority, ttl time.Duration, relayOnly bool, deadlineMS int64) (string, error) {
	if !validPriority(priority) || ttl < time.Millisecond || ttl > MaxTTL || ttl%time.Millisecond != 0 {
		return "", errors.New("invalid priority or TTL")
	}
	bytes, err := core.Canonical(payload)
	if err != nil {
		return "", err
	}
	if len(bytes) > MaxPacketBytes {
		return "", ErrCapacity
	}
	snapshot, err := core.DecodeJSON(bytes, MaxPacketBytes)
	if err != nil {
		return "", err
	}
	now := time.Now().UnixMilli()
	expires := now + ttl.Milliseconds()
	if deadlineMS != 0 {
		expires = min(expires, deadlineMS)
	}
	if expires <= now {
		return "", errors.New("authorization deadline expired")
	}
	p := &packet{source: r.id, created: now, expires: expires, maxHops: MaxHops, hops: []string{r.id}, priority: priority, payload: snapshot}
	body, err := core.Canonical(p.body())
	if err != nil {
		return "", err
	}
	p.id = core.Hash(body)
	encoded, err := core.Canonical(p.object())
	if err != nil {
		return "", err
	}
	if len(encoded) > MaxPacketBytes {
		return "", ErrCapacity
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return "", ErrClosed
	}
	if relayOnly && !r.relay {
		return p.id, nil
	}
	if r.hasSeenLocked(p.id, now) {
		return p.id, nil
	}
	value, err := r.retainLocked(p, encoded, relayOnly)
	if err != nil {
		return p.id, err
	}
	r.rememberLocked(p)
	for link := range r.links {
		link.enqueueLocked(value)
	}
	return p.id, nil
}

// Attach requires an ordered stream whose Close interrupts concurrent Read and Write.
// No Bluetooth, JNI, serial or radio device discovery is implemented by this API.
func (r *Router) Attach(stream io.ReadWriteCloser, options LinkOptions) (*Link, error) {
	if stream == nil {
		return nil, errors.New("nil stream")
	}
	if options.Medium == "" {
		options.Medium = "stream"
	}
	if len(options.Medium) > 32 || len(options.Address) > 512 {
		return nil, errors.New("invalid adapter metadata")
	}
	if options.RetryInterval == 0 {
		options.RetryInterval = 120 * time.Second
		if options.Medium == "tcp" {
			options.RetryInterval = 2 * time.Second
		}
	}
	if options.WriteTimeout == 0 {
		options.WriteTimeout = 120 * time.Second
		if options.Medium == "tcp" {
			options.WriteTimeout = 10 * time.Second
		}
	}
	if options.RetryInterval < time.Millisecond || options.WriteTimeout < time.Millisecond {
		return nil, errors.New("invalid adapter timeout")
	}
	id, err := randomID(8)
	if err != nil {
		return nil, err
	}
	link := newLink(r, stream, options, id)
	r.mu.Lock()
	if r.stopped || len(r.links) >= MaxLinks {
		r.mu.Unlock()
		stream.Close()
		return nil, ErrCapacity
	}
	r.links[link] = struct{}{}
	for _, value := range r.retained {
		if !value.relayOnly || r.relay {
			link.enqueueLocked(value)
		}
	}
	r.wg.Add(2)
	r.mu.Unlock()
	go link.readLoop()
	go link.writeLoop()
	return link, nil
}
func (r *Router) ListenTCP(address string) (net.Addr, error) {
	if address == "" {
		address = "127.0.0.1:0"
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	if r.stopped || r.listener != nil {
		r.mu.Unlock()
		listener.Close()
		return nil, ErrClosed
	}
	r.listener = listener
	r.wg.Add(1)
	r.mu.Unlock()
	go func() {
		defer r.wg.Done()
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			if tcp, ok := connection.(*net.TCPConn); ok {
				tcp.SetNoDelay(true)
			}
			if _, err = r.Attach(connection, LinkOptions{Medium: "tcp", Address: connection.RemoteAddr().String()}); err != nil {
				connection.Close()
			}
		}
	}()
	return listener.Addr(), nil
}

// ConnectTCP reconnects until cancellation/Close. Retained unexpired packets are
// offered to every replacement connection; this is bounded in-memory retry only.
func (r *Router) ConnectTCP(address string) (context.CancelFunc, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	number, err := strconv.Atoi(port)
	if err != nil || host == "" || len(host) > 253 || number < 1 || number > 65535 {
		return nil, errors.New("invalid TCP address")
	}
	ctx, cancel := context.WithCancel(r.ctx)
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		cancel()
		return nil, ErrClosed
	}
	if len(r.connectors) >= MaxLinks {
		r.mu.Unlock()
		cancel()
		return nil, ErrCapacity
	}
	r.sequence++
	connector := r.sequence
	r.connectors[connector] = struct{}{}
	r.wg.Add(1)
	r.mu.Unlock()
	go func() {
		defer r.wg.Done()
		defer func() { r.mu.Lock(); delete(r.connectors, connector); r.mu.Unlock() }()
		for {
			connection, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", address)
			if err == nil {
				link, attachErr := r.Attach(connection, LinkOptions{Medium: "tcp", Address: address})
				if attachErr == nil {
					select {
					case <-ctx.Done():
						link.Close()
						return
					case <-link.done:
					}
				} else {
					connection.Close()
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}()
	return cancel, nil
}
func (r *Router) Close() error {
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return nil
	}
	r.stopped = true
	r.cancel()
	listener := r.listener
	links := make([]*Link, 0, len(r.links))
	for link := range r.links {
		links = append(links, link)
	}
	r.mu.Unlock()
	if listener != nil {
		listener.Close()
	}
	for _, link := range links {
		link.Close()
	}
	r.wg.Wait()
	r.mu.Lock()
	r.retained = make(map[string]*retained)
	r.retainedBytes = 0
	r.seen = make(map[string]*list.Element)
	r.seenOrder.Init()
	r.deliveries = nil
	r.deliveryBytes = 0
	r.mu.Unlock()
	return nil
}
func (r *Router) receive(p *packet, source *Link) error {
	payload, err := core.Canonical(p.payload)
	if err != nil {
		return err
	}
	if r.options.Validate != nil {
		if err = r.options.Validate(json.RawMessage(payload)); err != nil {
			return err
		}
	}
	var forwarded *packet
	var encoded []byte
	if len(p.hops) < p.maxHops {
		next := *p
		next.hops = append(append([]string{}, p.hops...), r.id)
		forwarded = &next
		encoded, err = core.Canonical(next.object())
		if err != nil {
			return err
		}
		if len(encoded) > MaxPacketBytes {
			forwarded = nil
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped || !source.active {
		return ErrClosed
	}
	now := time.Now().UnixMilli()
	if p.expires <= now {
		return errors.New("expired packet")
	}
	if r.hasSeenLocked(p.id, now) {
		r.counters.Duplicates++
		return nil
	}
	for _, hop := range p.hops {
		if hop == r.id {
			r.counters.Duplicates++
			return nil
		}
	}
	if len(r.deliveries) >= 64 || r.deliveryBytes+len(payload) > MaxPendingBytes {
		r.counters.Dropped++
		return ErrCapacity
	}
	r.rememberLocked(p)
	r.counters.Received++
	r.deliveries = append(r.deliveries, Delivery{json.RawMessage(payload), Route{append([]string{}, p.hops...), source.options.Medium, p.source, p.id}})
	r.deliveryBytes += len(payload)
	select {
	case r.deliveryWake <- struct{}{}:
	default:
	}
	if r.relay && forwarded != nil {
		value, retainErr := r.retainLocked(forwarded, encoded, true)
		if retainErr == nil {
			for link := range r.links {
				if link != source && link.enqueueLocked(value) {
					r.counters.Forwarded++
				}
			}
		}
	}
	return nil
}
func integer(value any) (int64, bool) {
	var number float64
	switch v := value.(type) {
	case json.Number:
		n, err := v.Float64()
		if err != nil {
			return 0, false
		}
		number = n
	case float64:
		number = v
	case int64:
		return v, true
	case int:
		return int64(v), true
	default:
		return 0, false
	}
	if number < -9007199254740991 || number > 9007199254740991 {
		return 0, false
	}
	n := int64(number)
	return n, float64(n) == number
}
func decodePacket(data []byte) (*packet, error) {
	value, err := core.DecodeJSON(data, MaxPacketBytes)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok || len(object) != 8 {
		return nil, errors.New("invalid packet fields")
	}
	p := &packet{}
	p.id, _ = object["id"].(string)
	p.source, _ = object["source"].(string)
	priority, _ := object["priority"].(string)
	p.priority = Priority(priority)
	p.payload = object["payload"]
	var createdOK, expiresOK, hopsOK bool
	p.created, createdOK = integer(object["created"])
	p.expires, expiresOK = integer(object["expires"])
	maxHops, hopsOK := integer(object["maxHops"])
	p.maxHops = int(maxHops)
	hops, arrayOK := object["hops"].([]any)
	now := time.Now().UnixMilli()
	if !validID(p.id) || !validName(p.source) || !validPriority(p.priority) || !createdOK || !expiresOK || !hopsOK || p.created > now+300_000 || p.expires <= now || p.expires <= p.created || p.expires-p.created > MaxTTL.Milliseconds() || p.maxHops < 1 || p.maxHops > MaxHops || !arrayOK || len(hops) < 1 || len(hops) > p.maxHops {
		return nil, errors.New("invalid packet")
	}
	unique := make(map[string]bool)
	for _, value := range hops {
		hop, ok := value.(string)
		if !ok || !validName(hop) || unique[hop] {
			return nil, errors.New("invalid hops")
		}
		unique[hop] = true
		p.hops = append(p.hops, hop)
	}
	if p.hops[0] != p.source {
		return nil, errors.New("invalid source hop")
	}
	body, err := core.Canonical(p.body())
	if err != nil {
		return nil, err
	}
	if core.Hash(body) != p.id {
		return nil, fmt.Errorf("packet hash mismatch")
	}
	return p, nil
}
