package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupaccess"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupcontrol"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groupnotice"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profiledb"
	"github.com/JohnnyPBelo/relayloom/native/profilelock"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"github.com/JohnnyPBelo/relayloom/native/transport"
	"github.com/JohnnyPBelo/relayloom/native/webpeer"
)

type Node struct {
	webPeerMu           sync.Mutex
	webPeer             *webpeer.Server
	mu                  sync.Mutex
	Dir                 string
	Store               *core.ContentStore
	Router              *transport.Router
	TCPPort             int
	identity            *core.Identity
	wireIdentity        *atomic.Pointer[core.Identity]
	resourceRuntime     *resourceRuntime
	contributionRuntime *contributionRuntime
	siteRuntime         *siteRuntime
	config              Config
	private             PrivateState
	// Per-node persistence seam for exercising uncertain completion boundaries.
	writePrivateState  func([]byte, string) (string, error)
	updateGroupState   func(func(*groupstore.Tx) error) error
	privateDatabase    *profiledb.Database
	privateDigest      string
	groupHolds         []groupledger.HeldRecord
	groupRetries       map[string]groupRetry
	groupEventSeeds    map[string]bool
	groupSync          *groupSynchronizer
	noticeSync         *noticeSynchronizer
	groupDecisions     map[string]groupaccess.Decision
	routes             map[string]transport.Route
	requests           map[string]int64
	receipts           map[string]bool
	cancellations      []context.CancelFunc
	ctx                context.Context
	cancel             context.CancelFunc
	wg                 sync.WaitGroup
	closed             bool
	ownership          *profilelock.Lease
	closeDone          chan struct{}
	closeErr           error
	rejected           uint64
	lastTransportError string
	summaries          map[string]summaryEntry
	summaryBytes       int
	summaryIdentity    string
	summarySequence    uint64
}

func NewNode(dir string) (*Node, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	ownership, err := profilelock.Acquire(dir)
	if err != nil {
		return nil, err
	}
	retained := false
	defer func() {
		if !retained {
			_ = ownership.Close()
		}
	}()
	config := defaultConfig()
	data, err := readFile(filepath.Join(dir, "config.json"), 1024*1024)
	if err == nil {
		value, e := core.DecodeJSON(data, 1024*1024)
		if e != nil {
			return nil, e
		}
		config, e = parseConfig(value)
		if e != nil {
			return nil, e
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	store, err := core.NewContentStore(filepath.Join(dir, "store"), config.Quota, core.MaxStoredObjects)
	if err != nil {
		return nil, err
	}
	wireIdentity := new(atomic.Pointer[core.Identity])
	router, err := transport.New(transport.Options{DisableRelay: !config.Relay, Validate: func(raw json.RawMessage) error { return validateWireWithIdentity(raw, wireIdentity.Load()) }})
	if err != nil {
		return nil, err
	}
	router.SetLowPower(config.LowPower)
	ctx, cancel := context.WithCancel(context.Background())
	n := &Node{Dir: dir, Store: store, Router: router, config: config, private: emptyPrivate(), routes: map[string]transport.Route{}, requests: map[string]int64{}, receipts: map[string]bool{}, ctx: ctx, cancel: cancel, ownership: ownership, closeDone: make(chan struct{})}
	n.wireIdentity = wireIdentity
	n.clearSummariesLocked()
	n.groupSync = newGroupSynchronizer(n)
	n.noticeSync = newNoticeSynchronizer(n)
	n.wg.Add(2)
	go func() {
		defer n.wg.Done()
		for {
			delivery, err := router.Next(ctx)
			if err != nil {
				return
			}
			n.mu.Lock()
			if !n.closed {
				if err = n.receiveLocked(delivery); err != nil {
					n.rejected++
				}
			}
			n.mu.Unlock()
		}
	}()
	go func() {
		defer n.wg.Done()
		ticker := time.NewTicker(2200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n.mu.Lock()
				if !n.closed {
					n.syncLocked()
				}
				n.mu.Unlock()
			}
		}
	}()
	retained = true
	return n, nil
}
func (n *Node) Start(tcpPort int, host string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return errors.New("nó encerrado")
	}
	if host == "" {
		host = "127.0.0.1"
	}
	if tcpPort == -1 {
		n.TCPPort = -1
	} else {
		if tcpPort < 0 || tcpPort > 65535 {
			return errors.New("porta TCP inválida")
		}
		address, err := n.Router.ListenTCP(net.JoinHostPort(host, strconv.Itoa(tcpPort)))
		if err != nil {
			return err
		}
		n.TCPPort = address.(*net.TCPAddr).Port
	}
	for _, peer := range n.config.Peers {
		address, err := tcpAddress(peer.Host, peer.Port)
		if err != nil {
			return err
		}
		cancel, err := n.Router.ConnectTCP(address)
		if err != nil {
			return err
		}
		n.cancellations = append(n.cancellations, cancel)
	}
	return nil
}
func (n *Node) Close() error {
	n.mu.Lock()
	if n.closed {
		n.mu.Unlock()
		<-n.closeDone
		return n.closeErr
	}
	n.closed = true
	n.siteRuntime = nil
	if n.contributionRuntime != nil {
		n.contributionRuntime.close()
	}
	n.contributionRuntime = nil
	n.resourceRuntime = nil
	if n.wireIdentity != nil {
		n.wireIdentity.Store(nil)
	}
	n.cancel()
	cancellations := append([]context.CancelFunc{}, n.cancellations...)
	n.identity = nil
	n.private = emptyPrivate()
	n.clearSummariesLocked()
	n.groupHolds = nil
	n.groupRetries = nil
	n.groupEventSeeds = nil
	n.groupDecisions = nil
	n.mu.Unlock()
	for _, cancel := range cancellations {
		cancel()
	}
	webErr := n.StopWebPeer()
	err := n.Router.Close()
	n.wg.Wait()
	var privateErr error
	if n.privateDatabase != nil {
		privateErr = n.privateDatabase.Close()
		n.privateDatabase = nil
		n.privateDigest = ""
	}
	n.closeErr = errors.Join(err, webErr, privateErr, n.ownership.Close())
	close(n.closeDone)
	return n.closeErr
}
func (n *Node) initialized() bool {
	_, err := os.Stat(filepath.Join(n.Dir, "identity.vault"))
	return err == nil
}
func (n *Node) lockPrivateLocked() error {
	n.siteRuntime = nil
	if n.contributionRuntime != nil {
		n.contributionRuntime.close()
	}
	n.contributionRuntime = nil
	n.resourceRuntime = nil
	if n.wireIdentity != nil {
		n.wireIdentity.Store(nil)
	}
	n.cancelGroupPacketsLocked(true)
	if n.groupSync != nil {
		n.groupSync.reset()
		n.noticeSync.reset()
	}
	n.identity = nil
	n.private = emptyPrivate()
	n.privateDigest = ""
	n.clearSummariesLocked()
	n.groupHolds = nil
	n.groupRetries = nil
	n.groupEventSeeds = nil
	n.groupDecisions = nil
	if n.privateDatabase != nil {
		err := n.privateDatabase.Close()
		n.privateDatabase = nil
		return err
	}
	return nil
}
func (n *Node) persistPrivateLocked(next PrivateState) error {
	if n.identity == nil || n.privateDatabase == nil {
		return errors.New("desbloqueie a identidade")
	}
	data, err := core.Canonical(next)
	if err != nil {
		return err
	}
	writer := n.writePrivateState
	if writer == nil {
		writer = n.privateDatabase.Write
	}
	var digest string
	if hasGroupOutbox(n.private.Outbox) || hasGroupOutbox(next.Outbox) {
		update := n.updateGroupState
		if update == nil {
			update = n.privateDatabase.Update
		}
		err = update(func(tx *groupstore.Tx) error {
			current, err := profilestate.Read(tx)
			if err != nil {
				return err
			}
			if current == nil || current.Digest != n.privateDigest {
				return errors.New("estado privado desactualizado")
			}
			_, err = groupledger.Run(tx, *n.identity, func(l *groupledger.Ledger, _ *groupauthority.Registry) error {
				if _, err := reconcileGroupOutbox(l, next.Outbox); err != nil {
					return err
				}
				retained := map[string]bool{}
				for operation := range next.Outbox {
					retained[operation] = true
				}
				if err := l.RetireStops(retained); err != nil {
					return err
				}
				data, err := core.Canonical(next)
				if err != nil {
					return err
				}
				digest, err = profilestate.Write(tx, data, &n.privateDigest)
				return err
			})
			return err
		})
	} else {
		digest, err = writer(data, n.privateDigest)
	}
	if err != nil {
		// The SQL commit may have completed. Reopen only through the signed binding;
		// a legacy JSON snapshot must never replace initialized protected state.
		identity := *n.identity
		_ = n.privateDatabase.Close()
		database, recovered, currentDigest, readErr := openPrivateProfile(n.Dir, identity)
		if readErr == nil {
			n.privateDatabase = database
			n.private = recovered
			n.privateDigest = currentDigest
		} else {
			_ = n.lockPrivateLocked()
		}
		return err
	}
	n.privateDigest = digest
	n.private = next
	if n.contributionRuntime != nil {
		n.contributionRuntime.revokeInvalid()
	}
	return nil
}
func (n *Node) saveConfigLocked(next Config) error {
	data, err := core.Canonical(next)
	if err != nil {
		return err
	}
	if err = core.AtomicWrite(filepath.Join(n.Dir, "config.json"), data); err != nil {
		return err
	}
	n.config = next
	return nil
}
func (n *Node) cloneConfig() Config {
	c := n.config
	c.Contacts = append([]core.PublicIdentity{}, c.Contacts...)
	c.Blocked = append([]string{}, c.Blocked...)
	c.Following = append([]string{}, c.Following...)
	c.Saved = append([]string{}, c.Saved...)
	c.Reports = append([]Report{}, c.Reports...)
	c.Peers = append([]PeerAddress{}, c.Peers...)
	return c
}

