package app

import (
	"context"
	"net"
	"net/url"
	"sync"
	"testing"
	"time"
)

func TestWebPeerInvalidInputPreservesListenerAndCloseRetiresCapability(t *testing.T) {
	n, _ := nodeFor(t, "Web owner")
	invite, err := n.InviteWeb("https://relayloom.test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = n.InviteWeb("https://relayloom.test/path"); err == nil {
		t.Fatal("invalid origin accepted")
	}
	state, err := n.State()
	if err != nil || state["webPeer"] == nil {
		t.Fatal("invalid input lost the existing listener")
	}
	endpoint, _ := url.Parse(invite.Endpoint)
	conn, err := net.DialTimeout("tcp", endpoint.Host, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	conn.Close()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				_, _ = n.State()
			}
		}()
	}
	if err = n.StopWebPeer(); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	conn, err = net.DialTimeout("tcp", endpoint.Host, time.Second)
	if err == nil {
		conn.Close()
		t.Fatal("revoked data listener remains reachable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { n.Close(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("close deadlocked")
	}
}
