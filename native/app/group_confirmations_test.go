package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupauthority"
	"github.com/JohnnyPBelo/relayloom/native/groupledger"
	"github.com/JohnnyPBelo/relayloom/native/groups"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

func groupConfirmationFixture(t *testing.T) (*Node, *DisplayObject, *transport.Router, *Node) {
	t.Helper()
	a, alice := nodeFor(t, "Receipt author")
	b, bob := nodeFor(t, "Receipt reader")
	for _, node := range []*Node{a, b} {
		node.cancel()
		node.wg.Wait()
	}
	command := func(n *Node, body map[string]any) map[string]any {
		return apply(t, n, "group-command", body).(map[string]any)
	}
	created := command(a, map[string]any{"action": "create", "operationId": operationFor(8100), "title": "Receipt boundary"})["group"].(groupauthority.View)
	proof := command(a, map[string]any{"action": "proofs", "groupId": created.ID, "from": 0})
	invitation := command(a, map[string]any{"action": "invite", "operationId": operationFor(8101), "groupId": created.ID, "expected": created.Head.ID, "card": bob})["operation"].(groupauthority.Result).Certificate
	command(b, map[string]any{"action": "remember", "operationId": operationFor(8102), "anchor": proof["anchor"], "parent": created.Head, "invitation": invitation})
	command(b, map[string]any{"action": "headers", "groupId": created.ID, "headers": proof["headers"]})
	consent := command(b, map[string]any{"action": "accept", "operationId": operationFor(8103), "groupId": created.ID, "expected": created.Head.ID})["operation"].(groupauthority.Result).Certificate
	joined := command(a, map[string]any{"action": "commit", "operationId": operationFor(8104), "groupId": created.ID, "expected": created.Head.ID, "title": "Receipt boundary", "members": []core.PublicIdentity{alice, bob}, "joins": []any{consent}})["group"].(groupauthority.View)
	snapshot := command(a, map[string]any{"action": "private-state", "groupId": created.ID, "epochId": joined.Head.ID})["snapshot"]
	command(b, map[string]any{"action": "headers", "groupId": created.ID, "headers": []groups.GroupEpoch{*joined.Head}})
	command(b, map[string]any{"action": "snapshot", "groupId": created.ID, "epochId": joined.Head.ID, "snapshot": snapshot})
	sent := sendFor(t, a, 8105, Content{"type": "message", "text": "Verified original for receipt", "conversation": created.ID, "groupEpoch": joined.Head.ID, "groupAudience": "epoch"}, []string{bob.ID})
	// The unit fixture moves the real API-created bundle directly; the mixed
	// journey separately proves message transfer. Receipt transmission is TCP.
	bundle, err := a.Store.GetWithTouch(sent["id"].(string), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Put(bundle, false); err != nil {
		t.Fatal(err)
	}
	original, err := b.authorizedObjectLocked(bundle.Manifest.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	sink, err := transport.New(transport.Options{DisableRelay: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sink.Close() })
	address, err := sink.ListenTCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	disconnect, err := b.Router.ConnectTCP(address.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(disconnect)
	if _, err := b.Router.Broadcast(map[string]any{"witness": "receipt-reachable"}, transport.Normal, 10*time.Second, false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := sink.Next(ctx)
	if err != nil || !strings.Contains(string(got.Payload), "receipt-reachable") {
		t.Fatal("TCP witness failed", err)
	}
	return b, original, sink, a
}

func fixtureReadFact(tx *groupstore.Tx) (string, error) {
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
			return "", errors.New("fixture history disappeared")
		}
		var history groupledger.HistoryRecord
		if err := json.Unmarshal(data, &history); err != nil {
			return "", err
		}
		if history.Context.Kind == "receipt" {
			return history.Context.ID, nil
		}
	}
	return "", nil
}

func TestGroupConfirmationCommitFailure(t *testing.T) {
	for _, committed := range []bool{false, true} {
		name := "rollback"
		if committed {
			name = "lost-response"
		}
		t.Run(name, func(t *testing.T) {
			n, original, sink, _ := groupConfirmationFixture(t)
			db := n.privateDatabase
			injected := errors.New("fixture receipt commit failure")
			captured := ""
			n.updateGroupState = func(callback func(*groupstore.Tx) error) error {
				boundary := false
				err := db.Update(func(tx *groupstore.Tx) error {
					before, err := fixtureReadFact(tx)
					if err != nil {
						return err
					}
					if err := callback(tx); err != nil {
						return err
					}
					after, err := fixtureReadFact(tx)
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
			if err := n.ensureConfirmationLocked(original, "receipt"); !errors.Is(err, injected) || captured == "" {
				t.Fatal("receipt boundary not exercised", err)
			}
			n.updateGroupState = nil
			if n.Store.Has(captured) {
				t.Fatal("uncommitted receipt reached store")
			}
			if (acceptedContent(t, n, *n.identity, captured) != nil) != committed {
				t.Fatal("admission ignored real commit result")
			}
			noGroupSendPacket(t, sink)
			if err := n.ensureConfirmationLocked(original, "receipt"); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			got, err := sink.Next(ctx)
			if err != nil {
				t.Fatal("authorized receipt did not arrive", err)
			}
			value, err := core.DecodeJSON(got.Payload, core.MaxBundleBytes+65536)
			if err != nil {
				t.Fatal(err)
			}
			payload, _ := object(value)
			raw, _ := core.Canonical(payload["bundle"])
			bundle, err := core.DecodeBundle(raw)
			if err != nil {
				t.Fatal(err)
			}
			if bundle.Manifest.Kind != "receipt" || bundle.Manifest.ID == captured || bundle.Manifest.Author.ID != n.identity.Public.ID {
				t.Fatal("wrong receipt after recovery")
			}
			if err := core.VerifyBundle(bundle); err != nil {
				t.Fatal(err)
			}
			if err := n.ensureConfirmationLocked(original, "receipt"); err != nil {
				t.Fatal(err)
			}
			noGroupSendPacket(t, sink)
		})
	}
}

func TestGroupConfirmationBlockedAndMissingOriginal(t *testing.T) {
	n, original, sink, _ := groupConfirmationFixture(t)
	bundle, err := n.Store.GetWithTouch(original.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	apply(t, n, "action", map[string]any{"action": "block", "target": original.Author.ID, "value": true})
	if _, err := n.commitGroupConfirmationLocked(original.ID, "receipt"); err == nil {
		t.Fatal("blocked reader minted receipt")
	}
	apply(t, n, "action", map[string]any{"action": "block", "target": original.Author.ID, "value": false})
	if err := n.Store.Remove(original.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := n.commitGroupConfirmationLocked(original.ID, "receipt"); err == nil {
		t.Fatal("missing bytes minted receipt")
	}
	noGroupSendPacket(t, sink)
	if _, err := n.Store.Put(bundle, false); err != nil {
		t.Fatal(err)
	}
	if err := n.ensureConfirmationLocked(original, "receipt"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := sink.Next(ctx)
	if err != nil || !strings.Contains(string(got.Payload), `"kind":"receipt"`) {
		t.Fatal("valid receipt control absent", err)
	}
}

func TestGroupConfirmationWrongBindingCannotSuppressValidFact(t *testing.T) {
	n, original, sink, _ := groupConfirmationFixture(t)
	cards, err := members(original.Content["members"])
	if err != nil {
		t.Fatal(err)
	}
	invalid, err := core.CreateBundle(*n.identity, "receipt", Content{"type": "receipt", "target": original.ID}, cards, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := n.Store.Put(invalid, false); err != nil {
		t.Fatal(err)
	}
	if err := n.ensureConfirmationLocked(original, "receipt"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := sink.Next(ctx)
	if err != nil {
		t.Fatal("wrong-scope receipt suppressed actual confirmation", err)
	}
	value, err := core.DecodeJSON(got.Payload, core.MaxBundleBytes+65536)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := object(value)
	raw, _ := core.Canonical(payload["bundle"])
	bundle, err := core.DecodeBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := core.DecryptBundle(bundle, n.identity)
	if err != nil {
		t.Fatal(err)
	}
	content, err := object(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Manifest.ID == invalid.Manifest.ID || text(content["groupAudience"]) != "historical" || text(content["targetEpoch"]) != text(original.Content["groupEpoch"]) {
		t.Fatal("confirmation did not restore actual historical scope")
	}
}

func TestGroupConfirmationMissingHistoricalProof(t *testing.T) {
	n, original, sink, creator := groupConfirmationFixture(t)
	id := text(original.Content["conversation"])
	group := apply(t, creator, "group-command", map[string]any{"action": "state", "groupId": id}).(map[string]any)["group"].(groupauthority.View)
	snapshot := apply(t, creator, "group-command", map[string]any{"action": "private-state", "groupId": id, "epochId": group.Head.ID}).(map[string]any)["snapshot"]
	cards, err := members(original.Content["members"])
	if err != nil {
		t.Fatal(err)
	}
	advanced := apply(t, creator, "group-command", map[string]any{"action": "commit", "operationId": operationFor(8200), "groupId": id, "expected": group.Head.ID, "title": "New verified cursor", "members": cards, "joins": []any{}}).(map[string]any)["group"].(groupauthority.View)
	current := apply(t, creator, "group-command", map[string]any{"action": "private-state", "groupId": id, "epochId": advanced.Head.ID}).(map[string]any)["snapshot"]
	apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": id, "headers": []groups.GroupEpoch{*advanced.Head}})
	apply(t, n, "group-command", map[string]any{"action": "snapshot", "groupId": id, "epochId": advanced.Head.ID, "snapshot": current})
	closed := apply(t, creator, "group-command", map[string]any{"action": "close", "operationId": operationFor(8201), "groupId": id, "expected": advanced.Head.ID}).(map[string]any)["group"].(groupauthority.View)
	apply(t, n, "group-command", map[string]any{"action": "headers", "groupId": id, "headers": []groups.GroupEpoch{*closed.Head}})
	if err := n.privateDatabase.Update(func(tx *groupstore.Tx) error { return tx.Delete("snapshot:" + id + ":" + group.Head.Body.SnapshotHash) }); err != nil {
		t.Fatal(err)
	}
	if _, err := n.commitGroupConfirmationLocked(original.ID, "receipt"); err == nil {
		t.Fatal("missing historical proof minted confirmation")
	}
	noGroupSendPacket(t, sink)
	apply(t, n, "group-command", map[string]any{"action": "snapshot", "groupId": id, "epochId": group.Head.ID, "snapshot": snapshot})
	if err := n.ensureConfirmationLocked(original, "receipt"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := sink.Next(ctx)
	if err != nil || !strings.Contains(string(got.Payload), `"kind":"receipt"`) {
		t.Fatal("proof restoration failed positive control", err)
	}
}
