package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func reactionFor(original *DisplayObject) Content {
	return Content{"type": "reaction", "emoji": "heart", "value": true, "target": original.ID, "conversation": original.Content["conversation"], "groupEpoch": original.Content["groupEpoch"], "targetEpoch": original.Content["groupEpoch"], "groupAudience": "target"}
}

func fixtureReactionID(tx *groupstore.Tx) (string, error) {
	keys, err := tx.Keys("group-history:")
	if err != nil {
		return "", err
	}
	for _, key := range keys {
		data, ok, err := tx.Get(key)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", errors.New("missing fixture history")
		}
		var history groupledger.HistoryRecord
		if err := json.Unmarshal(data, &history); err != nil {
			return "", err
		}
		if history.Context.Kind == "reaction" {
			return history.Context.ID, nil
		}
	}
	return "", nil
}

func TestGroupEventCommitFailures(t *testing.T) {
	for _, committed := range []bool{false, true} {
		name := "rollback"
		if committed {
			name = "lost-response"
		}
		t.Run(name, func(t *testing.T) {
			n, original, sink, _ := groupConfirmationFixture(t)
			db := n.privateDatabase
			injected := errors.New("fixture event transaction failure")
			captured := ""
			n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
				boundary := false
				err := db.Update(func(tx *groupstore.Tx) error {
					before, err := fixtureReactionID(tx)
					if err != nil {
						return err
					}
					if err = callback(tx); err != nil {
						return err
					}
					after, err := fixtureReactionID(tx)
					if err != nil {
						return err
					}
					boundary = before == "" && after != ""
					if boundary {
						captured = after
						if !committed {
							return injected
						}
					}
					return nil
				})
				if err == nil && boundary && committed {
					return injected
				}
				return err
			}
			if _, err := n.Publish(reactionFor(original), []string{original.Author.ID}, 60000); !errors.Is(err, injected) || captured == "" {
				t.Fatal("boundary not exercised", err)
			}
			n.updateGroupState = nil
			if n.Store.Has(captured) {
				t.Fatal("failed admission reached content store")
			}
			if (acceptedContent(t, n, *n.identity, captured) != nil) != committed {
				t.Fatal("admission lost real commit result")
			}
			noGroupSendPacket(t, sink)
			valid, err := n.Publish(reactionFor(original), []string{original.Author.ID}, 60000)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			got, err := sink.Next(ctx)
			if err != nil || valid.ID == captured || !strings.Contains(string(got.Payload), valid.ID) {
				t.Fatal("valid event control failed", err)
			}
		})
	}
}

