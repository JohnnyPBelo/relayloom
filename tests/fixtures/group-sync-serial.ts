import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { importVault } from "../../packages/core/src/index.js";
import { openGroupControl } from "../../packages/groups/src/carriers.js";
import { launch, password, until, type Client } from "../helpers.js";
import { startPTY } from "../native/mixed-helper.js";

export async function groupSyncSerial(creator: "node" | "native") {
  const pty = await startPTY();
  const clients: Client[] = [];
  try {
    const a = await launch(undefined, 0, 0, creator);
    clients.push(a);
    const b = await launch(undefined, 0, 0, "node");
    clients.push(b);
    const c = await launch(undefined, 0, -1, "node");
    clients.push(c);
    const alice = await a.call("setup", { name: "TCP proof owner", password });
    await b.call("setup", { name: "Opaque serial relay", password });
    const carla = await c.call("setup", {
      name: "Serial proof reader",
      password,
    });
    const command = (client: Client, body: unknown) =>
      client.call("group-command", body);
    let group = (
      await command(a, {
        action: "create",
        operationId: randomUUID(),
        title: "Heterogeneous group",
      })
    ).group;
    const id = group.id,
      anchor = (await command(a, { action: "proofs", groupId: id, from: 0 }))
        .anchor;
    const invitation = (
      await command(a, {
        action: "invite",
        operationId: randomUUID(),
        groupId: id,
        expected: group.head.id,
        card: carla,
      })
    ).operation.certificate;
    await command(c, {
      action: "remember",
      operationId: randomUUID(),
      anchor,
      parent: group.head,
      invitation,
    });
    await b.call("serial", { path: pty.left });
    await c.call("serial", { path: pty.right });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const states = await until(
      async () => [
        await a.call("state"),
        await b.call("state"),
        await c.call("state"),
      ],
      (s) =>
        s[0].peers.length === 1 &&
        s[1].peers.length === 2 &&
        s[2].peers.length === 1,
    );
    assert.equal(states[2].tcpPort, -1);
    assert.deepEqual(
      states[2].peers.map((p: any) => p.medium),
      ["serial"],
    );
    assert.equal(states[0].peers[0].address, `127.0.0.1:${b.tcpPort}`);
    assert.deepEqual(states[1].peers.map((p: any) => p.medium).sort(), [
      "serial",
      "tcp",
    ]);
    await until(
      () => command(c, { action: "state", groupId: id }),
      (s) => s.group.head?.id === group.head.id,
      20000,
    );
    assert.equal(
      (
        await command(c, {
          action: "private-state",
          groupId: id,
          epochId: group.head.id,
        })
      ).snapshot,
      null,
    );
    const consent = (
      await command(c, {
        action: "accept",
        operationId: randomUUID(),
        groupId: id,
        expected: group.head.id,
      })
    ).operation.certificate;
    // Explicit consent certificate transfer is retained until C2; all chain,
    // private-state and subsequent epoch updates use the real heterogeneous route.
    group = (
      await command(a, {
        action: "commit",
        operationId: randomUUID(),
        groupId: id,
        expected: group.head.id,
        title: "First authorised serial epoch",
        members: [alice, carla],
        joins: [consent],
      })
    ).group;
    await until(
      () => command(c, { action: "state", groupId: id }),
      (s) => s.group.head?.id === group.head.id && s.group.status === "active",
      20000,
    );
    const positive = await a.call("publish", {
      content: { type: "post", text: "Real two-hop route control" },
      recipients: "public",
    });
    const seen = await until(
      () => c.call("state"),
      (s) => s.objects.some((o: any) => o.id === positive.id),
    );
    const route = seen.objects.find((o: any) => o.id === positive.id).route;
    assert.equal(route.medium, "serial");
    assert.equal(route.hops.length, 2);
    const old = group.head.id;
    pty.partition();
    await delay(100);
    for (let i = 0; i < 2; i++)
      group = (
        await command(a, {
          action: "commit",
          operationId: randomUUID(),
          groupId: id,
          expected: group.head.id,
          title: `Sealed control during partition ${i}`,
          members: [alice, carla],
          joins: [],
        })
      ).group;
    const owner = importVault(
      (await a.call("export", { password })).vault,
      password,
    );
    await until(
      async () =>
        readdirSync(join(b.dir, "store", "objects")).some((file) => {
          try {
            const bundle = JSON.parse(
              readFileSync(join(b.dir, "store", "objects", file), "utf8"),
            );
            const value = openGroupControl(bundle, owner);
            return (
              value.action === "snapshot" &&
              (value.epoch as any).id === group.head.id
            );
          } catch {
            return false;
          }
        }),
      Boolean,
      15000,
    );
    await delay(2300);
    assert.equal(
      (await command(c, { action: "state", groupId: id })).group.head.id,
      old,
    );
    await b.call("settings", { relay: false });
    pty.partition();
    await delay(2300);
    assert.equal(
      (await command(c, { action: "state", groupId: id })).group.head.id,
      old,
      "disabled relay still delivered a new proof",
    );
    await a.stop();
    assert.notEqual(a.process.exitCode, null);
    await b.call("settings", { relay: true });
    const restored = await until(
      () => command(c, { action: "state", groupId: id }),
      (s) => s.group.head?.id === group.head.id && s.group.status === "active",
      25000,
    );
    assert.equal(restored.group.creator.id, alice.id);
    assert.equal(restored.group.title, "Sealed control during partition 1");
    assert.equal((await command(b, { action: "list" })).groups.length, 0);
    assert.ok((await b.call("state")).counters.forwarded > 0);
    assert.equal((await c.call("state")).contacts.length, 0);
    return {
      creator,
      route: "TCP to real serialport/PTY",
      readerTcpDisabled: true,
      partitionAndRelayControls: true,
      opaqueSeeder: true,
      creatorStopped: true,
      physicalRadio: false,
    };
  } finally {
    for (const client of clients) await client.stop();
    await pty.stop();
    for (const client of clients)
      rmSync(client.dir, { recursive: true, force: true });
  }
}
