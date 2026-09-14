// Package webpeer is an opt-in, origin/capability-bound WebSocket transport, not a control API.
package webpeer

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/transport"
	"github.com/coder/websocket"
)

const Protocol = "relayloom-stream-v1"
const maxFrame = transport.MaxFrameBytes + 1

var addressPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var noncePattern = regexp.MustCompile(`^[a-f0-9-]{36}$`)

type Invitation struct {
	Version  int    `json:"version"`
	Endpoint string `json:"endpoint"`
	Token    string `json:"token"`
	Origin   string `json:"origin"`
	Expires  int64  `json:"expires"`
}
type Options struct {
	Origin         string
	Host           string
	Port           int
	AdvertisedHost string
	TTL            time.Duration
	TLS            *tls.Config
}
type State struct {
	Endpoint    string `json:"endpoint"`
	Origin      string `json:"origin"`
	Expires     int64  `json:"expires"`
	Connections int    `json:"connections"`
	Active      bool   `json:"active"`
}
type rate struct {
	at    time.Time
	count int
}
type Server struct {
	invitation Invitation
	ctx        context.Context
	cancel     context.CancelFunc
	http       *http.Server
	listener   net.Listener
	timer      *time.Timer
	mu         sync.Mutex
	clients    map[*stream]bool
	rates      map[string]rate
	pending    int
	stopped    bool
	once       sync.Once
	wg         sync.WaitGroup
}

