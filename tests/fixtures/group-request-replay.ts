import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  canonical,
  importVault,
  type Bundle,
} from "../../packages/core/src/index.js";
import {
  openGroupControl,
  sealGroupControl,
} from "../../packages/groups/src/carriers.js";
import { Router } from "../../packages/transport/src/index.js";
import { messagingPair } from "./group-send.js";
import { password, until } from "../helpers.js";

export async function groupRequestReplay(backend: "node" | "native") {
  const f = await messagingPair(backend, backend),
    wire = new Router({ relay: false });
  const replies: Bundle[] = [];
  try {
    const identity = importVault(
      (await f.b.call("export", { password })).vault,
      password,
    );
    wire.on("payload", (p: any) => {
      try {
        if (p.type !== "bundle") return;
        const data = openGroupControl(p.bundle, identity);
        if (data.action === "headers" && data.from === 0)
          replies.push(p.bundle);
      } catch {}
    });
    const head = (await f.command(f.a, { action: "state", groupId: f.groupId }))
      .group.head;
    const request = sealGroupControl(
      identity,
      {
        type: "group-control",
        version: 1,
        action: "headers-request",
        groupId: f.groupId,
        to: f.alice.id,
        from: 0,
        count: 16,
        authorization: { id: head.id, number: head.body.number },
      },
      [f.alice],
    );
    wire.connectTcp("127.0.0.1", f.a.tcpPort);
    await until(
      async () => wire.peers,
      (p) => p.some((v) => v.connected),
    );
    const send = () => wire.broadcast({ type: "bundle", bundle: request });
    send();
    await until(
      async () => replies,
      (r) => r.length === 1,
    );
    const first = replies[0],
      at = Date.now();
    // Receiver deliberately discards the first logical response. Both deliveries
    // still traverse real sockets; no registry is populated by the fixture.
    send();
    await delay(200);
    assert.equal(replies.length, 1, "duplicate bypassed reply cooldown");
    await until(
      async () => Date.now() - at,
      (ms) => ms > 10100,
      12000,
    );
    send();
    await until(
      async () => replies,
      (r) => r.length === 2,
    );
    assert.equal(
      canonical(replies[1]),
      canonical(first),
      "recovery unnecessarily re-signed cached response",
    );
    const closed = await f.command(f.a, {
      action: "close",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: head.id,
    });
    await delay(1100);
    send();
    await until(
      async () => replies,
      (r) =>
        r.some((bundle) => {
          const value = openGroupControl(bundle, identity);
          return (
            value.action === "headers" &&
            (value.head as any).id === closed.group.head.id
          );
        }),
    );
    const value = openGroupControl(replies.at(-1)!, identity);
    assert.equal(value.action, "headers");
    if (value.action !== "headers") throw new Error("wrong reply kind");
    assert.equal((value.head as any).body.state, "closed");
    assert.notEqual(
      replies.at(-1)!.manifest.id,
      first.manifest.id,
      "same request replayed stale authority",
    );
    return {
      backend,
      sameRequestId: true,
      firstResponseDropped: true,
      cooldownEnforced: true,
      sameBytesRecovered: true,
      changedAuthorityRevalidated: true,
    };
  } finally {
    await wire.stop();
    await f.close();
  }
}
