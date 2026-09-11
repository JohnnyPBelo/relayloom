package app

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

const password = "native application regression phrase"

func tempDir(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../..", ".cache", "native-app-tests")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "app-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}
func nodeFor(t *testing.T, name string) (*Node, core.PublicIdentity) {
	t.Helper()
	node, err := NewNode(tempDir(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { node.Close() })
	value, err := node.Handle("setup", map[string]any{"name": name, "password": password})
	if err != nil {
		t.Fatal(err)
	}
	return node, value.(core.PublicIdentity)
}
func apply(t *testing.T, n *Node, operation string, body map[string]any) any {
	t.Helper()
	value, err := n.Handle(operation, body)
	if err != nil {
		t.Fatalf("%s: %v", operation, err)
	}
	return value
}
func objectsFor(t *testing.T, n *Node) []DisplayObject {
	t.Helper()
	state, err := n.State()
	if err != nil {
		t.Fatal(err)
	}
	return state["objects"].([]DisplayObject)
}
func transfer(t *testing.T, from, to *Node, id string) {
	t.Helper()
	b, err := from.Store.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = to.Store.Put(b, false); err != nil {
		t.Fatal(err)
	}
}
func publish(t *testing.T, n *Node, c Content, readers any) DisplayObject {
	t.Helper()
	o, err := n.Publish(c, readers, 0)
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func TestApplicationMessagesGroupsReceiptsAndPrivacy(t *testing.T) {
	a, alice := nodeFor(t, "Alice")
	b, bob := nodeFor(t, "Bob")
	apply(t, a, "contact", map[string]any{"contact": bob})
	message := publish(t, a, Content{"type": "message", "text": "Private conversation"}, []string{bob.ID})
	transfer(t, a, b, message.ID)
	if findObject(objectsFor(t, b), message.ID) == nil {
		t.Fatal("private message absent")
	}
	apply(t, b, "view", map[string]any{"id": message.ID})
	var receiptID string
	for _, m := range b.Store.List() {
		if m.Kind == "receipt" {
			receiptID = m.ID
		}
	}
	if receiptID == "" {
		t.Fatal("signed receipt missing")
	}
	transfer(t, b, a, receiptID)
	if findObject(objectsFor(t, a), receiptID) == nil {
		t.Fatal("receipt was not authorized")
	}
	if _, err := b.Publish(Content{"type": "edit", "target": message.ID, "text": "Forgery"}, []string{alice.ID}, 0); err == nil {
		t.Fatal("reader edited another author")
	}
	if _, err := b.Publish(Content{"type": "reaction", "target": message.ID, "emoji": "heart"}, "public", 0); err == nil {
		t.Fatal("private event widened privacy")
	}
	group := publish(t, a, Content{"type": "group", "title": "Neighbours"}, []string{bob.ID})
	transfer(t, a, b, group.ID)
	reply := publish(t, b, Content{"type": "message", "text": "Group reply", "conversation": group.ID}, []string{alice.ID})
	transfer(t, b, a, reply.ID)
	if findObject(objectsFor(t, a), reply.ID) == nil {
		t.Fatal("valid group reply rejected")
	}
	post := publish(t, a, Content{"type": "post", "text": "Community"}, "public")
	transfer(t, a, b, post.ID)
	comment := publish(t, b, Content{"type": "comment", "target": post.ID, "text": "Hello"}, "public")
	transfer(t, b, a, comment.ID)
	if findObject(objectsFor(t, a), comment.ID) == nil {
		t.Fatal("public comment rejected")
	}
	if _, err := a.Handle("serial", map[string]any{"path": "/dev/ttyUSB0", "baud": 115200}); err == nil {
		t.Fatal("unsupported serial falsely succeeded")
	}
}

func TestInboundSemanticACLRejectsSignedForgeriesAndViewBypass(t *testing.T) {
	n, alice := nodeFor(t, "Alice")
	bob, err := core.CreateIdentity("Bob")
	if err != nil {
		t.Fatal(err)
	}
	eve, err := core.CreateIdentity("Eve")
	if err != nil {
		t.Fatal(err)
	}
	apply(t, n, "contact", map[string]any{"contact": bob.Public})
	message := publish(t, n, Content{"type": "message", "text": "Private"}, []string{bob.Public.ID})
	makeBundle := func(author core.Identity, kind string, payload any, readers []core.PublicIdentity, public bool) core.Bundle {
		b, err := core.CreateBundle(author, kind, payload, readers, public, core.DefaultTTL)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	fakes := []core.Bundle{
		makeBundle(eve, "receipt", Content{"type": "receipt", "target": message.ID}, nil, true),
		makeBundle(bob, "message", Content{"type": "message", "text": "Public impostor", "conversation": message.Content["conversation"], "members": []core.PublicIdentity{alice, bob.Public}}, nil, true),
		makeBundle(bob, "edit", Content{"type": "edit", "target": message.ID, "text": "Owner forgery"}, []core.PublicIdentity{alice}, false),
		makeBundle(bob, "reaction", Content{"type": "reaction", "target": message.ID, "emoji": "heart"}, []core.PublicIdentity{alice, eve.Public}, false),
		makeBundle(bob, "group", Content{"type": "group", "title": "Wrong roster", "members": []core.PublicIdentity{alice, bob.Public, eve.Public}}, []core.PublicIdentity{alice}, false),
	}
	for _, b := range fakes {
		if _, err := n.Store.Put(b, false); err != nil {
			t.Fatal(err)
		}
	}
	accepted := objectsFor(t, n)
	for _, b := range fakes {
		if findObject(accepted, b.Manifest.ID) != nil {
			t.Fatal("forged event displayed")
		}
		if _, err = n.Handle("view", map[string]any{"id": b.Manifest.ID}); err == nil {
			t.Fatal("view bypassed authorization")
		}
	}
	valid := makeBundle(bob, "receipt", Content{"type": "receipt", "target": message.ID}, []core.PublicIdentity{alice}, false)
	n.Store.Put(valid, false)
	if findObject(objectsFor(t, n), valid.Manifest.ID) == nil {
		t.Fatal("legitimate receipt rejected")
	}
}

func TestDeletionSurvivesImmediateOriginalEvictionEventLossAndRestart(t *testing.T) {
	n, _ := nodeFor(t, "Owner")
	original := publish(t, n, Content{"type": "post", "text": strings.Repeat("p", 12000)}, "public")
	bundle, err := n.Store.Get(original.ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := core.Canonical(bundle)
	if err != nil {
		t.Fatal(err)
	}
	n.Store, err = core.NewContentStore(filepath.Join(n.Dir, "store"), int64(len(encoded)+1), core.MaxStoredObjects)
	if err != nil {
		t.Fatal(err)
	}
	next := n.cloneConfig()
	next.Quota = int64(len(encoded) + 1)
	if err = n.saveConfigLocked(next); err != nil {
		t.Fatal(err)
	}
	deleted := publish(t, n, Content{"type": "delete", "target": original.ID}, "public")
	if n.Store.Has(original.ID) {
		t.Fatal("quota fault did not evict original")
	}
	if err = n.Store.Remove(deleted.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = n.Store.Put(bundle, false); err != nil {
		t.Fatal(err)
	}
	seen := findObject(objectsFor(t, n), original.ID)
	if seen == nil || !seen.Deleted {
		t.Fatal("original resurrected after cache loss")
	}
	dir := n.Dir
	n.Close()
	restored, err := NewNode(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	apply(t, restored, "unlock", map[string]any{"password": password})
	seen = findObject(objectsFor(t, restored), original.ID)
	if seen == nil || !seen.Deleted {
		t.Fatal("deletion lost on restart")
	}
}

func TestJournalEditTieOrderDraftEncryptionAndTamperRejection(t *testing.T) {
	n, _ := nodeFor(t, "Owner")
	original := publish(t, n, Content{"type": "post", "text": "Original"}, "public")
	now := time.Now().UnixMilli()
	one, err := core.CreateBundleAt(*n.identity, "edit", Content{"type": "edit", "target": original.ID, "text": "One"}, nil, true, core.DefaultTTL, now)
	if err != nil {
		t.Fatal(err)
	}
	two, err := core.CreateBundleAt(*n.identity, "edit", Content{"type": "edit", "target": original.ID, "text": "Two"}, nil, true, core.DefaultTTL, now)
	if err != nil {
		t.Fatal(err)
	}
	lower, higher := one, two
	want := "Two"
	if one.Manifest.ID > two.Manifest.ID {
		lower, higher = two, one
		want = "One"
	}
	n.Store.Put(higher, false)
	objectsFor(t, n)
	n.Store.Put(lower, false)
	got := findObject(objectsFor(t, n), original.ID)
	if got == nil || got.EditedText == nil || *got.EditedText != want {
		t.Fatal("edit tie ordering differs by arrival")
	}
	apply(t, n, "site-draft", map[string]any{"theme": "forest", "blocks": []any{map[string]any{"id": "hero", "type": "hero", "title": "Private draft phrase", "body": "Offline local idea"}}})
	data, err := os.ReadFile(filepath.Join(n.Dir, "private-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("Private draft phrase")) {
		t.Fatal("draft stored plaintext")
	}
	apply(t, n, "lock", map[string]any{})
	apply(t, n, "unlock", map[string]any{"password": password})
	state, err := n.State()
	if err != nil {
		t.Fatal(err)
	}
	if state["siteDraft"] == nil {
		t.Fatal("draft lost on unlock")
	}
	value, err := core.DecodeJSON(data, privateLimit*3/2)
	if err != nil {
		t.Fatal(err)
	}
	m := value.(map[string]any)
	m["data"] = "AAAA"
	bad, _ := core.Canonical(m)
	if err = os.WriteFile(filepath.Join(n.Dir, "private-state.json"), bad, 0600); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "lock", map[string]any{})
	if _, err = n.Handle("unlock", map[string]any{"password": password}); err == nil || n.identity != nil {
		t.Fatal("tampered private state unlocked")
	}
}

func TestCollectionsFollowingRetrievalAndPrivateMetadata(t *testing.T) {
	n, owner := nodeFor(t, "Owner")
	post := publish(t, n, Content{"type": "post", "text": "Collected"}, "public")
	id := "00000001-0000-4000-8000-000000000000"
	apply(t, n, "collection", map[string]any{"action": "create", "id": id, "title": "  Café  "})
	apply(t, n, "collection", map[string]any{"action": "add", "id": id, "objectId": post.ID})
	apply(t, n, "collection", map[string]any{"action": "rename", "id": id, "title": "Private collection phrase"})
	apply(t, n, "action", map[string]any{"action": "follow", "target": owner.ID, "value": true})
	state, err := n.State()
	if err != nil {
		t.Fatal(err)
	}
	collections := state["collections"].([]Collection)
	if len(collections) != 1 || len(collections[0].ObjectIDs) != 1 || !contains(state["followedPostIds"].([]string), post.ID) {
		t.Fatal("social state missing")
	}
	stored, _ := os.ReadFile(filepath.Join(n.Dir, "private-state.json"))
	if bytes.Contains(stored, []byte("Private collection phrase")) {
		t.Fatal("collection metadata plaintext")
	}
	if _, err = n.Handle("collection", map[string]any{"action": "rename", "id": id, "title": "Forged", "ownerId": strings.Repeat("f", 64)}); err == nil {
		t.Fatal("collection owner override accepted")
	}
	if _, err = n.Handle("collection", map[string]any{"action": "add", "id": id, "objectId": strings.Repeat("0", 64)}); err == nil {
		t.Fatal("unavailable reference added")
	}
	available := apply(t, n, "retrieve", map[string]any{"id": post.ID}).(map[string]any)
	if available["status"] != "available" {
		t.Fatal("available lookup wrong")
	}
	requested := apply(t, n, "retrieve", map[string]any{"id": strings.Repeat("0", 64)}).(map[string]any)
	if requested["status"] != "requested" {
		t.Fatal("explicit retrieval not queued")
	}
	if _, err = n.Handle("retrieve", map[string]any{"id": "../../vault"}); err == nil {
		t.Fatal("path reference accepted")
	}
	alien, err := core.CreateIdentity("Alien")
	if err != nil {
		t.Fatal(err)
	}
	private, err := core.CreateBundle(alien, "message", Content{"type": "message", "text": "Not for owner"}, nil, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	n.Store.Put(private, false)
	unreadable := apply(t, n, "retrieve", map[string]any{"id": private.Manifest.ID}).(map[string]any)
	if unreadable["status"] != "unreadable" {
		t.Fatal("reference conferred read access")
	}
	apply(t, n, "collection", map[string]any{"action": "remove", "id": id, "objectId": post.ID})
	apply(t, n, "collection", map[string]any{"action": "delete", "id": id})
	if !n.Store.Has(post.ID) {
		t.Fatal("deleting collection deleted original")
	}
}

func TestHTTPAuthenticationOriginPathsAndStateArrays(t *testing.T) {
	dir := tempDir(t)
	assets := filepath.Join(dir, "web")
	if err := os.MkdirAll(assets, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "index.html"), []byte("<main>Local native test shell</main>"), 0600); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(dir, "private.txt")
	os.WriteFile(secret, []byte("Outside assets secret"), 0600)
	os.Symlink(secret, filepath.Join(assets, "leak.txt"))
	service, err := Start(filepath.Join(dir, "data"), assets)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	call := func(path, token, origin, host string) (int, []byte) {
		t.Helper()
		req, err := http.NewRequest("GET", service.Origin+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if host != "" {
			req.Host = host
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body
	}
	if status, _ := call("/api/state", "", "", ""); status != 401 {
		t.Fatal("unauthenticated API", status)
	}
	if status, _ := call("/api/state", service.Token, "https://evil.example", ""); status != 403 {
		t.Fatal("origin check missing", status)
	}
	if status, _ := call("/api/state", service.Token, "", "evil.example"); status != 403 {
		t.Fatal("host check missing", status)
	}
	connection, err := net.Dial("tcp", strings.TrimPrefix(service.Origin, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(connection, "GET /%% HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", strings.TrimPrefix(service.Origin, "http://"))
	response, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	connection.Close()
	if response.StatusCode != 400 {
		t.Fatal("malformed path not rejected")
	}
	status, data := call("/api/state", service.Token, "", "")
	if status != 200 {
		t.Fatal("service did not survive")
	}
	value, err := core.DecodeJSON(data, core.MaxBundleBytes)
	if err != nil {
		t.Fatal(err)
	}
	state := value.(map[string]any)
	for _, key := range []string{"peers", "contacts", "objects", "collections", "followedPostIds", "blocked", "following", "saved", "reports"} {
		if _, ok := state[key].([]any); !ok {
			t.Fatalf("%s is not an array: %T", key, state[key])
		}
	}
	if state["identity"] != nil || state["siteDraft"] != nil {
		t.Fatal("locked state leaked identity/draft")
	}
	if _, data = call("/leak.txt", "", "", ""); bytes.Contains(data, []byte("Outside assets secret")) {
		t.Fatal("asset symlink escaped root")
	}
	if status, body := call("/", "", "", ""); status != 200 || !bytes.Contains(body, []byte("Local native test shell")) {
		t.Fatal("local assets not served")
	}
}

func TestApplicationRelayPauseBlocksCachedServing(t *testing.T) {
	n, _ := nodeFor(t, "Relay")
	if err := n.Start(0, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	author, err := core.CreateIdentity("Offline author")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := core.CreateBundle(author, "post", Content{"type": "post", "text": "Exact seeded original"}, nil, true, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	n.Store.Put(bundle, false)
	apply(t, n, "settings", map[string]any{"relay": false})
	peer, err := transport.New(transport.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	cancel, err := peer.ConnectTCP(net.JoinHostPort("127.0.0.1", fmt.Sprint(n.TCPPort)))
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	deadline := time.Now().Add(3 * time.Second)
	for len(peer.Peers()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if len(peer.Peers()) == 0 {
		t.Fatal("peer not connected")
	}
	request := map[string]any{"type": "request", "ids": []string{bundle.Manifest.ID}}
	if _, err = peer.Broadcast(request, transport.Normal, time.Minute, false); err != nil {
		t.Fatal(err)
	}
	ctx, done := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer done()
	if delivery, err := peer.Next(ctx); err == nil {
		t.Fatalf("paused relay emitted %s", delivery.Payload)
	}
	apply(t, n, "settings", map[string]any{"relay": true})
	if _, err = peer.Broadcast(request, transport.Normal, time.Minute, false); err != nil {
		t.Fatal(err)
	}
	ctx2, done2 := context.WithTimeout(context.Background(), 3*time.Second)
	defer done2()
	for {
		delivery, err := peer.Next(ctx2)
		if err != nil {
			t.Fatal(err)
		}
		value, err := core.DecodeJSON(delivery.Payload, transport.MaxPacketBytes)
		if err != nil {
			t.Fatal(err)
		}
		m := value.(map[string]any)
		if text(m["type"]) != "bundle" {
			continue
		}
		received, err := decodeBundle(m["bundle"])
		if err != nil || received.Manifest.ID != bundle.Manifest.ID || received.Manifest.Author.ID != author.Public.ID {
			t.Fatal("seeded bytes/author mismatch", err)
		}
		break
	}
}