func WebOrigin(origin string) (string, error) {
	if len(origin) > 2048 {
		return "", errors.New("origem web inválida")
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(u.Host, "* \t\r\n/\\") || strings.ToLower(u.Host) != u.Host {
		return "", errors.New("origem web inválida")
	}
	if u.String() != origin || u.ForceQuery || strings.HasSuffix(u.Host, ":") {
		return "", errors.New("origem web não canónica")
	}
	for _, character := range u.Host {
		if character > 127 {
			return "", errors.New("origem web não canónica")
		}
	}
	if port := u.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 0 || number > 65535 || (u.Scheme == "http" && number == 80) || (u.Scheme == "https" && number == 443) {
			return "", errors.New("porta da origem inválida")
		}
	}
	return origin, nil
}
func isLoopback(host string) bool { return host == "127.0.0.1" || host == "::1" || host == "localhost" }
func Listen(router *transport.Router, options Options) (*Server, error) {
	origin, err := WebOrigin(options.Origin)
	if err != nil {
		return nil, err
	}
	host := options.Host
	if host == "" {
		host = "127.0.0.1"
	}
	ttl := options.TTL
	if ttl == 0 {
		ttl = 10 * time.Minute
	}
	if options.Port < 0 || options.Port > 65535 || ttl < time.Second || ttl > time.Hour || (!isLoopback(host) && options.TLS == nil) {
		return nil, errors.New("WebSocket requer TLS fora de loopback")
	}
	advertised := options.AdvertisedHost
	if advertised == "" {
		advertised = host
	}
	advertised = strings.Trim(advertised, "[]")
	if advertised == "0.0.0.0" || advertised == "::" || advertised == "" || strings.ContainsAny(advertised, "* /\\?#@\t\r\n") {
		return nil, errors.New("endereço anunciado inválido")
	}
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(options.Port)))
	if err != nil {
		return nil, err
	}
	listener = &limitedListener{Listener: listener, slots: make(chan struct{}, 32)}
	scheme := "ws"
	if options.TLS != nil {
		config := options.TLS.Clone()
		if config.MaxVersion != 0 && config.MaxVersion < tls.VersionTLS12 {
			listener.Close()
			return nil, errors.New("TLS1.2 ou superior é obrigatório")
		}
		if config.MinVersion < tls.VersionTLS12 {
			config.MinVersion = tls.VersionTLS12
		}
		config.NextProtos = []string{"http/1.1"}
		listener = tls.NewListener(listener, config)
		scheme = "wss"
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{ctx: ctx, cancel: cancel, listener: listener, clients: map[*stream]bool{}, rates: map[string]rate{}}
	endpoint := scheme + "://" + net.JoinHostPort(advertised, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)) + "/relayloom"
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Hostname() != advertised {
		listener.Close()
		cancel()
		return nil, errors.New("endereço anunciado inválido")
	}
	s.invitation = Invitation{1, endpoint, hex.EncodeToString(secret), origin, time.Now().Add(ttl).UnixMilli()}
	s.http = &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 2 * time.Second, MaxHeaderBytes: 8192}
	s.http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.handle(router, w, r) })
	s.timer = time.AfterFunc(ttl, func() {
		s.mu.Lock()
		clients := make([]*stream, 0, len(s.clients))
		for client := range s.clients {
			clients = append(clients, client)
		}
		s.mu.Unlock()
		for _, client := range clients {
			client.Close()
		}
	})
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		_ = s.http.Serve(listener)
	}()
	return s, nil
}
func (s *Server) Invitation() Invitation { return s.invitation }
func (s *Server) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return State{s.invitation.Endpoint, s.invitation.Origin, s.invitation.Expires, len(s.clients), !s.stopped && time.Now().UnixMilli() < s.invitation.Expires}
}
func (s *Server) handle(router *transport.Router, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		w.WriteHeader(404)
		return
	}
	deny := func() { w.WriteHeader(403) }
	offered := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
	hasProtocol := false
	token := ""
	for _, part := range offered {
		part = strings.TrimSpace(part)
		if part == Protocol {
			hasProtocol = true
		}
		if strings.HasPrefix(part, "invite-") {
			token = strings.TrimPrefix(part, "invite-")
		}
	}
	endpoint, _ := url.Parse(s.invitation.Endpoint)
	valid := r.Method == "GET" && r.URL.RequestURI() == "/relayloom" && r.Host == endpoint.Host && r.Header.Get("Origin") == s.invitation.Origin && len(offered) == 2 && hasProtocol && addressPattern.MatchString(token) && subtle.ConstantTimeCompare([]byte(token), []byte(s.invitation.Token)) == 1
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	now := time.Now()
	s.mu.Lock()
	for key, value := range s.rates {
		if now.Sub(value.at) >= time.Minute {
			delete(s.rates, key)
		}
	}
	rr, exists := s.rates[ip]
	if !exists {
		rr = rate{at: now}
	}
	if !exists && len(s.rates) >= 128 {
		s.mu.Unlock()
		deny()
		return
	}
	rr.count++
	s.rates[ip] = rr
	if !valid || s.stopped || now.UnixMilli() >= s.invitation.Expires || rr.count > 30 || len(s.clients)+s.pending >= 8 {
		s.mu.Unlock()
		deny()
		return
	}
	s.pending++
	s.wg.Add(1)
	s.mu.Unlock()
	pending := true
	defer func() {
		s.mu.Lock()
		if pending {
			s.pending--
		}
		s.mu.Unlock()
		s.wg.Done()
	}()
	origin, _ := url.Parse(s.invitation.Origin)
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{Protocol}, OriginPatterns: []string{origin.Host}, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxFrame)
	client := newStream(s.ctx, conn)
	s.mu.Lock()
	s.pending--
	pending = false
	if s.stopped || time.Now().UnixMilli() >= s.invitation.Expires {
		s.mu.Unlock()
		client.Close()
		return
	}
	s.clients[client] = true
	s.mu.Unlock()
	link, err := router.Attach(client, transport.LinkOptions{Medium: "websocket", Address: r.RemoteAddr, RetryInterval: 2 * time.Second, WriteTimeout: 10 * time.Second})
	if err != nil {
		client.Close()
	} else {
		client.discard = link.DiscardAssembly
		close(client.ready)
		go client.controlLoop()
	}
	// The handler stays alive for this owned connection; request context is not used as stream lifetime.
	<-client.done
	s.mu.Lock()
	delete(s.clients, client)
	s.mu.Unlock()
}
func (s *Server) Close() error {
	s.once.Do(func() {
		s.mu.Lock()
		s.stopped = true
		clients := make([]*stream, 0, len(s.clients))
		for client := range s.clients {
			clients = append(clients, client)
		}
		s.mu.Unlock()
		s.timer.Stop()
		s.cancel()
		for _, client := range clients {
			client.Close()
		}
		_ = s.http.Close()
		s.wg.Wait()
	})
	return nil
}

