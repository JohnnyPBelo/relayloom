package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func receiveBundleFor(t *testing.T, n *Node, bundle core.Bundle) error {
	t.Helper()
	encoded, err := core.Canonical(map[string]any{"type": "bundle", "bundle": bundle})
	if err != nil {
		t.Fatal(err)
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.receiveLocked(transport.Delivery{Payload: json.RawMessage(encoded)})
}

func TestRequestTrackingBoundSurvivesCapacityErrors(t *testing.T) {
	n, _ := nodeFor(t, "Requester")
	for i := 0; i < transport.MaxTransfers; i++ {
		if _, err := n.Router.Broadcast(map[string]any{"protectedSOS": i}, transport.SOS, time.Minute, false); err != nil {
			t.Fatal(err)
		}
	}
	func() {
		n.mu.Lock()
		defer n.mu.Unlock()
		for batch := 0; batch < 320; batch++ {
			ids := make([]string, 8)
			for index := range ids {
				ids[index] = core.Hash([]byte(fmt.Sprintf("inventory-%d-%d", batch, index)))
			}
			encoded, err := core.Canonical(map[string]any{"type": "inventory", "ids": ids})
			if err != nil {
				t.Fatal(err)
			}
			err = n.receiveLocked(transport.Delivery{Payload: json.RawMessage(encoded)})
			if !errors.Is(err, transport.ErrCapacity) {
				t.Fatalf("negative capacity control absent: %v", err)
			}
			if len(n.requests) > 2048 {
				t.Fatalf("failed inventory bypassed request cap: %d", len(n.requests))
			}
		}
	}()
	for i := 0; i < 2200; i++ {
		_, err := n.Handle("retrieve", map[string]any{"id": core.Hash([]byte(fmt.Sprint("manual-", i)))})
		if !errors.Is(err, transport.ErrCapacity) {
			t.Fatalf("manual capacity control absent: %v", err)
		}
		n.mu.Lock()
		size := len(n.requests)
		n.mu.Unlock()
		if size > 2048 {
			t.Fatalf("failed manual request bypassed cap: %d", size)
		}
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.requests) != 2048 {
		t.Fatal("fixture did not saturate bounded request tracking")
	}
	n.rememberRequestLocked("kept", 123)
	n.rememberRequestLocked("kept", 456)
	if len(n.requests) != 2048 || n.requests["kept"] != 456 {
		t.Fatal("updating an existing throttle entry changed capacity")
	}
}

func TestIncomingDeletionJournalsBeforeOriginalEvictionAndRestart(t *testing.T) {
	receiver, _ := nodeFor(t, "Receiver")
	author, err := core.CreateIdentity("Remote author")
	if err != nil {
		t.Fatal(err)
	}
	attachment := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("remote deletion bytes"), 1800))
	original, err := core.CreateBundle(author, "post", Content{"type": "post", "text": "Original", "attachments": []any{map[string]any{"name": "original.txt", "mime": "text/plain", "data": attachment}}}, nil, true, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := core.Canonical(original)
	if err != nil {
		t.Fatal(err)
	}
	receiver.Store, err = core.NewContentStore(filepath.Join(receiver.Dir, "store"), int64(len(encoded)+1), core.MaxStoredObjects)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = receiver.Store.Put(original, false); err != nil {
		t.Fatal(err)
	}
	deletion, err := core.CreateBundle(author, "delete", Content{"type": "delete", "target": original.Manifest.ID}, nil, true, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if err = receiveBundleFor(t, receiver, deletion); err != nil {
		t.Fatal(err)
	}
	if receiver.Store.Has(original.Manifest.ID) {
		t.Fatal("quota fixture failed to evict original on received delete")
	}
	if mutation := receiver.private.Mutations[original.Manifest.ID]; !mutation.Deleted || mutation.Author != author.Public.ID {
		t.Fatal("received authenticated deletion was not journalled before eviction")
	}
	if err = receiver.Store.Remove(deletion.Manifest.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = receiver.Store.Put(original, false); err != nil {
		t.Fatal(err)
	}
	if _, err = receiver.Handle("attachment", map[string]any{"id": original.Manifest.ID, "index": 0}); err == nil {
		t.Fatal("deleted attachment was served")
	}
	viewed := apply(t, receiver, "view", map[string]any{"id": original.Manifest.ID}).(DisplayObject)
	if !viewed.Deleted || text(viewed.Content["attachments"].([]any)[0].(map[string]any)["data"]) != attachment {
		t.Fatal("view should retain original bytes and explicit deletion state")
	}
	dir := receiver.Dir
	receiver.Close()
	restored, err := NewNode(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	apply(t, restored, "unlock", map[string]any{"password": password})
	again := apply(t, restored, "view", map[string]any{"id": original.Manifest.ID}).(DisplayObject)
	if !again.Deleted {
		t.Fatal("received deletion disappeared after event loss and restart")
	}
}

func TestIncomingMutationRequiresAuthorAndMatchingReaderScope(t *testing.T) {
	receiver, reader := nodeFor(t, "Reader")
	author, err := core.CreateIdentity("Author")
	if err != nil {
		t.Fatal(err)
	}
	attacker, err := core.CreateIdentity("Impostor")
	if err != nil {
		t.Fatal(err)
	}
	original, err := core.CreateBundle(author, "post", Content{"type": "post", "text": "Private original"}, []core.PublicIdentity{reader}, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = receiver.Store.Put(original, false); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct {
		identity core.Identity
		public   bool
		readers  []core.PublicIdentity
	}{
		{attacker, false, []core.PublicIdentity{reader, author.Public}},
		{author, true, nil},
	} {
		event, err := core.CreateBundle(spec.identity, "delete", Content{"type": "delete", "target": original.Manifest.ID}, spec.readers, spec.public, core.DefaultTTL)
		if err != nil {
			t.Fatal(err)
		}
		if err = receiveBundleFor(t, receiver, event); err != nil {
			t.Fatal(err)
		}
		if _, exists := receiver.private.Mutations[original.Manifest.ID]; exists {
			t.Fatal("forged or privacy-widening event entered journal")
		}
	}
	valid, err := core.CreateBundle(author, "edit", Content{"type": "edit", "target": original.Manifest.ID, "text": "Authenticated edit"}, []core.PublicIdentity{reader}, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if err = receiveBundleFor(t, receiver, valid); err != nil {
		t.Fatal(err)
	}
	if mutation := receiver.private.Mutations[original.Manifest.ID]; mutation.Text == nil || *mutation.Text != "Authenticated edit" {
		t.Fatal("valid received edit was not journalled")
	}
}

func TestLockedReceivedDeleteIsDeferredUntilAuthenticatedMaterialization(t *testing.T) {
	receiver, reader := nodeFor(t, "Locked reader")
	author, err := core.CreateIdentity("Author")
	if err != nil {
		t.Fatal(err)
	}
	original, err := core.CreateBundle(author, "post", Content{"type": "post", "text": "Private", "attachments": []any{map[string]any{"name": "a.txt", "mime": "text/plain", "data": "YWJj"}}}, []core.PublicIdentity{reader}, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	deletion, err := core.CreateBundle(author, "delete", Content{"type": "delete", "target": original.Manifest.ID}, []core.PublicIdentity{reader}, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	receiver.Store.Put(original, false)
	apply(t, receiver, "lock", map[string]any{})
	if err = receiveBundleFor(t, receiver, deletion); err != nil {
		t.Fatal(err)
	}
	if len(receiver.private.Mutations) != 0 {
		t.Fatal("locked receiver claimed to authenticate encrypted semantics")
	}
	apply(t, receiver, "unlock", map[string]any{"password": password})
	if _, err = receiver.Handle("attachment", map[string]any{"id": original.Manifest.ID, "index": 0}); err == nil {
		t.Fatal("deferred valid deletion did not hide attachment after unlock")
	}
}

func TestHistoryPagesBoundCountAndBytesAndKeepIDCursorStable(t *testing.T) {
	all := make([]DisplayObject, 0, 125)
	for i := 0; i < 125; i++ {
		all = append(all, DisplayObject{ID: fmt.Sprintf("%064x", i+1), Created: int64(i), Content: Content{"type": "site", "blocks": []any{map[string]any{"id": "body", "type": "text", "title": "Title", "body": strings.Repeat("x", 90000)}}}})
	}
	seen := map[string]bool{}
	cursor := ""
	pages := 0
	for {
		page, err := pageHistory(all, cursor)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := core.Canonical(page.Objects)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Objects) > HistoryPageObjects || len(encoded) > HistoryPageBytes {
			t.Fatal("page escaped count/byte budget")
		}
		if page.History.Total != 125 || len(page.History.AvailableIDs) != 125 {
			t.Fatal("pagination lost the available object universe")
		}
		for _, object := range page.Objects {
			if seen[object.ID] {
				t.Fatal("cursor repeated an object")
			}
			seen[object.ID] = true
		}
		pages++
		if !page.History.HasMore {
			break
		}
		if page.History.NextBefore == nil || *page.History.NextBefore != page.Objects[0].ID {
			t.Fatal("cursor is not oldest returned ID")
		}
		cursor = *page.History.NextBefore
	}
	if len(seen) != 125 || pages < 3 {
		t.Fatal("byte-limit fixture did not exercise multiple pages")
	}
	newest, _ := pageHistory(all, "")
	cursor = *newest.History.NextBefore
	withNew := append(append([]DisplayObject{}, all...), DisplayObject{ID: strings.Repeat("f", 64), Created: 999, Content: Content{"type": "post", "text": "new"}})
	before, _ := pageHistory(all, cursor)
	after, _ := pageHistory(withNew, cursor)
	if len(before.Objects) != len(after.Objects) || before.Objects[0].ID != after.Objects[0].ID || before.Objects[len(before.Objects)-1].ID != after.Objects[len(after.Objects)-1].ID {
		t.Fatal("new arrival shifted an ID-based older page")
	}
	if _, err := pageHistory(all, strings.Repeat("e", 64)); err == nil {
		t.Fatal("missing cursor silently changed history")
	}
}

func TestLargeEncryptedStoreServesBoundedHistoryAndExactOnDemandAttachment(t *testing.T) {
	dir := tempDir(t)
	assets := filepath.Join(dir, "web")
	os.MkdirAll(assets, 0700)
	os.WriteFile(filepath.Join(assets, "index.html"), []byte("<main>Native history load test</main>"), 0600)
	service, err := Start(filepath.Join(dir, "data"), assets)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	n := service.Node
	apply(t, n, "setup", map[string]any{"name": "Reader", "password": password})
	reader := n.identity.Public
	author, err := core.CreateIdentity("Load author")
	if err != nil {
		t.Fatal(err)
	}
	attachment := bytes.Repeat([]byte{0x17, 0x00, 0xfe, 0x81}, 512*1024)
	encodedAttachment := base64.StdEncoding.EncodeToString(attachment)
	oldID := ""
	plainBytes := 0
	now := time.Now().UnixMilli() - 1000
	for i := 0; i < 10; i++ {
		content := Content{"type": "post", "text": fmt.Sprint("Encrypted load ", i), "attachments": []any{map[string]any{"name": "exact.bin", "mime": "application/octet-stream", "data": encodedAttachment}}}
		encoded, _ := core.Canonical(content)
		plainBytes += len(encoded)
		bundle, err := core.CreateBundleAt(author, "post", content, []core.PublicIdentity{reader}, false, core.DefaultTTL, now+int64(i))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = n.Store.Put(bundle, false); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			oldID = bundle.Manifest.ID
		}
	}
	if plainBytes <= 24*1024*1024 || n.Store.Stats().Bytes <= 24*1024*1024 {
		t.Fatal("load fixture did not exceed previous aggregate response ceiling")
	}
	for i := 0; i < 115; i++ {
		bundle, err := core.CreateBundleAt(author, "post", Content{"type": "post", "text": fmt.Sprint("Recent ", i)}, nil, true, core.DefaultTTL, now+100+int64(i))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = n.Store.Put(bundle, false); err != nil {
			t.Fatal(err)
		}
	}
	edit, err := core.CreateBundleAt(author, "edit", Content{"type": "edit", "target": oldID, "text": "Older authorized target edited"}, []core.PublicIdentity{reader}, false, core.DefaultTTL, now+500)
	if err != nil {
		t.Fatal(err)
	}
	n.Store.Put(edit, false)
	call := func(operation string, body any, token string) (int, []byte) {
		t.Helper()
		method := "GET"
		var data []byte
		if body != nil {
			method = "POST"
			data, _ = core.Canonical(body)
		}
		request, err := http.NewRequest(method, service.Origin+"/api/"+operation, bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		if body != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		result, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, result
	}
	firstStarted := time.Now()
	status, wire := call("state", nil, service.Token)
	firstElapsed := time.Since(firstStarted)
	if status != 200 {
		t.Fatalf("large store state failed: %d %s", status, wire)
	}
	if len(wire) > HistoryPageBytes+1024*1024 {
		t.Fatalf("state response exceeds page plus bounded metadata: %d", len(wire))
	}
	t.Logf("encrypted store=%d bytes; authorized aggregate payload=%d bytes; state=%d bytes", n.Store.Stats().Bytes, plainBytes, len(wire))
	repeatedStarted := time.Now()
	if repeatedStatus, repeatedWire := call("state", nil, service.Token); repeatedStatus != 200 || len(repeatedWire) > HistoryPageBytes+1024*1024 {
		t.Fatal("repeated verified-cache snapshot failed")
	}
	t.Logf("initial state=%s; repeated state with verified summary cache=%s", firstElapsed, time.Since(repeatedStarted))
	var state struct {
		Objects []DisplayObject `json:"objects"`
		History History         `json:"history"`
	}
	if err = json.Unmarshal(wire, &state); err != nil {
		t.Fatal(err)
	}
	if len(state.Objects) != 100 || state.History.Total != 126 || !state.History.HasMore || len(state.History.AvailableIDs) != 126 {
		t.Fatalf("wrong first page: objects=%d history=%+v", len(state.Objects), state.History)
	}
	if findObject(state.Objects, oldID) != nil || findObject(state.Objects, edit.Manifest.ID) == nil {
		t.Fatal("fixture did not separate authorized event from its older target")
	}
	seen := map[string]bool{}
	for _, object := range state.Objects {
		seen[object.ID] = true
	}
	history := state.History
	for history.HasMore {
		status, wire = call("history", map[string]any{"before": *history.NextBefore}, service.Token)
		if status != 200 {
			t.Fatalf("history failed: %d %s", status, wire)
		}
		var page HistoryPage
		if err = json.Unmarshal(wire, &page); err != nil {
			t.Fatal(err)
		}
		for _, object := range page.Objects {
			if seen[object.ID] {
				t.Fatal("history repeated ID")
			}
			seen[object.ID] = true
			if object.ID == oldID {
				if object.EditedText == nil || *object.EditedText != "Older authorized target edited" {
					t.Fatal("journal depended on visible page")
				}
			}
			for _, value := range attachmentsOf(object.Content) {
				a := value.(map[string]any)
				if text(a["data"]) != "" || a["size"].(float64) != float64(len(attachment)) {
					t.Fatal("attachment summary contains bytes or incorrect size")
				}
			}
		}
		history = page.History
	}
	if len(seen) != 126 {
		t.Fatal("history omitted authorized content")
	}
	if status, _ = call("attachment", map[string]any{"id": oldID, "index": 0}, ""); status != 401 {
		t.Fatal("attachment endpoint did not require API capability")
	}
	status, wire = call("attachment", map[string]any{"id": oldID, "index": 0}, service.Token)
	if status != 200 {
		t.Fatalf("attachment failed: %d %s", status, wire)
	}
	var fetched map[string]any
	if err = json.Unmarshal(wire, &fetched); err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.DecodeString(text(fetched["data"]))
	if err != nil || !bytes.Equal(decoded, attachment) {
		t.Fatal("on-demand attachment bytes changed")
	}
	full := apply(t, n, "view", map[string]any{"id": oldID}).(DisplayObject)
	if text(attachmentsOf(full.Content)[0].(map[string]any)["data"]) != encodedAttachment {
		t.Fatal("view ceased returning full object")
	}
	for _, index := range []any{-1, 1, 0.5} {
		if _, err = n.Handle("attachment", map[string]any{"id": oldID, "index": index}); err == nil {
			t.Fatal("invalid attachment index accepted")
		}
	}
	apply(t, n, "lock", map[string]any{})
	if _, err = n.Handle("attachment", map[string]any{"id": oldID, "index": 0}); err == nil {
		t.Fatal("locked attachment API leaked bytes")
	}
}
func attachmentsOf(content Content) []any { list, _ := content["attachments"].([]any); return list }

func TestAttachmentEndpointRejectsUnauthorizedForgedAndCorruptedObjects(t *testing.T) {
	n, viewer := nodeFor(t, "Viewer")
	author, err := core.CreateIdentity("Author")
	if err != nil {
		t.Fatal(err)
	}
	other, err := core.CreateIdentity("Other reader")
	if err != nil {
		t.Fatal(err)
	}
	attachment := []any{map[string]any{"name": "private.txt", "mime": "text/plain", "data": "c2VjcmV0"}}
	private, err := core.CreateBundle(author, "post", Content{"type": "post", "text": "Private", "attachments": attachment}, []core.PublicIdentity{other.Public}, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	fake, err := core.CreateBundle(author, "message", Content{"type": "message", "text": "Invalid public conversation", "members": []core.PublicIdentity{author.Public, viewer}, "conversation": "dm:" + strings.Repeat("a", 64), "attachments": attachment}, nil, true, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	for _, bundle := range []core.Bundle{private, fake} {
		if _, err = n.Store.Put(bundle, false); err != nil {
			t.Fatal(err)
		}
		if _, err = n.Handle("attachment", map[string]any{"id": bundle.Manifest.ID, "index": 0}); err == nil {
			t.Fatal("attachment endpoint bypassed decryption or semantic ACL")
		}
	}
	valid, err := core.CreateBundle(author, "post", Content{"type": "post", "text": "Public valid", "attachments": attachment}, nil, true, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	n.Store.Put(valid, false)
	if got := apply(t, n, "attachment", map[string]any{"id": valid.Manifest.ID, "index": 0}).(map[string]any); got["data"] != "c2VjcmV0" {
		t.Fatal("positive attachment control failed")
	}
	chunk := valid.Manifest.Chunks[0].Hash
	encoded := valid.Chunks[chunk]
	if encoded[0] == 'A' {
		encoded = "B" + encoded[1:]
	} else {
		encoded = "A" + encoded[1:]
	}
	valid.Chunks[chunk] = encoded
	tampered, err := core.Canonical(valid)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(n.Dir, "store", "objects", valid.Manifest.ID+".json"), tampered, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = n.Handle("attachment", map[string]any{"id": valid.Manifest.ID, "index": 0}); err == nil {
		t.Fatal("attachment endpoint skipped fresh chunk/signature verification")
	}
}

func TestSummaryProjectionDropsNestedExtensionsAndRejectsInvalidTypedFields(t *testing.T) {
	n, _ := nodeFor(t, "Owner")
	for _, field := range []string{"value", "theme", "priority"} {
		invalid := Content{"type": "post", "text": "Typed field", "value": true}
		invalid[field] = map[string]any{"not": "scalar"}
		if _, err := n.Publish(invalid, "public", 0); err == nil {
			t.Fatalf("invalid %s was accepted", field)
		}
	}
	// Extension fields remain in the signed full object but cannot inflate a
	// bounded summary. Non-site blocks/theme have no display role.
	post := publish(t, n, Content{"type": "post", "text": "Known fields only", "blocks": map[string]any{"unrecognized": strings.Repeat("x", 300000)}, "theme": strings.Repeat("y", 300000), "extension": strings.Repeat("z", 300000)}, "public")
	summary := findObject(objectsFor(t, n), post.ID)
	if summary == nil {
		t.Fatal("valid post disappeared")
	}
	for _, field := range []string{"blocks", "theme", "extension"} {
		if _, ok := summary.Content[field]; ok {
			t.Fatalf("unknown extension leaked into summary: %s", field)
		}
	}
	full := apply(t, n, "view", map[string]any{"id": post.ID}).(DisplayObject)
	if full.Content["extension"] == nil {
		t.Fatal("full view lost signed extension content")
	}
	site := publish(t, n, Content{"type": "site", "theme": "sand", "blocks": []any{map[string]any{"id": "hero", "type": "hero", "title": "Title", "body": "Body", "extension": strings.Repeat("z", 500000)}}}, "public")
	summarizedSite := findObject(objectsFor(t, n), site.ID)
	block := summarizedSite.Content["blocks"].([]any)[0].(map[string]any)
	if len(block) != 4 || block["extension"] != nil {
		t.Fatal("nested block extension escaped summary projection")
	}
}

func TestSummaryCacheReusesMetadataButInvalidatesTamperEvictionAndLock(t *testing.T) {
	n, identity := nodeFor(t, "Cached owner")
	original := publish(t, n, Content{"type": "post", "text": "Immutable summary", "attachments": []any{map[string]any{"name": "a.txt", "mime": "text/plain", "data": "YWJj"}}}, "public")
	bundle, err := n.Store.Get(original.ID)
	if err != nil {
		t.Fatal(err)
	}
	first := findObject(objectsFor(t, n), original.ID)
	if first == nil {
		t.Fatal("initial summary absent")
	}
	if len(n.summaries) != 1 || n.summaryBytes == 0 || n.summaryIdentity != identity.ID {
		t.Fatal("verified metadata was not cached")
	}
	first.Content["text"] = "Caller mutation"
	first.Content["attachments"].([]any)[0].(map[string]any)["name"] = "changed.txt"
	next := findObject(objectsFor(t, n), original.ID)
	if text(next.Content["text"]) != "Immutable summary" || text(attachmentsOf(next.Content)[0].(map[string]any)["name"]) != "a.txt" {
		t.Fatal("state aliases mutated cached summary")
	}
	apply(t, n, "lock", map[string]any{})
	if len(n.summaries) != 0 || n.summaryBytes != 0 || n.summaryIdentity != "" {
		t.Fatal("lock retained decrypted summary metadata")
	}
	apply(t, n, "unlock", map[string]any{"password": password})
	if len(n.summaries) != 0 {
		t.Fatal("unlock reused an earlier identity epoch")
	}
	objectsFor(t, n)
	raw, err := core.Canonical(bundle)
	if err != nil {
		t.Fatal(err)
	}
	chunk := bundle.Manifest.Chunks[0].Hash
	encoded := bundle.Chunks[chunk]
	if encoded[0] == 'A' {
		encoded = "B" + encoded[1:]
	} else {
		encoded = "A" + encoded[1:]
	}
	bundle.Chunks[chunk] = encoded
	corrupt, err := core.Canonical(bundle)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(n.Dir, "store", "objects", original.ID+".json")
	if err = os.WriteFile(path, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if findObject(objectsFor(t, n), original.ID) != nil || len(n.summaries) != 0 || n.summaryBytes != 0 {
		t.Fatal("cached summary bypassed disk corruption invalidation")
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if findObject(objectsFor(t, n), original.ID) == nil {
		t.Fatal("restored valid content was not reverified")
	}
	if err = n.Store.Remove(original.ID); err != nil {
		t.Fatal(err)
	}
	objectsFor(t, n)
	if len(n.summaries) != 0 || n.summaryBytes != 0 {
		t.Fatal("evicted IDs retained decrypted summary metadata")
	}
}

func TestSummaryCacheCountAndByteBudgets(t *testing.T) {
	n, _ := nodeFor(t, "Bounded summary cache")
	n.mu.Lock()
	defer n.mu.Unlock()
	for i := 0; i < summaryCacheEntries+20; i++ {
		if err := n.cacheSummaryLocked(DisplayObject{ID: fmt.Sprintf("%064x", i), Content: Content{"type": "post", "text": "small"}}); err != nil {
			t.Fatal(err)
		}
	}
	if len(n.summaries) != summaryCacheEntries || n.summaryBytes > summaryCacheBytes {
		t.Fatal("summary entry cap failed")
	}
	n.clearSummariesLocked()
	for i := 0; i < 220; i++ {
		blocks := make([]any, 24)
		for j := range blocks {
			blocks[j] = map[string]any{"id": fmt.Sprint(j), "type": "text", "title": "Title", "body": strings.Repeat("x", 4000)}
		}
		if err := n.cacheSummaryLocked(DisplayObject{ID: fmt.Sprintf("%064x", i), Content: Content{"type": "site", "blocks": blocks}}); err != nil {
			t.Fatal(err)
		}
		actual := 0
		for _, entry := range n.summaries {
			actual += entry.bytes
		}
		if n.summaryBytes != actual || actual > summaryCacheBytes {
			t.Fatal("summary byte budget/accounting failed")
		}
	}
	if len(n.summaries) >= 220 {
		t.Fatal("large summary fixture did not trigger eviction")
	}
	if _, exists := n.summaries[fmt.Sprintf("%064x", 0)]; exists {
		t.Fatal("least-recently-used metadata was not evicted")
	}
}
