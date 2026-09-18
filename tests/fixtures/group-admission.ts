import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import {
  createBundle,
  importVault,
  hash,
  type Bundle,
} from "../../packages/core/src/index.js";
import { Router } from "../../packages/transport/src/index.js";
import { launch, password, until, type Client } from "../helpers.js";

export async function groupAdmissionJourney(
  creatorBackend: "node" | "native",
  memberBackend: "node" | "native",
  restartBackend: "node" | "native",
) {
  const a = await launch(undefined, 0, 0, creatorBackend),
    b = await launch(undefined, 0, 0, memberBackend);
  const peer = new Router();
  let disconnect: (() => void) | undefined,
    disconnectA: (() => void) | undefined,
    restored: Client | undefined;
  const command = (c: Client, q: unknown) => c.call("group-command", q);
  try {
    const alice = await a.call("setup", { name: "Alice", password }),
      bob = await b.call("setup", { name: "Bruno", password });
    const identity = importVault(
      (await a.call("export", { password })).vault,
      password,
    );
    const bobIdentity = importVault(
      (await b.call("export", { password })).vault,
      password,
    );
    await a.call("contact", { contact: bob });
    await b.call("settings", { relay: false });
    const created = await command(a, {
        action: "create",
        operationId: randomUUID(),
        title: "Admission",
      }),
      groupId = created.group.id,
      parent = created.group.head;
    const proof = await command(a, { action: "proofs", groupId, from: 0 });
    const invitation = (
      await command(a, {
        action: "invite",
        operationId: randomUUID(),
        groupId,
        expected: parent.id,
        card: bob,
      })
    ).operation.certificate;
    await command(b, {
      action: "remember",
      operationId: randomUUID(),
      anchor: proof.anchor,
      parent,
      invitation,
    });
    await command(b, { action: "headers", groupId, headers: proof.headers });
    const consent = (
      await command(b, {
        action: "accept",
        operationId: randomUUID(),
        groupId,
        expected: parent.id,
      })
    ).operation.certificate;
    const joined = await command(a, {
      action: "commit",
      operationId: randomUUID(),
      groupId,
      expected: parent.id,
      title: "Admission",
      members: [alice, bob],
      joins: [consent],
    });
    const epoch = joined.group.head.id,
      snapshot = (
        await command(a, { action: "private-state", groupId, epochId: epoch })
      ).snapshot;
    await command(b, {
      action: "headers",
      groupId,
      headers: [joined.group.head],
    });
    const message = (text: string) =>
      createBundle(
        identity,
        "message",
        {
          type: "message",
          conversation: groupId,
          groupAudience: "epoch",
          groupEpoch: epoch,
          members: snapshot.members,
          text,
        },
        snapshot.members,
        60000,
      );
    const known = message("Accepted only after proof"),
      late = message("Unknown at the cutoff");
    disconnect = peer.connectTcp("127.0.0.1", b.tcpPort);
    await until(
      async () => peer.peers,
      (peers) => peers.some((p) => p.connected),
    );
    const send = (bundle: Bundle) =>
      peer.broadcast({ type: "bundle", bundle }, "normal");
    send(known);
    let state = await until(
      () => b.call("state"),
      (s) => s.groupContent.held.some((h: any) => h.id === known.manifest.id),
    );
    assert.equal(
      state.objects.some((o: any) => o.id === known.manifest.id),
      false,
    );
    assert.equal(state.groupContent.held[0].reason, "missing-private-snapshot");
    assert.equal(state.groupContent.held[0].available, true);
    assert.equal(state.storage.reserved, 1);
    assert.equal(
      state.objects.some(
        (o: any) =>
          ["receipt", "delivery"].includes(o.kind) &&
          o.content.target === known.manifest.id,
      ),
      false,
      "held content must not produce delivery or read confirmation before admission",
    );
    await command(b, {
      action: "snapshot",
      groupId,
      epochId: epoch,
      snapshot,
    });
    state = await until(
      () => b.call("state"),
      (s) => s.objects.some((o: any) => o.id === known.manifest.id),
    );
    assert.equal(state.groupContent.held.length, 0);
    assert.equal(state.storage.reserved, 0);
    // Make the CI interleaving explicit: automatic delivery may already exist
    // by the time the newly admitted object is observed on a slower host.
    state = await until(
      () => b.call("state"),
      (s) =>
        s.objects.some(
          (o: any) =>
            o.kind === "delivery" && o.content.target === known.manifest.id,
        ),
    );
    disconnectA = peer.connectTcp("127.0.0.1", a.tcpPort);
    await until(
      async () => peer.peers,
      (peers) => peers.filter((p) => p.connected).length === 2,
    );
    send(known);
    await until(
      () => a.call("state"),
      (s) => s.objects.some((o: any) => o.id === known.manifest.id),
    );
    assert.equal(
      (await b.call("view", { id: known.manifest.id })).content.text,
      "Accepted only after proof",
    );
    assert.equal(state.groupContent.outbound, false);
    // The legacy outbound path stays disabled, while the implemented epoch
    // confirmation path emits minimal historical facts after admission/read.
    state = await until(
      () => b.call("state"),
      (s) =>
        s.objects.some(
          (o: any) =>
            o.kind === "receipt" && o.content.target === known.manifest.id,
        ),
    );
    const facts = state.objects.filter(
      (o: any) =>
        ["receipt", "delivery"].includes(o.kind) &&
        o.content.target === known.manifest.id,
    );
    assert.deepEqual(facts.map((o: any) => o.kind).sort(), [
      "delivery",
      "receipt",
    ]);
    for (const fact of facts) {
      assert.equal(fact.author.id, bob.id);
      assert.equal(fact.public, false);
      assert.deepEqual(
        [...fact.readers].sort(),
        snapshot.members.map((c: any) => c.id).sort(),
      );
      assert.deepEqual(
        (await b.call("view", { id: fact.id })).content,
        {
          type: fact.kind,
          target: known.manifest.id,
          conversation: groupId,
          groupAudience: "historical",
          targetEpoch: epoch,
        },
        "confirmations must carry the exact original epoch binding, never the legacy schema",
      );
    }
    const closed = await command(a, {
      action: "close",
      operationId: randomUUID(),
      groupId,
      expected: epoch,
    });
    const observed = await command(b, {
      action: "headers",
      groupId,
      headers: [
        closed.group.head,
        {
          ...closed.group.head,
          signature: Buffer.alloc(64).toString("base64"),
        },
      ],
    });
    assert.ok(observed.observation.rejected);
    await assert.rejects(
      a.call("publish", {
        content: {
          type: "edit",
          target: known.manifest.id,
          text: "Legacy local bypass",
        },
        recipients: snapshot.members.map((card: any) => card.id),
      }),
      /acção.*grupo/i,
    );
    send(late);
    state = await until(
      () => b.call("state"),
      (s) => s.groupContent.held.some((h: any) => h.id === late.manifest.id),
    );
    assert.equal(
      state.objects.some((o: any) => o.id === known.manifest.id),
      true,
    );
    assert.equal(
      state.objects.some((o: any) => o.id === late.manifest.id),
      false,
    );
    const hold = state.groupContent.held.find(
      (h: any) => h.id === late.manifest.id,
    );
    assert.equal(hold.current, "quarantine");
    assert.equal(hold.available, true);
    await b.stop();
    disconnect();
    disconnect = undefined;
    restored = await launch(b.dir, 0, 0, restartBackend);
    await restored.call("unlock", { password });
    state = await restored.call("state");
    assert.equal(state.storage.reserved, 1);
    assert.equal(state.groupContent.held[0].id, late.manifest.id);
    assert.equal(
      state.objects.some((o: any) => o.id === known.manifest.id),
      true,
    );
    disconnect = peer.connectTcp("127.0.0.1", restored.tcpPort);
    await until(
      async () => peer.peers,
      (peers) => peers.filter((p) => p.connected).length === 2,
    );
    const historical = {
      type: "receipt",
      conversation: groupId,
      groupAudience: "historical",
      targetEpoch: epoch,
      target: known.manifest.id,
    };
    const bad = createBundle(
      bobIdentity,
      "receipt",
      { ...historical, text: "Must never survive projection" },
      snapshot.members,
      60000,
    );
    const good = createBundle(
      bobIdentity,
      "receipt",
      historical,
      snapshot.members,
      60000,
    );
    send(bad);
    send(good);
    await until(
      () => restored!.call("retrieve", { id: bad.manifest.id }),
      (r) => r.status === "unreadable",
    );
    state = await until(
      () => restored!.call("state"),
      (s) => s.objects.some((o: any) => o.id === good.manifest.id),
    );
    assert.equal(
      state.objects.some((o: any) => o.id === bad.manifest.id),
      false,
      "full historical schema is checked before summaries discard extensions",
    );
    const unboundEdit = createBundle(
      identity,
      "edit",
      {
        type: "edit",
        target: known.manifest.id,
        text: "Legacy network bypass",
      },
      snapshot.members,
      60000,
    );
    const wrongDelete = createBundle(
      bobIdentity,
      "delete",
      { ...historical, type: "delete" },
      snapshot.members,
      60000,
    );
    const staleEdit = createBundle(
      identity,
      "edit",
      {
        type: "edit",
        conversation: groupId,
        groupAudience: "target",
        groupEpoch: epoch,
        targetEpoch: epoch,
        target: known.manifest.id,
        text: "New edit after closure",
      },
      snapshot.members,
      60000,
    );
    const unboundReceipt = createBundle(
      bobIdentity,
      "receipt",
      {
        type: "receipt",
        target: known.manifest.id,
      },
      snapshot.members,
      60000,
    );
    for (const denied of [
      unboundEdit,
      wrongDelete,
      staleEdit,
      unboundReceipt,
    ]) {
      send(denied);
      await until(
        () => restored!.call("retrieve", { id: denied.manifest.id }),
        (r) => r.status === "unreadable",
      );
    }
    const unchanged = await restored.call("view", { id: known.manifest.id });
    assert.notEqual(
      unchanged.deleted,
      true,
      "a reader cannot delete the author's history",
    );
    assert.equal(
      unchanged.editedText,
      undefined,
      "legacy and stale-epoch edits cannot bypass materialization checks",
    );
    const readers = [alice, bob].sort((x, y) => x.id.localeCompare(y.id)),
      dm = {
        type: "message",
        conversation: "dm:" + hash(readers.map((c) => c.id).join(":")),
        members: readers,
        text: "Legacy positive",
      };
    const validDM = createBundle(identity, "message", dm, readers, 60000),
      badDM = createBundle(
        identity,
        "message",
        { ...dm, groupEpoch: false },
        readers,
        60000,
      );
    send(badDM);
    send(validDM);
    await until(
      () => restored!.call("retrieve", { id: badDM.manifest.id }),
      (r) => r.status === "unreadable",
    );
    state = await until(
      () => restored!.call("state"),
      (s) => s.objects.some((o: any) => o.id === validDM.manifest.id),
    );
    assert.equal(
      state.objects.some((o: any) => o.id === badDM.manifest.id),
      false,
      "falsy group tags cannot fall through to DM authorization",
    );
  } finally {
    disconnect?.();
    disconnectA?.();
    await peer.stop();
    await a.stop();
    await b.stop();
    await restored?.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
}
