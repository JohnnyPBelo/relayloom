import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { launch, password, until, type Client } from "../helpers.js";
import { messagingPair } from "./group-send.js";

export async function groupSyncSeeding(
  creator: "node" | "native",
  relay: "node" | "native",
  reader: "node" | "native",
) {
  const f = await messagingPair(creator, relay);
  let c: Client | undefined, restored: Client | undefined;
  const command = (client: Client, body: unknown) =>
    client.call("group-command", body);
  try {
    c = await launch(undefined, 0, 0, reader);
    const carla = await c.call("setup", {
      name: "Offline proof reader",
      password,
    });
    const parent = (await command(f.a, { action: "state", groupId: f.groupId }))
      .group.head;
    const anchor = (
      await command(f.a, { action: "proofs", groupId: f.groupId, from: 0 })
    ).anchor;
    const invitation = (
      await command(f.a, {
        action: "invite",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: parent.id,
        card: carla,
      })
    ).operation.certificate;
    await command(c, {
      action: "remember",
      operationId: randomUUID(),
      anchor,
      parent,
      invitation,
    });
    await c.call("connect", { host: "127.0.0.1", port: f.a.tcpPort });
    await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    await until(
      () => command(c!, { action: "state", groupId: f.groupId }),
      (s) => s.group.head?.id === parent.id,
      25000,
    );
    const consent = (
      await command(c, {
        action: "accept",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: parent.id,
      })
    ).operation.certificate;
    let group = (
      await command(f.a, {
        action: "commit",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: parent.id,
        title: "Before the partition",
        members: [f.alice, f.bob, carla],
        joins: [consent],
      })
    ).group;
    for (const client of [f.b, c])
      await until(
        () => command(client, { action: "state", groupId: f.groupId }),
        (s) =>
          s.group.head?.id === group.head.id && s.group.status === "active",
        25000,
      );
    const old = group.head.id,
      port = Number(new URL(c.url).port);
    await c.stop();
    for (let i = 0; i < 3; i++)
      group = (
        await command(f.a, {
          action: "commit",
          operationId: randomUUID(),
          groupId: f.groupId,
          expected: group.head.id,
          title: `Partition update ${i}`,
          members: [f.alice, f.bob, carla],
          joins: [],
        })
      ).group;
    await until(
      () => command(f.b, { action: "state", groupId: f.groupId }),
      (s) => s.group.head?.id === group.head.id && s.group.status === "active",
      30000,
    );
    await f.a.stop();
    assert.notEqual(f.a.process.exitCode, null);
    restored = await launch(c.dir, port, 0, reader);
    await restored.call("unlock", { password });
    assert.equal(
      (await command(restored, { action: "state", groupId: f.groupId })).group
        .head.id,
      old,
    );
    await restored.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    const healed = await until(
      () => command(restored!, { action: "state", groupId: f.groupId }),
      (s) => s.group.head?.id === group.head.id && s.group.status === "active",
      40000,
    );
    assert.equal(healed.group.title, "Partition update 2");
    assert.equal(healed.group.creator.id, f.alice.id);
    const sent = await restored.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "After proof recovery from another reader",
        conversation: f.groupId,
        groupEpoch: group.head.id,
        groupAudience: "epoch",
      },
      recipients: [f.alice.id, f.bob.id],
    });
    await until(
      () => f.b.call("state"),
      (s) => s.objects.some((o: any) => o.id === sent.id),
    );
    assert.equal((await restored.call("state")).contacts.length, 0);
    return {
      creator,
      relay,
      reader,
      partition: true,
      originalOffline: true,
      intermediateSnapshotsRecovered: true,
      sourceAuthorPreserved: true,
    };
  } finally {
    await restored?.stop();
    if (c) {
      await c.stop();
      rmSync(c.dir, { recursive: true, force: true });
    }
    await f.close();
  }
}