func ValidateWire(raw json.RawMessage) error { return validateWireWithIdentity(raw, nil) }
func validateWireWithIdentity(raw json.RawMessage, identity *core.Identity) error {
	value, err := core.DecodeJSON(raw, transport.MaxPacketBytes)
	if err != nil {
		return err
	}
	m, err := object(value)
	if err != nil {
		return err
	}
	switch text(m["type"]) {
	case "bundle":
		var b core.Bundle
		b, err = decodeBundle(m["bundle"])
		if err == nil && b.Manifest.Kind == "group-control" {
			return groupcontrol.VerifyEnvelope(b)
		}
		if err == nil && b.Manifest.Kind == "group-notice" {
			return groupnotice.VerifyEnvelope(b)
		}
		if err == nil && b.Manifest.Kind == "site" {
			_, err = inspectSiteBundle(b, identity)
		}
		if err == nil {
			err = inspectResourceBundle(b, identity)
		}
		if err == nil {
			_, err = inspectContributionBundle(b, identity)
		}
		return err
	case "inventory", "request":
		_, err = stringsList(m["ids"], 64, true)
		return err
	default:
		return errors.New("protocolo inválido")
	}
}

// Cap every insertion before a fallible transport/store operation. Cleanup at
// the end of a successful handler would let errors bypass the bookkeeping cap.
func (n *Node) rememberRequestLocked(key string, at int64) {
	if _, exists := n.requests[key]; !exists && len(n.requests) >= 2048 {
		oldest := ""
		for candidate, previous := range n.requests {
			if oldest == "" || previous < n.requests[oldest] || (previous == n.requests[oldest] && candidate < oldest) {
				oldest = candidate
			}
		}
		delete(n.requests, oldest)
	}
	n.requests[key] = at
}

// Journal an incoming authoritative mutation while the verified original still
// exists. Store.Put may evict that original. Without a decryption key or original
// we retain the encrypted event only; later materialization is best effort.
func (n *Node) journalReceivedMutationLocked(bundle core.Bundle) error {
	if n.identity == nil || (bundle.Manifest.Kind != "edit" && bundle.Manifest.Kind != "delete") {
		return nil
	}
	event, err := n.displayLocked(bundle)
	if err != nil {
		return nil
	}
	if groupaccess.HasBinding(event.Content) {
		return nil
	}
	original, err := n.authorizedObjectLocked(text(event.Content["target"]), false)
	if err != nil {
		return nil
	}
	return n.journalMutationLocked(event, bundle.Manifest, original)
}