func TestGroupEventQueuedFences(t *testing.T) {
	for _, mode := range []string{"allowed-control", "close", "evicted", "block", "lock"} {
		t.Run(mode, func(t *testing.T) {
			n, original, sink, author := groupConfirmationFixture(t)
			event, err := n.Publish(reactionFor(original), []string{original.Author.ID}, 60000)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			got, err := sink.Next(ctx)
			cancel()
			if err != nil || !strings.Contains(string(got.Payload), event.ID) {
				t.Fatal("initial event did not traverse TCP", err)
			}
			bundle, err := n.Store.GetWithTouch(event.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			n.Router.SetLowPower(true)
			if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Bulk, 2*time.Minute, false); err != nil {
				t.Fatal(err)
			}
			if len(n.Router.Peers()) != 1 || n.Router.Peers()[0].Queued == 0 {
				t.Fatal("actual transfer was not queued")
			}
			if mode == "evicted" {
				if err = n.Store.Remove(event.ID); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "close" || mode == "evicted" {
				closed := apply(t, author, "group-command", map[string]any{"action": "close", "operationId": operationFor(9300), "groupId": original.Content["conversation"], "expected": original.Content["groupEpoch"]}).(map[string]any)["group"].(groupauthority.View)
				apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": closed.ID, "headers": []groups.GroupEpoch{*closed.Head}})
			} else if mode == "block" {
				apply(t, n, "action", map[string]any{"action": "block", "target": original.Author.ID, "value": true})
			} else if mode == "lock" {
				apply(t, n, "lock", nil)
			}
			if mode != "allowed-control" && n.Router.Peers()[0].Queued != 0 {
				t.Fatal("authority fence left a queued event")
			}
			allowed, err := n.maySeedLocked(bundle.Manifest)
			if mode == "evicted" {
				if err == nil || allowed {
					t.Fatal("evicted event acquired serving authority", allowed, err)
				}
			} else if err != nil || allowed != (mode == "allowed-control") {
				t.Fatal("wrong fresh serving authority", allowed, err)
			}
			if _, err = n.Router.Broadcast(map[string]any{"witness": "event-fence-reachable"}, transport.Normal, 2*time.Minute, false); err != nil {
				t.Fatal(err)
			}
			n.Router.SetLowPower(false)
			seenWitness, seenEvent := false, false
			count := 1
			if mode == "allowed-control" {
				count = 2
			}
			for i := 0; i < count; i++ {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				next, err := sink.Next(ctx)
				cancel()
				if err != nil {
					t.Fatal("TCP control absent", err)
				}
				seenWitness = seenWitness || strings.Contains(string(next.Payload), "event-fence-reachable")
				seenEvent = seenEvent || strings.Contains(string(next.Payload), event.ID)
			}
			if !seenWitness || seenEvent != (mode == "allowed-control") {
				t.Fatal("wrong queue outcome", seenWitness, seenEvent)
			}
			noGroupSendPacket(t, sink)
		})
	}
}

func TestGroupEventMissingTargetProofBlocksPublicationAndSeed(t *testing.T) {
	n, original, _, author := groupConfirmationFixture(t)
	groupID, epochID := text(original.Content["conversation"]), text(original.Content["groupEpoch"])
	before := apply(t, n, "group-command", map[string]any{"action": "state", "groupId": groupID}).(map[string]any)["group"].(groupauthority.View)
	oldSnapshot := apply(t, n, "group-command", map[string]any{"action": "private-state", "groupId": groupID, "epochId": epochID}).(map[string]any)["snapshot"].(*groups.GroupSnapshot)
	joined := apply(t, author, "group-command", map[string]any{"action": "commit", "operationId": operationFor(9400), "groupId": groupID, "expected": epochID, "title": "New event epoch", "members": oldSnapshot.Members, "joins": []any{}}).(map[string]any)["group"].(groupauthority.View)
	snapshot := apply(t, author, "group-command", map[string]any{"action": "private-state", "groupId": groupID, "epochId": joined.Head.ID}).(map[string]any)["snapshot"]
	apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": groupID, "headers": []groups.GroupEpoch{*joined.Head}})
	apply(t, n, "group-command", map[string]any{"action": "snapshot", "groupId": groupID, "epochId": joined.Head.ID, "snapshot": snapshot})
	content := reactionFor(original)
	content["groupEpoch"] = joined.Head.ID
	event, err := n.Publish(content, []string{original.Author.ID}, 60000)
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := n.Store.GetWithTouch(event.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if allowed, err := n.maySeedLocked(bundle.Manifest); err != nil || !allowed {
		t.Fatal("positive event authority absent", err)
	}
	if err = n.privateDatabase.Update(func(tx *groupstore.Tx) error {
		return tx.Delete("snapshot:" + groupID + ":" + before.Head.Body.SnapshotHash)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = n.Publish(content, []string{original.Author.ID}, 60000); err == nil {
		t.Fatal("missing historical target proof minted new event")
	}
	if n.identity == nil {
		t.Fatal("missing old proof corrupted the newer valid checkpoint")
	}
	if allowed, err := n.maySeedLocked(bundle.Manifest); err != nil || allowed {
		t.Fatal("missing historical target proof permitted serving", err)
	}
	bad := *oldSnapshot
	bad.Title = "Invalid replacement proof"
	if _, err = n.Handle("group-command", map[string]any{"action": "snapshot", "groupId": groupID, "epochId": epochID, "snapshot": bad}); err == nil {
		t.Fatal("tampered proof restored permission")
	}
	apply(t, n, "group-command", map[string]any{"action": "snapshot", "groupId": groupID, "epochId": epochID, "snapshot": oldSnapshot})
	if _, err = n.Publish(content, []string{original.Author.ID}, 60000); err != nil {
		t.Fatal("exact proof did not restore publication", err)
	}
	if allowed, err := n.maySeedLocked(bundle.Manifest); err != nil || !allowed {
		t.Fatal("exact proof did not restore seeding", err)
	}
}

func TestGroupEventRealIndexFailureRecoversOriginalBytesAfterRestart(t *testing.T) {
	n, original, sink, _ := groupConfirmationFixture(t)
	address := n.Router.Peers()[0].Address
	db, index := n.privateDatabase, filepath.Join(n.Dir, "store", "index.json")
	backup, blocked, captured := index+".event-fixture-backup", false, ""
	restore := func() {
		if !blocked {
			return
		}
		if err := os.Remove(index); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(backup, index); err != nil {
			t.Fatal(err)
		}
		blocked = false
	}
	t.Cleanup(restore)
	n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
		if err := db.Update(callback); err != nil {
			return err
		}
		if blocked {
			return nil
		}
		if err := db.Update(func(tx *groupstore.Tx) error { var err error; captured, err = fixtureReactionID(tx); return err }); err != nil {
			return err
		}
		if captured == "" {
			return nil
		}
		if err := os.Rename(index, backup); err != nil {
			return err
		}
		if err := os.Mkdir(index, 0700); err != nil {
			return err
		}
		blocked = true
		return nil
	}
	if _, err := n.Publish(reactionFor(original), []string{original.Author.ID}, 60000); err == nil || !blocked || captured == "" {
		t.Fatal("real index failure was not exercised", err)
	}
	n.updateGroupState = nil
	if acceptedContent(t, n, *n.identity, captured) == nil {
		t.Fatal("payload write preceded event admission")
	}
	noGroupSendPacket(t, sink)
	payload, err := n.Store.GetWithTouch(captured, false)
	if err != nil {
		t.Fatal("fixture must fail after writing the actual payload", err)
	}
	expected, err := core.Canonical(payload)
	if err != nil {
		t.Fatal(err)
	}
	restore()
	current := restartFor(t, n)
	apply(t, current, "unlock", map[string]any{"password": password})
	if err := current.Start(0, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	disconnect, err := current.Router.ConnectTCP(address)
	if err != nil {
		t.Fatal(err)
	}
	defer disconnect()
	if _, err := sink.Broadcast(map[string]any{"type": "request", "ids": []string{captured}}, transport.Normal, 10*time.Second, false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	found := false
	for !found {
		got, err := sink.Next(ctx)
		if err != nil {
			t.Fatal("recovered event unavailable via real TCP", err)
		}
		value, err := core.DecodeJSON(got.Payload, core.MaxBundleBytes+65536)
		if err != nil {
			t.Fatal(err)
		}
		m, err := object(value)
		if err != nil || text(m["type"]) != "bundle" {
			continue
		}
		restored, err := decodeBundle(m["bundle"])
		if err != nil {
			t.Fatal(err)
		}
		if restored.Manifest.ID != captured {
			continue
		}
		actual, err := core.Canonical(restored)
		if err != nil || !bytes.Equal(expected, actual) {
			t.Fatal("restart reconstructed or changed the signed event", err)
		}
		found = true
	}
}

func TestGroupEventCorruptionReconcilesWithoutMessageOutbox(t *testing.T) {
	n, original, sink, _ := groupConfirmationFixture(t)
	if len(n.private.Outbox) != 0 {
		t.Fatal("fixture must have only authored events")
	}
	event, err := n.Publish(reactionFor(original), []string{original.Author.ID}, 60000)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	got, err := sink.Next(ctx)
	cancel()
	if err != nil || !strings.Contains(string(got.Payload), event.ID) {
		t.Fatal("original TCP control failed", err)
	}
	bundle, err := n.Store.GetWithTouch(event.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	n.Router.SetLowPower(true)
	if _, err = n.Router.Broadcast(map[string]any{"type": "bundle", "bundle": bundle}, transport.Bulk, 2*time.Minute, false); err != nil {
		t.Fatal(err)
	}
	if n.Router.Peers()[0].Queued == 0 {
		t.Fatal("no real transfer held before corruption")
	}
	encoded, err := core.Canonical(bundle)
	if err != nil {
		t.Fatal(err)
	}
	corrupt, err := core.DecodeBundle(encoded)
	if err != nil {
		t.Fatal(err)
	}
	for id, value := range corrupt.Chunks {
		data, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		data[0] ^= 1
		corrupt.Chunks[id] = base64.StdEncoding.EncodeToString(data)
		break
	}
	invalid, err := core.Canonical(corrupt)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(n.Dir, "store", "objects", event.ID+".json"), invalid, 0600); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	if n.groupEventSeeds[event.ID] || n.Router.Peers()[0].Queued != 0 {
		t.Fatal("snapshot without outbox retained corrupt event authority/queue")
	}
	noGroupSendPacket(t, sink)
	if err = n.Store.Remove(event.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = n.Store.Put(bundle, false); err != nil {
		t.Fatal(err)
	}
	apply(t, n, "state", nil)
	if !n.groupEventSeeds[event.ID] {
		t.Fatal("exact bytes did not restore live permission")
	}
	n.Router.SetLowPower(false)
	content := reactionFor(original)
	content["value"] = false
	valid, err := n.Publish(content, []string{original.Author.ID}, 60000)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err = sink.Next(ctx)
	if err != nil || !strings.Contains(string(got.Payload), valid.ID) {
		t.Fatal("valid publication control after restore failed", err)
	}
}