type stream struct {
	ctx                         context.Context
	cancel                      context.CancelFunc
	conn                        *websocket.Conn
	ready                       chan struct{}
	done                        chan struct{}
	controls                    chan []byte
	discard                     func(string)
	buffer                      []byte
	window                      time.Time
	frames, bytes, controlCount int
	once                        sync.Once
	closeQueued                 atomic.Bool
}

func newStream(parent context.Context, conn *websocket.Conn) *stream {
	ctx, cancel := context.WithCancel(parent)
	return &stream{ctx: ctx, cancel: cancel, conn: conn, ready: make(chan struct{}), done: make(chan struct{}), controls: make(chan []byte, 64), window: time.Now()}
}
func (s *stream) Close() error {
	s.once.Do(func() { s.cancel(); _ = s.conn.CloseNow(); close(s.done) })
	return nil
}
func (s *stream) control(value any) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return
	}
	bytes = append(bytes, '\n')
	select {
	case <-s.done:
		return
	case s.controls <- bytes:
	default:
		if s.closeQueued.CompareAndSwap(false, true) {
			s.cancel()
			go s.Close()
		}
	}
}

// Non-blocking; transport cancellation can call this while holding the router mutex.
func (s *stream) CancelPacket(id string) {
	if addressPattern.MatchString(id) {
		s.control(map[string]any{"t": "drop", "id": id})
	}
}
func (s *stream) controlLoop() {
	for {
		select {
		case <-s.done:
			return
		case data := <-s.controls:
			if _, err := s.Write(data); err != nil {
				s.Close()
				return
			}
		}
	}
}
func (s *stream) Read(target []byte) (int, error) {
	select {
	case <-s.ready:
	case <-s.done:
		return 0, io.EOF
	}
	for len(s.buffer) == 0 {
		_, data, err := s.conn.Read(s.ctx)
		if err != nil {
			return 0, err
		}
		now := time.Now()
		if now.Sub(s.window) >= time.Second {
			s.window = now
			s.frames = 0
			s.bytes = 0
			s.controlCount = 0
		}
		s.frames++
		s.bytes += len(data)
		if len(data) < 2 || len(data) > maxFrame || data[len(data)-1] != '\n' || s.frames > 8192 || s.bytes > 12*1024*1024 {
			return 0, errors.New("invalid websocket frame")
		}
		value, err := core.DecodeJSON(data, transport.MaxFrameBytes+1)
		if err != nil {
			return 0, err
		}
		frame, ok := value.(map[string]any)
		if !ok {
			return 0, errors.New("invalid websocket frame")
		}
		kind, _ := frame["t"].(string)
		if kind == "ping" || kind == "drop" {
			s.controlCount++
			if s.controlCount > 64 || len(frame) != 2 {
				return 0, errors.New("invalid websocket control")
			}
			if kind == "ping" {
				nonce, _ := frame["nonce"].(string)
				if !noncePattern.MatchString(nonce) {
					return 0, errors.New("invalid nonce")
				}
				s.control(map[string]any{"t": "pong", "nonce": nonce})
			} else {
				id, _ := frame["id"].(string)
				if !addressPattern.MatchString(id) {
					return 0, errors.New("invalid id")
				}
				s.discard(id)
			}
			continue
		}
		s.buffer = data
	}
	n := copy(target, s.buffer)
	s.buffer = s.buffer[n:]
	return n, nil
}
func (s *stream) Write(data []byte) (int, error) {
	if len(data) > maxFrame {
		return 0, errors.New("frame too large")
	}
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	if err := s.conn.Write(ctx, websocket.MessageBinary, data); err != nil {
		return 0, err
	}
	return len(data), nil
}

// Bound unauthenticated sockets as well as accepted WebSocket sessions.
type limitedListener struct {
	net.Listener
	slots chan struct{}
}
type limitedConn struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *limitedConn) Close() error { err := c.Conn.Close(); c.once.Do(c.release); return err }
func (l *limitedListener) Accept() (net.Conn, error) {
	for {
		c, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		select {
		case l.slots <- struct{}{}:
			return &limitedConn{Conn: c, release: func() { <-l.slots }}, nil
		default:
			c.Close()
		}
	}
}