func (n *Node) journalMutationLocked(event *DisplayObject, manifest core.Manifest, original *DisplayObject) error {
	if groupaccess.HasBinding(event.Content) || groupaccess.HasBinding(original.Content) {
		return nil
	}
	if related(original.Kind) || original.Author.ID != event.Author.ID || original.Public != event.Public || !equalIDs(original.Readers, event.Readers) {
		return nil
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return err
	}
	target := core.Manifest{ManifestBody: core.ManifestBody{Author: original.Author, Expires: original.Expires}, ID: original.ID}
	if !recordMutation(&next, target, manifest, event.Content) {
		return nil
	}
	return n.persistPrivateLocked(next)
}
func (n *Node) receiveLocked(delivery transport.Delivery) error {
	value, err := core.DecodeJSON(delivery.Payload, transport.MaxPacketBytes)
	if err != nil {
		return err
	}
	m, err := object(value)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	switch text(m["type"]) {
	case "bundle":
		b, err := decodeBundle(m["bundle"])
		if err != nil {
			return err
		}
		if _, err = inspectContributionBundle(b, n.identity); err != nil {
			return err
		}
		if _, err = inspectContributionReceipt(b, n.identity); err != nil {
			return err
		}
		if contains(n.config.Blocked, b.Manifest.Author.ID) && b.Manifest.Kind != "group-control" && b.Manifest.Kind != "group-notice" {
			return nil
		}
		if b.Manifest.Kind == "group-control" {
			if err = groupcontrol.VerifyEnvelope(b); err != nil {
				return err
			}
			if _, err = n.Store.Put(b, false); err != nil {
				return err
			}
			n.groupSync.receive(b, false)
			return nil
		}
		if b.Manifest.Kind == "group-notice" {
			if err = groupnotice.VerifyEnvelope(b); err != nil {
				return err
			}
			if _, err = n.Store.Put(b, false); err != nil {
				return err
			}
			n.noticeSync.receive(b)
			return nil
		}
		if err = n.journalReceivedMutationLocked(b); err != nil {
			return err
		}
		if err = n.journalReceivedConfirmationLocked(b); err != nil {
			return err
		}
		if b.Manifest.Kind == "site" {
			parsed, e := inspectSiteBundle(b, n.identity)
			if e != nil {
				return e
			}
			if parsed != nil && n.identity != nil {
				s, e := n.sitesLocked()
				if e != nil {
					return e
				}
				if e = s.receive(b); e != nil {
					return e
				}
			}
		}
		if n.identity != nil {
			incoming, e := n.displayLocked(b)
			if e == nil && groupaccess.HasBinding(incoming.Content) && (text(incoming.Content["target"]) != "" || text(incoming.Content["replyTo"]) != "") {
				if _, err = n.objectsLocked(); err != nil {
					return err
				}
			}
		}
		if n.identity != nil && (b.Manifest.Kind == "site-contribution" || b.Manifest.Kind == "site" || b.Manifest.Kind == "site-contribution-receipt") {
			r, e := n.contributionsLocked()
			if e != nil {
				return e
			}
			if b.Manifest.Kind == "site-contribution" {
				e = r.receive(b)
			} else if b.Manifest.Kind == "site-contribution-receipt" {
				e = r.receiveReceipt(b)
			} else {
				e = r.receiveSource(b)
			}
			if e != nil {
				return e
			}
		}
		added, err := n.Store.Put(b, false)
		if err != nil {
			return err
		}
		if added {
			n.routes[b.Manifest.ID] = delivery.Route
			if len(n.routes) > 1000 {
				for id := range n.routes {
					delete(n.routes, id)
					break
				}
			}
		}
	case "inventory":
		ids, err := stringsList(m["ids"], 64, true)
		if err != nil {
			return err
		}
		missing := make([]string, 0, 8)
		for _, id := range ids {
			if len(missing) == 8 {
				break
			}
			if !n.Store.Has(id) && now-n.requests[id] > 5000 {
				missing = append(missing, id)
				n.rememberRequestLocked(id, now)
			}
		}
		if len(missing) > 0 {
			_, err = n.Router.Broadcast(map[string]any{"type": "request", "ids": missing}, transport.Normal, 2*time.Minute, true)
			if err != nil {
				return err
			}
		}
	case "request":
		ids, err := stringsList(m["ids"], 64, true)
		if err != nil {
			return err
		}
		supported := map[string]bool{}
		if n.identity != nil {
			r, e := n.contributionsLocked()
			if e != nil {
				return e
			}
			for _, id := range ids[:min(8, len(ids))] {
				served, e := r.respondSource(id)
				if e != nil {
					return e
				}
				supported[id] = served
			}
		}
		if !n.config.Relay {
			return nil
		}
		if err := n.reconcileGroupSendsLocked(); err != nil {
			return err
		}
		for _, id := range ids[:min(8, len(ids))] {
			if !supported[id] && n.Store.Has(id) && now-n.requests["serve:"+id] > 1000 {
				n.rememberRequestLocked("serve:"+id, now)
				b, err := n.Store.GetWithTouch(id, false)
				if err != nil {
					return err
				}
				allowed, err := n.maySeedLocked(b.Manifest)
				if err != nil {
					return err
				}
				if !allowed {
					continue
				}
				priority := transport.Bulk
				if b.Manifest.Kind == "alert" {
					priority = transport.SOS
				}
				if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": b}, priority, 2*time.Minute, true); err != nil {
					return err
				}
			}
		}
	default:
		return errors.New("protocolo inválido")
	}
	return nil
}
func (n *Node) syncLocked() {
	if n.identity != nil {
		if err := n.groupSync.tick(); err != nil {
			n.lastTransportError = "Sincronização de grupos adiada; estado por verificar"
			return
		}
		if err := n.noticeSync.tick(); err != nil {
			n.lastTransportError = "Sincronização de avisos adiada; estado por verificar"
			return
		}
		objects, err := n.objectsLocked()
		if err != nil {
			n.lastTransportError = "Não foi possível atualizar o envio persistente"
			return
		}
		n.issueDeliveriesLocked(objects)
		n.flushOutboxLocked(time.Now().UnixMilli())
		if n.identity != nil {
			if s, e := n.sitesLocked(); e == nil {
				s.tick()
			}
			if c, e := n.contributionsLocked(); e == nil {
				if e = c.tick(); e != nil {
					n.lastTransportError = "Envio de proposta adiado; estado por verificar"
				}
			}
			if r, e := n.resourcesLocked(); e == nil {
				if e = r.tick(); e != nil {
					n.lastTransportError = "Criação de recurso adiada; estado por verificar"
				}
			}
		}
	}
	if !n.config.Relay {
		return
	}
	connected := false
	for _, p := range n.Router.Peers() {
		if p.Connected {
			connected = true
			break
		}
	}
	if !connected {
		return
	}
	manifests := n.Store.List()
	if len(manifests) == 0 {
		return
	}
	ids := make([]string, 0, len(manifests))
	for _, m := range manifests {
		if m.Kind == "site-resource" {
			continue
		}
		allowed, err := n.maySeedLocked(m)
		if err != nil {
			n.lastTransportError = "Partilha adiada; estado local por verificar"
			return
		}
		if allowed {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	pages := max(64, ((len(ids)+63)/64)*64)
	start := int((time.Now().UnixMilli() / 2200) * 64 % int64(pages))
	if start > len(ids) {
		start = len(ids)
	}
	_, _ = n.Router.Broadcast(map[string]any{"type": "inventory", "ids": ids[start:min(start+64, len(ids))]}, transport.Normal, 2*time.Minute, true)
}

func (n *Node) displayLocked(bundle core.Bundle) (*DisplayObject, error) {
	value, err := core.DecryptBundle(bundle, n.identity)
	if err != nil {
		return nil, err
	}
	m, err := object(value)
	if err != nil {
		return nil, err
	}
	content := Content(m)
	manifest := bundle.Manifest
	if text(content["type"]) != manifest.Kind {
		return nil, errors.New("tipo não corresponde ao manifesto")
	}
	if _, versioned := content["siteRevision"]; manifest.Kind == "site" && versioned {
		if _, err = sites.VerifyContent(map[string]any(content), manifest.Author, ""); err != nil {
			return nil, err
		}
	} else if err = validateContent(content); err != nil {
		return nil, err
	}
	if manifest.Kind == "site-contribution" {
		if _, err = sites.MatchContributionEnvelope(bundle, m); err != nil {
			return nil, err
		}
	}
	if manifest.Kind == "site-contribution-receipt" {
		if _, err = sites.MatchContributionReceiptEnvelope(bundle, m); err != nil {
			return nil, err
		}
	}
	if groupaccess.HasBinding(content) {
		if _, err = groupaccess.ParseBinding(content); err != nil {
			return nil, err
		}
	}
	readers := make([]string, 0, len(manifest.Keys))
	for _, k := range manifest.Keys {
		readers = append(readers, k.Reader)
	}
	o := &DisplayObject{ID: manifest.ID, Author: manifest.Author, Kind: manifest.Kind, Created: manifest.Created, Expires: manifest.Expires, Content: content, Pinned: n.Store.IsPinned(manifest.ID), Readers: readers, Public: manifest.PublicKey != nil}
	if route, ok := n.routes[o.ID]; ok {
		o.Route = route
	}
	return o, nil
}
func findObject(all []DisplayObject, id string) *DisplayObject {
	for i := range all {
		if all[i].ID == id {
			return &all[i]
		}
	}
	return nil
}
func authorized(o DisplayObject, all []DisplayObject) bool {
	if groupaccess.HasBinding(o.Content) {
		return false
	}
	seen := map[string]bool{}
	for _, id := range o.Readers {
		if seen[id] {
			return false
		}
		seen[id] = true
	}
	if !o.Public && !seen[o.Author.ID] {
		return false
	}
	if contains([]string{"message", "group", "receipt", "delivery"}, o.Kind) && o.Public {
		return false
	}
	if related(o.Kind) {
		original := findObject(all, text(o.Content["target"]))
		if original == nil || related(original.Kind) || !authorized(*original, all) {
			return false
		}
		if (o.Kind == "edit" || o.Kind == "delete") && original.Author.ID != o.Author.ID {
			return false
		}
		if o.Public != original.Public || !equalIDs(o.Readers, original.Readers) {
			return false
		}
		if !original.Public && !contains(original.Readers, o.Author.ID) {
			return false
		}
		if (o.Kind == "receipt" || o.Kind == "delivery") && (original.Kind != "message" || o.Author.ID == original.Author.ID) {
			return false
		}
		return true
	}
	if o.Kind == "message" || o.Kind == "group" {
		cards, err := members(o.Content["members"])
		if err != nil || !equalIDs(memberIDs(cards), o.Readers) {
			return false
		}
		if o.Kind == "group" {
			return trimmed(text(o.Content["title"])) != ""
		}
		conversation := text(o.Content["conversation"])
		if strings.HasPrefix(conversation, "dm:") {
			return conversation == "dm:"+core.Hash([]byte(strings.Join(sorted(o.Readers), ":")))
		}
		group := findObject(all, conversation)
		return group != nil && group.Kind == "group" && authorized(*group, all) && equalIDs(group.Readers, o.Readers)
	}
	return true
}
func recordMutation(next *PrivateState, target core.Manifest, event core.Manifest, content Content) bool {
	before, ok := next.Mutations[target.ID]
	kind := text(content["type"])
	if ok && event.Created < before.Created && (kind != "delete" || before.Deleted) {
		return false
	}
	if ok && event.Created == before.Created && event.ID <= before.EventID && (kind != "delete" || before.Deleted) {
		return false
	}
	m := Mutation{Author: target.Author.ID, Expires: target.Expires, Created: event.Created, EventID: event.ID, Deleted: before.Deleted || kind == "delete"}
	if !m.Deleted {
		s := text(content["text"])
		m.Text = &s
	}
	next.Mutations[target.ID] = m
	return true
}
func (n *Node) objectsLocked() ([]DisplayObject, error) {
	objects, _, _, err := n.objectsSnapshotLocked()
	return objects, err
}
func (n *Node) objectsSnapshotLocked() ([]DisplayObject, map[string]core.Manifest, int64, error) {
	all := make([]DisplayObject, 0)
	if n.identity == nil {
		n.clearSummariesLocked()
		return all, map[string]core.Manifest{}, time.Now().UnixMilli(), nil
	}
	if !n.groupSync.processing {
		n.groupSync.drain()
	}
	if n.identity == nil {
		return all, map[string]core.Manifest{}, time.Now().UnixMilli(), nil
	}
	if n.summaryIdentity != n.identity.Public.ID {
		n.clearSummariesLocked()
		n.summaryIdentity = n.identity.Public.ID
	}
	// List checks the bytes/fingerprint and verification cache of every object;
	// summaries can only be reused for IDs still present in that verified list.
	manifests := n.Store.List()
	verified := make(map[string]core.Manifest, len(manifests))
	for _, manifest := range manifests {
		verified[manifest.ID] = manifest
	}
	present := make(map[string]bool, len(manifests))
	for _, manifest := range manifests {
		if manifest.Kind != "group-control" && manifest.Kind != "group-notice" && (manifest.Kind == "group" || !contains(n.config.Blocked, manifest.Author.ID)) {
			present[manifest.ID] = true
		}
	}
	for id := range n.summaries {
		if !present[id] {
			n.removeSummaryLocked(id)
		}
	}
	for _, manifest := range manifests {
		// An already retained signed group remains an ACL dependency for
		// messages by other authors. The blocked author's object stays hidden.
		if manifest.Kind == "group-control" || manifest.Kind == "group-notice" || (manifest.Kind != "group" && contains(n.config.Blocked, manifest.Author.ID)) {
			continue
		}
		if cached, exists := n.summaries[manifest.ID]; exists {
			n.summarySequence++
			cached.used = n.summarySequence
			n.summaries[manifest.ID] = cached
			copy := cloneSummary(cached.object)
			copy.Pinned = n.Store.IsPinned(manifest.ID)
			if route, ok := n.routes[manifest.ID]; ok {
				route.Hops = append([]string{}, route.Hops...)
				copy.Route = route
			}
			all = append(all, copy)
			continue
		}
		b, err := n.Store.GetWithTouch(manifest.ID, false)
		if err != nil {
			continue
		}
		o, err := n.displayLocked(b)
		if err == nil {
			summary := summarizeObject(*o)
			if err = n.cacheSummaryLocked(summary); err != nil {
				return nil, nil, 0, err
			}
			all = append(all, cloneSummary(summary))
		}
	}
	accepted := make([]DisplayObject, 0, len(all))
	groupObjects := []DisplayObject{}
	for _, o := range all {
		if groupaccess.HasBinding(o.Content) && !contains(n.config.Blocked, o.Author.ID) {
			groupObjects = append(groupObjects, o)
		}
	}
	inspected := map[string]groupInspection{}
	if len(groupObjects) > 0 || len(n.groupHolds) > 0 {
		var err error
		inspected, err = n.inspectGroupObjectsLocked(groupObjects, verified)
		if err != nil {
			return nil, nil, 0, err
		}
	}
	protected := make(map[string]bool, len(present))
	for id := range verified {
		protected[id] = true
	}
	for _, entry := range n.private.Outbox {
		protected[entry.ID] = true
	}
	n.groupDecisions = map[string]groupaccess.Decision{}
	for _, o := range all {
		if contains(n.config.Blocked, o.Author.ID) {
			continue
		}
		allowed := false
		if groupaccess.HasBinding(o.Content) {
			if !n.groupReplayReadyLocked() {
				continue
			}
			if observation, ok := inspected[o.ID]; ok && observation.Stable {
				n.groupDecisions[o.ID] = observation.Decision
				allowed = observation.Decision.Status == "accepted"
			} else {
				var err error
				allowed, err = n.observeGroupLocked(o.ID, protected)
				if err != nil {
					return nil, nil, 0, err
				}
			}
		} else {
			allowed = authorized(o, all)
		}
		if allowed {
			accepted = append(accepted, o)
		}
	}
	next, err := copyPrivate(n.private, n.identity.Public.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	changed := false
	for _, event := range accepted {
		if groupaccess.HasBinding(event.Content) {
			continue
		}
		if event.Kind != "edit" && event.Kind != "delete" {
			continue
		}
		original := findObject(accepted, text(event.Content["target"]))
		if original == nil {
			continue
		}
		target := core.Manifest{ManifestBody: core.ManifestBody{Author: original.Author, Expires: original.Expires}, ID: original.ID}
		m := core.Manifest{ManifestBody: core.ManifestBody{Created: event.Created}, ID: event.ID}
		if recordMutation(&next, target, m, event.Content) {
			changed = true
		}
	}
	for id, m := range next.Mutations {
		if m.Expires <= time.Now().UnixMilli() {
			delete(next.Mutations, id)
			changed = true
		}
	}
	if changed {
		if err = n.persistPrivateLocked(next); err != nil {
			return nil, nil, 0, err
		}
	}
	for i := range accepted {
		m, ok := n.private.Mutations[accepted[i].ID]
		if ok && m.Author == accepted[i].Author.ID {
			accepted[i].Deleted = m.Deleted
			if m.Text != nil {
				value := *m.Text
				accepted[i].EditedText = &value
			}
		}
	}
	if err = n.aggregateConfirmationsLocked(accepted, time.Now().UnixMilli()); err != nil {
		return nil, nil, 0, err
	}
	// Reserve changes and the displayed outbox use the same observation time.
	// Disk persistence/projection may cross an expiry before State returns.
	outboxAt := time.Now().UnixMilli()
	if err = n.reconcileOutboxManifestsLocked(outboxAt, false, verified); err != nil {
		return nil, nil, 0, err
	}
	return accepted, verified, outboxAt, nil
}
func (n *Node) State() (map[string]any, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return nil, errors.New("nó encerrado")
	}
	return n.stateLocked()
}
func (n *Node) stateLocked() (map[string]any, error) {
	objects, manifests, outboxAt, err := n.objectsSnapshotLocked()
	if err != nil {
		return nil, err
	}
	page, err := pageHistory(objects, "")
	if err != nil {
		return nil, err
	}
	var identity any
	contacts := []core.PublicIdentity{}
	blocked, following, saved, followed := []string{}, []string{}, []string{}, []string{}
	reports := []Report{}
	collections := []Collection{}
	var draft any
	if n.identity != nil {
		identity = n.identity.Public
		contacts = append(contacts, n.config.Contacts...)
		blocked = append(blocked, n.config.Blocked...)
		following = append(following, n.config.Following...)
		saved = append(saved, n.config.Saved...)
		reports = append(reports, n.config.Reports...)
		collections = append(collections, n.private.Collections...)
		if n.private.SiteDraft != nil {
			draft = n.private.SiteDraft
		}
		for _, o := range objects {
			if (o.Kind == "post" || o.Kind == "alert") && contains(following, o.Author.ID) {
				followed = append(followed, o.ID)
			}
		}
	}
	counters := n.Router.Counters()
	counters.Rejected += n.rejected
	return map[string]any{"initialized": n.initialized(), "locked": n.identity == nil, "identity": identity, "tcpPort": n.TCPPort, "peers": n.Router.Peers(), "webPeer": n.webPeerStateLocked(), "counters": counters, "storage": n.Store.Stats(), "settings": map[string]any{"relay": n.config.Relay, "lowPower": n.config.LowPower}, "contacts": contacts, "blocked": blocked, "following": following, "saved": saved, "reports": reports, "groupContent": n.groupContentStateLocked(), "objects": page.Objects, "outbox": n.outboxItemsLocked(outboxAt, manifests), "outboxPolicy": outboxPolicy(), "history": page.History, "followedPostIds": followed, "collections": collections, "siteDraft": siteDraftSummary(draft), "sitePublishing": n.siteStatusLocked(), "transportError": n.lastTransportError, "now": outboxAt, "nativeRuntime": "Go"}, nil
}

func (n *Node) Publish(content Content, recipients any, ttlMS int64) (DisplayObject, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.publishLocked(content, recipients, ttlMS)
}

type preparedPublication struct {
	bundle         core.Bundle
	content        Content
	mutationTarget *core.Manifest
	priority       transport.Priority
}

func (n *Node) prepareLocked(content Content, recipients any, ttlMS int64) (*preparedPublication, error) {
	if text(content["type"]) == "site-contribution" || text(content["type"]) == "site-contribution-receipt" {
		return nil, errors.New("envia propostas através do comando de contribuições")
	}
	if text(content["type"]) == "site-resource" {
		return nil, errors.New("guarda recursos opcionais através do gestor de recursos")
	}
	if n.identity == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	value, err := cloneValue(content)
	if err != nil {
		return nil, err
	}
	m, err := object(value)
	if err != nil {
		return nil, err
	}
	content = Content(m)
	if err = validateContent(content); err != nil {
		return nil, err
	}
	if text(content["type"]) == "site" {
		document, _ := content["site"].(map[string]any)
		version, _ := number(document["version"])
		if _, versioned := content["siteRevision"]; versioned || version >= 3 {
			return nil, errors.New("use a publicação versionada de sites")
		}
	}
	if groupaccess.HasBinding(content) {
		return nil, errors.New("o envio neste grupo ainda não está disponível")
	}
	kind := text(content["type"])
	public := text(recipients) == "public"
	readers := make([]core.PublicIdentity, 0)
	if !public {
		ids, err := stringsList(recipients, 64, true)
		if err != nil {
			return nil, err
		}
		ids = append(ids, n.identity.Public.ID)
		seen := map[string]bool{}
		for _, id := range ids {
			if seen[id] {
				continue
			}
			seen[id] = true
			if contains(n.config.Blocked, id) {
				return nil, errors.New("contacto bloqueado")
			}
			var card *core.PublicIdentity
			if id == n.identity.Public.ID {
				p := n.identity.Public
				card = &p
			} else {
				for _, p := range n.config.Contacts {
					if p.ID == id {
						p := p
						card = &p
						break
					}
				}
			}
			if card == nil {
				return nil, errors.New("adicione primeiro o cartão do destinatário")
			}
			readers = append(readers, *card)
		}
	}
	if kind == "group" && trimmed(text(content["title"])) == "" {
		return nil, errors.New("indique o nome do grupo")
	}
	if contains([]string{"message", "group", "receipt", "delivery"}, kind) && public {
		return nil, errors.New("conversas exigem destinatários privados")
	}
	if kind == "message" {
		attachments, _ := content["attachments"].([]any)
		if trimmed(text(content["text"])) == "" && len(attachments) == 0 {
			return nil, errors.New("escreva uma mensagem ou junte um anexo")
		}
		ids := memberIDs(readers)
		expected := "dm:" + core.Hash([]byte(strings.Join(sorted(ids), ":")))
		conversation := text(content["conversation"])
		if conversation == "" {
			conversation = expected
			content["conversation"] = conversation
		}
		if strings.HasPrefix(conversation, "dm:") {
			if conversation != expected {
				return nil, errors.New("destinatários não correspondem à conversa")
			}
		} else {
			objects, err := n.objectsLocked()
			if err != nil {
				return nil, err
			}
			group := findObject(objects, conversation)
			if group == nil || group.Kind != "group" || !contains(group.Readers, n.identity.Public.ID) || !equalIDs(group.Readers, ids) {
				return nil, errors.New("grupo ou autorização inválidos")
			}
		}
		content["members"] = readers
	}
	if kind == "group" {
		content["members"] = readers
	}
	var mutationTarget *core.Manifest
	if related(kind) {
		id := text(content["target"])
		original, err := n.Store.Get(id)
		if err != nil {
			return nil, err
		}
		originalValue, err := core.DecryptBundle(original, n.identity)
		if err != nil {
			return nil, err
		}
		if content, ok := originalValue.(map[string]any); ok && groupaccess.HasBinding(content) {
			return nil, errors.New("esta acção ainda não está disponível neste grupo")
		}
		objects, err := n.objectsLocked()
		if err != nil {
			return nil, err
		}
		if findObject(objects, id) == nil {
			return nil, errors.New("alvo sem autorização semântica")
		}
		if related(original.Manifest.Kind) {
			return nil, errors.New("alvo inválido")
		}
		if (kind == "receipt" || kind == "delivery") && (original.Manifest.Kind != "message" || original.Manifest.Author.ID == n.identity.Public.ID) {
			return nil, errors.New("confirmação de leitura inválida")
		}
		if kind == "edit" || kind == "delete" {
			if original.Manifest.Author.ID != n.identity.Public.ID {
				return nil, errors.New("só o autor pode alterar este conteúdo")
			}
			target := original.Manifest
			mutationTarget = &target
			ttlMS = max(1000, target.Expires-time.Now().UnixMilli())
		}
		targetPublic := original.Manifest.PublicKey != nil
		targetReaders := []string{}
		for _, k := range original.Manifest.Keys {
			targetReaders = append(targetReaders, k.Reader)
		}
		if public != targetPublic || (!public && !equalIDs(targetReaders, memberIDs(readers))) {
			return nil, errors.New("a privacidade deve corresponder ao conteúdo original")
		}
	}
	if ttlMS == 0 {
		ttlMS = core.DefaultTTL
	}
	bundle, err := core.CreateBundle(*n.identity, kind, content, readers, public, ttlMS)
	if err != nil {
		return nil, err
	}
	priority := transport.Priority(text(content["priority"]))
	if priority == "" {
		priority = transport.Normal
		if a, _ := content["attachments"].([]any); len(a) > 0 {
			priority = transport.Bulk
		}
	}
	return &preparedPublication{bundle, content, mutationTarget, priority}, nil
}
func (n *Node) publishLocked(content Content, recipients any, ttlMS int64) (DisplayObject, error) {
	if groupaccess.HasBinding(content) {
		return n.publishGroupEventLocked(content, recipients, ttlMS)
	}
	prepared, err := n.prepareLocked(content, recipients, ttlMS)
	if err != nil {
		return DisplayObject{}, err
	}
	bundle, content, mutationTarget, priority := prepared.bundle, prepared.content, prepared.mutationTarget, prepared.priority
	kind := bundle.Manifest.Kind
	if _, err = n.Store.Put(bundle, kind == "site" || kind == "group"); err != nil {
		return DisplayObject{}, err
	}
	if mutationTarget != nil {
		next, err := copyPrivate(n.private, n.identity.Public.ID)
		if err != nil {
			return DisplayObject{}, err
		}
		if recordMutation(&next, *mutationTarget, bundle.Manifest, content) {
			if err = n.persistPrivateLocked(next); err != nil {
				return DisplayObject{}, err
			}
		}
	}
	if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, priority, 2*time.Minute, false); err != nil {
		return DisplayObject{}, err
	}
	display, err := n.displayLocked(bundle)
	if err != nil {
		return DisplayObject{}, err
	}
	return *display, nil
}

func (n *Node) Handle(operation string, body map[string]any) (any, error) {
	if operation == "web-peer" {
		return n.InviteWeb(text(body["origin"]))
	}
	if operation == "web-peer-stop" {
		return map[string]any{"ok": true}, n.StopWebPeer()
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return nil, errors.New("nó encerrado")
	}
	if operation == "state" {
		return n.stateLocked()
	}
	switch operation {
	case "ui-preferences":
		return n.saveUIPreferencesLocked(body)
	case "setup":
		if n.initialized() {
			return nil, errors.New("já existe uma identidade neste nó")
		}
		password, err := fieldString(body, "password")
		if err != nil {
			return nil, err
		}
		var identity core.Identity
		if recovery := text(body["recovery"]); recovery != "" {
			identity, err = core.ImportVault(recovery, password)
		} else {
			identity, err = core.CreateIdentity(text(body["name"]))
		}
		if err != nil {
			return nil, err
		}
		vault, err := core.ExportVault(identity, password)
		if err != nil {
			return nil, err
		}
		if err = core.AtomicWrite(filepath.Join(n.Dir, "identity.vault"), []byte(vault)); err != nil {
			return nil, err
		}
		database, local, digest, err := openPrivateProfile(n.Dir, identity)
		if err != nil {
			return nil, err
		}
		n.identity = &identity
		if n.wireIdentity != nil {
			n.wireIdentity.Store(&identity)
		}
		n.siteRuntime = nil
		if n.contributionRuntime != nil {
			n.contributionRuntime.close()
		}
		n.contributionRuntime = nil
		n.resourceRuntime = nil
		n.private = local
		n.privateDatabase = database
		n.privateDigest = digest
		n.clearSummariesLocked()
		n.noticeSync.reset()
		n.groupSync.recover()
		if err = n.restoreGroupHoldsLocked(); err != nil {
			_ = n.lockPrivateLocked()
			return nil, err
		}
		if err = n.recoverOutboxLocked(time.Now().UnixMilli()); err != nil {
			_ = n.lockPrivateLocked()
			return nil, err
		}
		return identity.Public, nil
	case "unlock":
		password, err := fieldString(body, "password")
		if err != nil {
			return nil, err
		}
		vault, err := readFile(filepath.Join(n.Dir, "identity.vault"), 8192)
		if err != nil {
			return nil, err
		}
		identity, err := core.ImportVault(string(vault), password)
		if err != nil {
			return nil, err
		}
		database, local, digest, err := openPrivateProfile(n.Dir, identity)
		if err != nil {
			return nil, err
		}
		if n.privateDatabase != nil {
			_ = n.privateDatabase.Close()
		}
		n.identity = &identity
		if n.wireIdentity != nil {
			n.wireIdentity.Store(&identity)
		}
		n.siteRuntime = nil
		if n.contributionRuntime != nil {
			n.contributionRuntime.close()
		}
		n.contributionRuntime = nil
		n.resourceRuntime = nil
		n.private = local
		n.privateDatabase = database
		n.privateDigest = digest
		n.clearSummariesLocked()
		n.noticeSync.reset()
		n.groupSync.recover()
		if err = n.restoreGroupHoldsLocked(); err != nil {
			_ = n.lockPrivateLocked()
			return nil, err
		}
		if err = n.recoverOutboxLocked(time.Now().UnixMilli()); err != nil {
			_ = n.lockPrivateLocked()
			return nil, err
		}
		return identity.Public, nil
	case "lock":
		err := n.lockPrivateLocked()
		return map[string]bool{"ok": true}, err
	}
	if n.identity == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	switch operation {
	case "export":
		password, err := fieldString(body, "password")
		if err != nil {
			return nil, err
		}
		vault, err := core.ExportVault(*n.identity, password)
		return map[string]any{"vault": vault}, err
	case "group-command":
		return n.groupCommandLocked(body)
	case "contribution-command":
		if _, err := n.objectsLocked(); err != nil {
			return nil, err
		}
		runtime, err := n.contributionsLocked()
		if err != nil {
			return nil, err
		}
		return runtime.command(body)
	case "resource-command":
		r, err := n.resourcesLocked()
		if err != nil {
			return nil, err
		}
		return r.command(body)
	case "site-command":
		if text(body["action"]) == "publish" {
			if _, err := n.objectsLocked(); err != nil {
				return nil, err
			}
		}
		s, err := n.sitesLocked()
		if err != nil {
			return nil, err
		}
		return s.command(body)
	case "send":
		return n.sendLocked(body)
	case "outbox-retry":
		return n.retryOutboxLocked(text(body["operationId"]))
	case "publish":
		m, err := object(body["content"])
		if err != nil {
			return nil, err
		}
		ttl := int64(0)
		if value, ok := body["ttlMs"]; ok {
			ttl, err = number(value)
			if err != nil || ttl < 1000 || ttl > core.MaxTTL {
				return nil, errors.New("prazo inválido")
			}
		}
		return n.publishLocked(Content(m), body["recipients"], ttl)
	case "history":
		before := ""
		if value, exists := body["before"]; exists && value != nil {
			var ok bool
			before, ok = value.(string)
			if !ok {
				return nil, errors.New("cursor de histórico inválido")
			}
		}
		objects, err := n.objectsLocked()
		if err != nil {
			return nil, err
		}
		return pageHistory(objects, before)
	case "attachment":
		index, err := number(body["index"])
		if err != nil {
			return nil, err
		}
		return n.attachmentLocked(text(body["id"]), index)
	case "contact":
		p, err := publicIdentity(body["contact"])
		if err != nil {
			return nil, err
		}
		if p.ID == n.identity.Public.ID {
			return nil, errors.New("este cartão é da sua própria identidade")
		}
		next := n.cloneConfig()
		found := false
		for i, c := range next.Contacts {
			if c.ID == p.ID {
				next.Contacts[i] = p
				found = true
			}
		}
		if !found {
			if len(next.Contacts) >= 256 {
				return nil, errors.New("limite de contactos")
			}
			next.Contacts = append(next.Contacts, p)
		}
		if err = n.saveConfigLocked(next); err != nil {
			return nil, err
		}
	case "connect":
		host, err := fieldString(body, "host")
		if err != nil {
			return nil, err
		}
		port, err := number(body["port"])
		if err != nil {
			return nil, err
		}
		address, err := tcpAddress(host, int(port))
		if err != nil {
			return nil, err
		}
		for _, p := range n.config.Peers {
			if p.Host == host && p.Port == int(port) {
				return map[string]bool{"ok": true}, nil
			}
		}
		if len(n.config.Peers) >= 16 {
			return nil, errors.New("limite de ligações")
		}
		cancel, err := n.Router.ConnectTCP(address)
		if err != nil {
			return nil, err
		}
		next := n.cloneConfig()
		next.Peers = append(next.Peers, PeerAddress{host, int(port)})
		if err = n.saveConfigLocked(next); err != nil {
			cancel()
			return nil, err
		}
		n.cancellations = append(n.cancellations, cancel)
	case "serial":
		return nil, errors.New("adaptador série nativo ainda não implementado nesta aplicação; use TCP")
	case "settings":
		next := n.cloneConfig()
		if value, ok := body["relay"]; ok {
			v, err := boolean(value)
			if err != nil {
				return nil, err
			}
			next.Relay = v
		}
		if value, ok := body["lowPower"]; ok {
			v, err := boolean(value)
			if err != nil {
				return nil, err
			}
			next.LowPower = v
		}
		if value, ok := body["quota"]; ok {
			quota, err := number(value)
			if err != nil {
				return nil, err
			}
			if err = n.Store.SetQuota(quota); err != nil {
				return nil, err
			}
			next.Quota = quota
		}
		if err := n.saveConfigLocked(next); err != nil {
			return nil, err
		}
		n.Router.SetRelay(next.Relay)
		n.Router.SetLowPower(next.LowPower)
	case "site-draft-load":
		copied, err := copyPrivate(n.private, n.identity.Public.ID)
		if err != nil {
			return nil, err
		}
		return copied.SiteDraft, nil
	case "site-draft":
		theme, err := fieldString(body, "theme")
		if err != nil {
			return nil, err
		}
		content := Content{"type": "site", "blocks": body["blocks"], "theme": theme}
		for _, key := range []string{"site", "attachments"} {
			if value, exists := body[key]; exists {
				content[key] = value
			}
		}
		if err := validateContent(content); err != nil {
			return nil, err
		}
		next, err := copyPrivate(n.private, n.identity.Public.ID)
		if err != nil {
			return nil, err
		}
		next.SiteDraft = map[string]any{"blocks": body["blocks"], "theme": body["theme"], "savedAt": time.Now().UnixMilli()}
		if context, exists := body["editing"]; exists {
			if err = sites.ValidateEditingContext(context, n.identity.Public.ID); err != nil {
				return nil, err
			}
			next.SiteDraft["editing"] = context
		}
		for _, key := range []string{"site", "attachments"} {
			if value, exists := content[key]; exists {
				next.SiteDraft[key] = value
			}
		}
		if err = n.persistPrivateLocked(next); err != nil {
			return nil, err
		}
	case "collection":
		return n.collectionLocked(body)
	case "retrieve":
		id := text(body["id"])
		if !core.ValidAddress(id) {
			return nil, errors.New("endereço inválido")
		}
		if n.Store.Has(id) {
			objects, err := n.objectsLocked()
			if err != nil {
				return nil, err
			}
			status := "unreadable"
			if findObject(objects, id) != nil {
				status = "available"
			}
			return map[string]any{"status": status, "id": id}, nil
		}
		now := time.Now().UnixMilli()
		if now-n.requests["user:"+id] > 1500 {
			n.rememberRequestLocked("user:"+id, now)
			if _, err := n.Router.Broadcast(map[string]any{"type": "request", "ids": []string{id}}, transport.Normal, 2*time.Minute, false); err != nil {
				return nil, err
			}
		}
		return map[string]any{"status": "requested", "id": id}, nil
	case "action":
		if err := n.actionLocked(body); err != nil {
			return nil, err
		}
	case "view":
		return n.viewLocked(text(body["id"]))
	default:
		return nil, fmt.Errorf("operação desconhecida: %s", operation)
	}
	return map[string]bool{"ok": true}, nil
}
func (n *Node) actionLocked(body map[string]any) error {
	action, target := text(body["action"]), text(body["target"])
	value, err := boolean(body["value"])
	if err != nil {
		return err
	}
	if !core.ValidAddress(target) {
		return errors.New("endereço inválido")
	}
	if action == "pin" {
		return n.pinOutboxLocked(target, value)
	}
	next := n.cloneConfig()
	if action == "block" || action == "follow" || action == "save" {
		var list *[]string
		limit := 2048
		switch action {
		case "block":
			list = &next.Blocked
		case "follow":
			list = &next.Following
			limit = 256
		case "save":
			list = &next.Saved
		}
		filtered := make([]string, 0, len(*list)+1)
		for _, id := range *list {
			if id != target {
				filtered = append(filtered, id)
			}
		}
		if value {
			filtered = append(filtered, target)
		}
		if len(filtered) > limit {
			return errors.New("limite de preferências locais")
		}
		*list = filtered
	} else if action == "report" {
		reason := text(body["reason"])
		if trimmed(reason) == "" || jsLen(reason) > 500 {
			return errors.New("indique um motivo até 500 caracteres")
		}
		if len(next.Reports) >= 200 {
			next.Reports = next.Reports[len(next.Reports)-199:]
		}
		next.Reports = append(next.Reports, Report{target, reason, time.Now().UnixMilli()})
	} else {
		return errors.New("acção desconhecida")
	}
	if err := n.saveConfigLocked(next); err != nil {
		return err
	}
	if action == "block" {
		if n.contributionRuntime != nil {
			n.contributionRuntime.revokeInvalid()
		}
		n.cancelSitePacketsLocked()
		return n.reconcileGroupSendsLocked()
	}
	return nil
}
func (n *Node) viewLocked(id string) (DisplayObject, error) {
	o, err := n.materializedObjectLocked(id)
	if err != nil {
		return DisplayObject{}, err
	}
	if o.Kind == "message" && n.identity != nil && o.Author.ID != n.identity.Public.ID {
		n.rememberViewedMembersLocked(o)
		_ = n.ensureConfirmationLocked(o, "receipt")
	}
	return *o, nil
}
