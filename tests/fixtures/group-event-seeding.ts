import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import {
  decryptBundle,
  importVault,
  verifyBundle,
} from "../../packages/core/src/index.js";
import { messagingPair } from "./group-send.js";
import { launch, password, until, type Client } from "../helpers.js";

/** Three real API-created identities. Group proofs are transferred explicitly;
 * payloads travel only through real socket peers, including offline takeover. */
export async function groupEventSeeding(
  creator: "node" | "native",
  relay: "node" | "native",
  newcomer: "node" | "native",
) {
  const f = await messagingPair(creator, relay);
  let c: Client | undefined;
  let resumed: Client | undefined;
  try {
    c = await launch(undefined, 0, 0, newcomer);
    const carla = await c.call("setup", {
      name: "New consenting group reader",
      password,
    });
    const old = await f.a.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "Before Carla joined",
        conversation: f.groupId,
        groupEpoch: f.epoch,
        groupAudience: "epoch",
      },
      recipients: [f.bob.id],
      ttlMs: 600000,
    });
    await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    await until(
      () => f.b.call("state"),
      (s) => s.objects.some((o: any) => o.id === old.id),
    );
    const parent = (
      await f.command(f.a, { action: "state", groupId: f.groupId })
    ).group.head;
    const proof = await f.command(f.a, {
      action: "proofs",
      groupId: f.groupId,
      from: 0,
    });
    const invitation = (
      await f.command(f.a, {
        action: "invite",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: f.epoch,
        card: carla,
      })
    ).operation.certificate;
    await f.command(c, {
      action: "remember",
      operationId: randomUUID(),
      anchor: proof.anchor,
      parent,
      invitation,
    });
    await f.command(c, {
      action: "headers",
      groupId: f.groupId,
      headers: proof.headers,
    });
    const consent = (
      await f.command(c, {
        action: "accept",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: f.epoch,
      })
    ).operation.certificate;
    const joined = await f.command(f.a, {
      action: "commit",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: f.epoch,
      title: "Three actual readers",
      members: [f.alice, f.bob, carla],
      joins: [consent],
    });
    const current = joined.group.head.id;
    const snapshot = (
      await f.command(f.a, {
        action: "private-state",
        groupId: f.groupId,
        epochId: current,
      })
    ).snapshot;
    for (const client of [f.b, c]) {
      await f.command(client, {
        action: "headers",
        groupId: f.groupId,
        headers: [joined.group.head],
      });
      await f.command(client, {
        action: "snapshot",
        groupId: f.groupId,
        epochId: current,
        snapshot,
      });
    }
    const oldReaction = {
      type: "reaction",
      emoji: "heart",
      value: true,
      target: old.id,
      conversation: f.groupId,
      groupEpoch: current,
      targetEpoch: f.epoch,
      groupAudience: "target",
    };
    await assert.rejects(() =>
      f.b.call("publish", {
        content: oldReaction,
        recipients: [f.alice.id, carla.id],
      }),
    );
    await assert.rejects(() =>
      f.b.call("publish", {
        content: { ...oldReaction, groupEpoch: f.epoch },
        recipients: [f.alice.id],
      }),
    );
    const historical = await f.b.call("publish", {
      content: oldReaction,
      recipients: [f.alice.id],
    });
    assert.deepEqual(
      [...historical.readers].sort(),
      [f.alice.id, f.bob.id].sort(),
    );
    const sent = await f.a.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "For all three admitted readers",
        conversation: f.groupId,
        groupEpoch: current,
        groupAudience: "epoch",
      },
      recipients: [f.bob.id, carla.id],
      ttlMs: 600000,
    });
    await until(
      () => f.b.call("state"),
      (s) => s.objects.some((o: any) => o.id === sent.id),
    );
    const edit = await f.a.call("publish", {
      content: {
        type: "edit",
        text: "Author-corrected content from the offline cache",
        target: sent.id,
        conversation: f.groupId,
        groupEpoch: current,
        targetEpoch: current,
        groupAudience: "target",
      },
      recipients: [f.bob.id, carla.id],
    });
    await until(
      () => f.b.call("state"),
      (s) =>
        s.objects.some(
          (o: any) =>
            o.id === sent.id && o.editedText?.startsWith("Author-corrected"),
        ),
    );
    assert.equal((await c.call("state")).peers.length, 0);
    assert.equal(
      (await c.call("state")).objects.some((o: any) => o.id === sent.id),
      false,
      "isolated reader received without a path",
    );
    await f.a.stop();
    const noOrigin = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: f.a.tcpPort });
      socket.setTimeout(1500, () => {
        socket.destroy();
        reject(new Error("offline origin control timed out"));
      });
      socket.on("connect", () => {
        socket.destroy();
        reject(new Error("origin still reachable"));
      });
      socket.on("error", (e: NodeJS.ErrnoException) => {
        socket.destroy();
        resolve(e.code ?? "");
      });
    });
    assert.equal(noOrigin, "ECONNREFUSED");
    await c.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    const taken = await until(
      () => c!.call("state"),
      (s) =>
        s.objects.some(
          (o: any) =>
            o.id === sent.id && o.editedText?.startsWith("Author-corrected"),
        ),
      20000,
    );
    const message = taken.objects.find((o: any) => o.id === sent.id);
    assert.equal(message.author.id, f.alice.id);
    assert.equal(
      taken.objects.find((o: any) => o.id === edit.id).author.id,
      f.alice.id,
    );
    await c.call("retrieve", { id: old.id });
    await c.call("retrieve", { id: historical.id });
    await until(
      async () =>
        [old.id, historical.id].every((id) =>
          existsSync(join(c!.dir, "store", "objects", id + ".json")),
        ),
      Boolean,
      20000,
    );
    const vault = (await c.call("export", { password })).vault,
      identity = importVault(vault, password);
    assert.equal(identity.public.id, carla.id);
    for (const id of [old.id, historical.id]) {
      const bundle = JSON.parse(
        readFileSync(join(c.dir, "store", "objects", id + ".json"), "utf8"),
      );
      verifyBundle(bundle);
      assert.throws(() => decryptBundle(bundle, identity));
    }
    await assert.rejects(() =>
      c!.call("publish", {
        content: {
          type: "edit",
          text: "Reader pretending to own the message",
          target: sent.id,
          conversation: f.groupId,
          groupEpoch: current,
          targetEpoch: current,
          groupAudience: "target",
        },
        recipients: [f.alice.id, f.bob.id],
      }),
    );
    const reply = await c.call("publish", {
      content: {
        type: "reaction",
        emoji: "heart",
        value: true,
        target: sent.id,
        conversation: f.groupId,
        groupEpoch: current,
        targetEpoch: current,
        groupAudience: "target",
      },
      recipients: [f.alice.id, f.bob.id],
    });
    await until(
      () => f.b.call("state"),
      (s) => s.objects.some((o: any) => o.id === reply.id),
    );
    assert.equal(
      (await c.call("state")).objects.some((o: any) => o.id === old.id),
      false,
    );
    for (const client of [f.b, c])
      assert.equal((await client.call("state")).contacts.length, 0);
    // Restart the real author, then remove an original reader. New edits use
    // the current intersection; the historical deletion still reaches all old readers.
    resumed = await launch(f.a.dir, Number(new URL(f.a.url).port), 0, creator);
    await resumed.call("unlock", { password });
    const restored = await resumed.call("view", { id: sent.id });
    assert.equal(
      restored.editedText,
      "Author-corrected content from the offline cache",
    );
    const removed = await f.command(resumed, {
      action: "commit",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: current,
      title: "Only the remaining readers",
      members: [f.alice, carla],
      joins: [],
    });
    const nextEpoch = removed.group.head.id;
    const nextSnapshot = (
      await f.command(resumed, {
        action: "private-state",
        groupId: f.groupId,
        epochId: nextEpoch,
      })
    ).snapshot;
    for (const client of [f.b, c])
      await f.command(client, {
        action: "headers",
        groupId: f.groupId,
        headers: [removed.group.head],
      });
    await f.command(c, {
      action: "snapshot",
      groupId: f.groupId,
      epochId: nextEpoch,
      snapshot: nextSnapshot,
    });
    assert.equal(
      (await f.command(f.b, { action: "state", groupId: f.groupId })).group
        .status,
      "removed",
    );
    await assert.rejects(() =>
      f.b.call("publish", {
        content: { ...oldReaction, target: sent.id, targetEpoch: current },
        recipients: [f.alice.id, carla.id],
      }),
    );
    const correction = {
      type: "edit",
      text: "Only current original readers can decrypt this correction",
      target: sent.id,
      conversation: f.groupId,
      groupEpoch: nextEpoch,
      targetEpoch: current,
      groupAudience: "target",
    };
    await assert.rejects(() =>
      resumed!.call("publish", {
        content: correction,
        recipients: [f.bob.id, carla.id],
      }),
    );
    const corrected = await resumed.call("publish", {
      content: correction,
      recipients: [carla.id],
    });
    assert.deepEqual(
      [...corrected.readers].sort(),
      [f.alice.id, carla.id].sort(),
    );
    await resumed.call("connect", { host: "127.0.0.1", port: c.tcpPort });
    await until(
      () => c!.call("state"),
      (s) =>
        s.objects.some(
          (o: any) => o.id === sent.id && o.editedText === correction.text,
        ),
    );
    await until(
      async () =>
        existsSync(join(f.b.dir, "store", "objects", corrected.id + ".json")),
      Boolean,
    );
    const bobIdentity = importVault(
      (await f.b.call("export", { password })).vault,
      password,
    );
    const privateCorrection = JSON.parse(
      readFileSync(
        join(f.b.dir, "store", "objects", corrected.id + ".json"),
        "utf8",
      ),
    );
    verifyBundle(privateCorrection);
    assert.throws(() => decryptBundle(privateCorrection, bobIdentity));
    assert.equal(
      (await f.b.call("view", { id: sent.id })).editedText,
      "Author-corrected content from the offline cache",
    );
    await resumed.call("publish", {
      content: {
        type: "delete",
        target: sent.id,
        conversation: f.groupId,
        targetEpoch: current,
        groupAudience: "historical",
      },
      recipients: [f.bob.id, carla.id],
    });
    for (const client of [f.b, c])
      await until(
        () => client.call("state"),
        (s) => s.objects.some((o: any) => o.id === sent.id && o.deleted),
      );
    return {
      creator,
      relay,
      newcomer,
      offlineOriginRefused: true,
      seederPreservesAuthor: true,
      newcomerCannotReadOldBytes: true,
      intersectionExcludesNewcomer: true,
      restartPreservesMutation: true,
      removalExcludesNewEdit: true,
      historicalDeleteReachesRemovedReader: true,
    };
  } finally {
    await resumed?.stop();
    if (c) {
      await c.stop();
      rmSync(c.dir, { recursive: true, force: true });
    }
    await f.close();
  }
}
