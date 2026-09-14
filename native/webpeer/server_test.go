package webpeer

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/transport"
	"github.com/coder/websocket"
)

func dial(t *testing.T, s *Server, origin, token string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return websocket.Dial(ctx, s.Invitation().Endpoint, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{origin}}, Subprotocols: []string{Protocol, "invite-" + token}})
}
func heartbeat(t *testing.T, client *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	nonce := "11111111-1111-1111-1111-111111111111"
	if err := client.Write(ctx, websocket.MessageText, []byte(`{"t":"ping","nonce":"`+nonce+`"}`+"\n")); err != nil {
		t.Fatal(err)
	}
	_, data, err := client.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var pong map[string]string
	if json.Unmarshal(data, &pong) != nil || pong["t"] != "pong" || pong["nonce"] != nonce {
		t.Fatal("heartbeat failed")
	}
}
func TestInvitationOriginCapabilitiesAndConnectionLimit(t *testing.T) {
	r, err := transport.New(transport.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	const origin = "https://relayloom.test"
	s, err := Listen(r, Options{Origin: origin})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, bad := range []struct{ origin, token string }{{"https://evil.test", s.Invitation().Token}, {origin, strings.Repeat("0", 64)}} {
		c, response, e := dial(t, s, bad.origin, bad.token)
		if c != nil {
			c.CloseNow()
		}
		if e == nil || response == nil || response.StatusCode != 403 {
			t.Fatal("invalid capability/origin was not refused")
		}
	}
	response, err := http.Get(strings.Replace(s.Invitation().Endpoint, "ws://", "http://", 1) + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("transport exposed a control endpoint")
	}
	clients := []*websocket.Conn{}
	defer func() {
		for _, c := range clients {
			c.CloseNow()
		}
	}()
	for i := 0; i < 8; i++ {
		c, _, err := dial(t, s, origin, s.Invitation().Token)
		if err != nil {
			t.Fatalf("valid peer %d of 8 was refused: %v", i+1, err)
		}
		clients = append(clients, c)
		// HTTP101 may reach Dial before Accept returns in the server goroutine.
		// A real protocol response proves registration and router attachment;
		// do not turn pending upgrades into reported active connections.
		heartbeat(t, c)
	}
	if s.State().Connections != 8 {
		t.Fatalf("expected8 connections, got%d", s.State().Connections)
	}
	c, response, err := dial(t, s, origin, s.Invitation().Token)
	if c != nil {
		c.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != 403 {
		t.Fatal("connection cap missing")
	}
	heartbeat(t, clients[0])
}
func TestInvitationExpiryAndCleartextScope(t *testing.T) {
	r, _ := transport.New(transport.Options{})
	defer r.Close()
	if s, err := Listen(r, Options{Origin: "https://relayloom.test", Host: "0.0.0.0"}); err == nil {
		s.Close()
		t.Fatal("unencrypted non-loopback accepted")
	}
	for _, origin := range []string{"null", "file://host", "https://*.test", "https://example.test/path", "https://user@example.test", "https://EXAMPLE.test", "https://relayloom.test:443", "http://localhost:65536", "https://relayloom.test?", "https://relayloom.test#"} {
		if _, err := WebOrigin(origin); err == nil {
			t.Fatalf("bad origin accepted: %q", origin)
		}
	}
	s, err := Listen(r, Options{Origin: "https://relayloom.test", TTL: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c, _, err := dial(t, s, s.Invitation().Origin, s.Invitation().Token)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err = c.Read(ctx)
	if err == nil {
		t.Fatal("expired connection remained usable")
	}
	if s.State().Active {
		t.Fatal("expired invitation active")
	}
	later, response, err := dial(t, s, s.Invitation().Origin, s.Invitation().Token)
	if later != nil {
		later.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != 403 {
		t.Fatal("expired invitation accepted")
	}
}
