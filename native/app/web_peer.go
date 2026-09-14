package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/webpeer"
)

func (n *Node) InviteWeb(origin string) (webpeer.Invitation, error) {
	if _, err := webpeer.WebOrigin(origin); err != nil {
		return webpeer.Invitation{}, err
	}
	// Do not hold the application's state mutex over socket setup/shutdown.
	n.webPeerMu.Lock()
	defer n.webPeerMu.Unlock()
	n.mu.Lock()
	if n.closed || n.identity == nil {
		n.mu.Unlock()
		return webpeer.Invitation{}, errors.New("desbloqueie a identidade")
	}
	owner := n.identity
	previous := n.webPeer
	n.webPeer = nil
	n.mu.Unlock()
	if previous != nil {
		previous.Close()
	}
	peer, err := webpeer.Listen(n.Router, webpeer.Options{Origin: origin})
	if err != nil {
		return webpeer.Invitation{}, err
	}
	n.mu.Lock()
	if n.closed || n.identity != owner {
		n.mu.Unlock()
		peer.Close()
		return webpeer.Invitation{}, errors.New("o nó foi bloqueado entretanto")
	}
	n.webPeer = peer
	n.mu.Unlock()
	return peer.Invitation(), nil
}
func (n *Node) StopWebPeer() error {
	n.webPeerMu.Lock()
	defer n.webPeerMu.Unlock()
	n.mu.Lock()
	peer := n.webPeer
	n.webPeer = nil
	n.mu.Unlock()
	if peer != nil {
		return peer.Close()
	}
	return nil
}
func (n *Node) webPeerStateLocked() any {
	if n.webPeer == nil {
		return nil
	}
	return n.webPeer.State()
}
