package groups

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

// Invoked by tests/native/group-certificates.test.ts with fresh synthetic keys.
// Private fixture input/output stays in the project cache and is never evidence.
func TestGroupCertificateInteropFixture(t *testing.T) {
	inputPath := os.Getenv("RELAYLOOM_GROUP_VECTOR_INPUT")
	if inputPath == "" {
		t.Skip("driven by the Node/Go vector test")
	}
	absolute, err := filepath.Abs(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(filepath.Join(root, ".cache"), absolute)
	if err != nil || relative == ".." || filepath.IsAbs(relative) || len(relative) > 3 && relative[:3] == ".."+string(filepath.Separator) {
		t.Fatal("fixture must be inside the project cache")
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		t.Fatal(err)
	}
	value, err := core.DecodeJSON(data, 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	input, err := object(value, "identities", "group", "joined", "invitation", "consent", "message", "badEpochs", "unicodeGroup")
	if err != nil {
		t.Fatal(err)
	}
	rawIDs, err := array(input["identities"], 3, 3)
	if err != nil {
		t.Fatal(err)
	}
	identities := []core.Identity{}
	for _, raw := range rawIDs {
		id, err := core.DecodeIdentity(encoded(t, raw))
		if err != nil {
			t.Fatal(err)
		}
		identities = append(identities, id)
	}
	a, b, c := identities[0], identities[1], identities[2]
	decodeGroup := func(raw any) AnchoredGroup {
		m, err := object(raw, "anchor", "epoch", "snapshot")
		if err != nil {
			t.Fatal(err)
		}
		anchor, err := DecodeAnchor(encoded(t, m["anchor"]))
		if err != nil {
			t.Fatal(err)
		}
		epoch, err := DecodeEpoch(encoded(t, m["epoch"]), anchor)
		if err != nil {
			t.Fatal(err)
		}
		state, err := DecodeSnapshot(encoded(t, m["snapshot"]), anchor, epoch)
		if err != nil {
			t.Fatal(err)
		}
		return AnchoredGroup{anchor, epoch, state}
	}
	g := decodeGroup(input["group"])
	unicodeGroup := decodeGroup(input["unicodeGroup"])
	joinedObject, err := object(input["joined"], "epoch", "snapshot")
	if err != nil {
		t.Fatal(err)
	}
	joinedEpoch, err := DecodeEpoch(encoded(t, joinedObject["epoch"]), g.Anchor)
	if err != nil {
		t.Fatal(err)
	}
	joinedState, err := DecodeSnapshot(encoded(t, joinedObject["snapshot"]), g.Anchor, joinedEpoch)
	if err != nil {
		t.Fatal(err)
	}
	if kind, err := VerifyTransition(g.Anchor, g.Epoch, g.Snapshot, joinedEpoch, joinedState); err != nil || kind != Nonrestrictive {
		t.Fatal("Node join transition failed", err)
	}
	if _, err = DecodeInvitation(encoded(t, input["invitation"]), g.Anchor, g.Epoch, b.Public); err != nil {
		t.Fatal(err)
	}
	if _, err = DecodeConsent(encoded(t, input["consent"]), g.Anchor, g.Epoch, b.Public); err != nil {
		t.Fatal(err)
	}
	message, err := core.DecodeBundle(encoded(t, input["message"]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.DecryptBundle(message, &b); err != nil {
		t.Fatal("Node original-reader envelope failed", err)
	}
	if _, err = core.DecryptBundle(message, &c); err == nil {
		t.Fatal("Node history readable by newcomer")
	}
	badEpochs, err := array(input["badEpochs"], 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	for index, raw := range badEpochs {
		parsed, parseErr := decodeCertificate(encoded(t, raw), HeaderBytes, parseEpoch)
		if parseErr != nil {
			t.Fatal("negative control is not a shaped certificate", parseErr)
		}
		signer := a.Public
		if index == 0 {
			signer = b.Public
		}
		if err := verifyCertificate(parsed, signer, HeaderBytes); err != nil {
			t.Fatal("negative control lacks a real signature", err)
		}
		bad, err := DecodeEpoch(encoded(t, raw), g.Anchor)
		if err == nil {
			_, err = VerifyTransition(g.Anchor, g.Epoch, g.Snapshot, bad, joinedState)
		}
		if err == nil {
			t.Fatal("signed invalid Node epoch accepted")
		}
	}
	parent := AnchoredGroup{g.Anchor, joinedEpoch, joinedState}
	goInvitation, err := CreateInvitation(a, g.Anchor, joinedEpoch, c.Public)
	if err != nil {
		t.Fatal(err)
	}
	goConsent, err := AcceptInvitation(c, g.Anchor, joinedEpoch, goInvitation)
	if err != nil {
		t.Fatal(err)
	}
	added := updateFor(t, a, parent, Update{Title: "Criado em Go", Members: append(append([]core.PublicIdentity{}, joinedState.Members...), c.Public), Joins: []GroupConsent{goConsent}})
	goLeave, err := CreateLeave(c, g.Anchor, added.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	removed := updateFor(t, a, added, Update{Title: "Depois da remoção", Members: []core.PublicIdentity{a.Public, c.Public}})
	closed, err := CloseGroup(a, g.Anchor, removed.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	future, err := core.CreateBundle(a, "message", map[string]any{"type": "message", "groupEpoch": removed.Epoch.ID, "text": "Go after removal"}, removed.Snapshot.Members, false, core.DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	goGroup, err := CreateGroup(c, "Go \xed\xa0\x80 <rede> 😀")
	if err != nil {
		t.Fatal(err)
	}
	output := map[string]any{"result": "pass", "nodeGroupID": g.Anchor.ID, "nodeUnicodeSnapshotHash": unicodeGroup.Epoch.Body.SnapshotHash, "goGroup": goGroup, "invitation": goInvitation, "consent": goConsent, "added": Successor{added.Epoch, added.Snapshot}, "removed": Successor{removed.Epoch, removed.Snapshot}, "leave": goLeave, "closed": closed, "future": future, "wrongCreator": signedFor(t, b, removed.Epoch.Body), "nodeNegativeEpochsRejected": len(badEpochs), "originalReaderDecryption": true, "newcomerHistoryDenied": true}
	if err = os.WriteFile(filepath.Join(filepath.Dir(absolute), "go-output.json"), encoded(t, output), 0600); err != nil {
		t.Fatal(err)
	}
}
