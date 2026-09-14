import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { importVault, type Bundle } from "../../packages/core/src/index.js";
import { createGroupInvitation } from "../../packages/groups/src/certificates.js";
import {
  sealGroupNotice,
  type GroupNotice,
} from "../../packages/groups/src/notices.js";
import { Router } from "../../packages/transport/src/index.js";
import { messagingPair } from "./group-send.js";
import { password, until } from "../helpers.js";

export async function groupNoticeReplay(
  backend: "node" | "native",
  blocked = false,
) {
  const f = await messagingPair(backend, backend),
    wire = new Router({ relay: false });
  const packets: any[] = [];
  wire.on("payload", (value) => packets.push(value));
  try {
    const owner = importVault(
      (await f.a.call("export", { password })).vault,
      password,
    );
    const proof = await f.command(f.a, {
      action: "proofs",
      groupId: f.groupId,
      from: 0,
    });
    const birth = proof.headers[0];
    const pending = await f.b.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "Must wait for cached notice proofs",
        conversation: f.groupId,
        groupEpoch: f.epoch,
        groupAudience: "epoch",
      },
      recipients: [f.alice.id],
    });
    assert.equal(pending.outbox.status, "pending");
    if (blocked)
      await f.b.call("action", {
        action: "block",
        target: f.alice.id,
        value: true,
      });
    await f.b.call("lock", {});
    wire.connectTcp("127.0.0.1", f.b.tcpPort);
    await until(
      async () => wire.peers,
      (peers) => peers.some((p) => p.connected),
    );
    const stale: GroupNotice = {
      type: "group-notice",
      version: 1,
      kind: "invitation",
      anchor: proof.anchor,
      parent: birth,
      member: f.bob,
      certificate: createGroupInvitation(owner, proof.anchor, birth, f.bob),
    };
    const controls: Bundle[] = [];
    for (let i = 0; i < 18; i++) controls.push(sealGroupNotice(owner, stale));
    await delay(20); // Make the safety notice sort strictly after the first replay slice.
    const removed = await f.command(f.a, {
      action: "commit",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: f.epoch,
      title: "Removal before a possible fresh invitation",
      members: [f.alice],
      joins: [],
    });
    const offered = await f.command(f.a, {
      action: "invite",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: removed.group.head.id,
      card: f.bob,
    });
    const fence = sealGroupNotice(owner, {
      ...stale,
      parent: removed.group.head,
      certificate: offered.operation.certificate,
    });
    for (const bundle of [...controls, fence])
      wire.broadcast({ type: "bundle", bundle });
    const stored = () =>
      readdirSync(join(f.b.dir, "store", "objects"))
        .filter((p) => p.endsWith(".json"))
        .map(
          (p) =>
            JSON.parse(
              readFileSync(join(f.b.dir, "store", "objects", p), "utf8"),
            ) as Bundle,
        )
        .filter(
          (b) =>
            b.manifest.kind === "group-notice" &&
            b.manifest.keys.some((k) => k.reader === f.bob.id),
        )
        .sort(
          (a, b) =>
            a.manifest.created - b.manifest.created ||
            a.manifest.id.localeCompare(b.manifest.id),
        );
    await until(
      async () => stored(),
      (values) => values.length >= 19,
    );
    assert.ok(
      stored().findIndex((b) => b.manifest.id === fence.manifest.id) >= 16,
      "safety notice did not cross a replay page boundary",
    );
    await f.b.call("unlock", { password });
    await assert.rejects(() =>
      f.b.call("send", {
        operationId: randomUUID(),
        content: {
          type: "message",
          text: "No replay bypass",
          conversation: f.groupId,
          groupEpoch: f.epoch,
          groupAudience: "epoch",
        },
        recipients: [f.alice.id],
      }),
    );
    const state = await until(
      () => f.b.call("state"),
      (s) =>
        s.outbox.some(
          (e: any) => e.id === pending.id && e.status === "superseded",
        ),
    );
    assert.equal(
      state.outbox.find((e: any) => e.id === pending.id).attempts,
      0,
    );
    const current = (
      await f.command(f.b, { action: "state", groupId: f.groupId })
    ).group;
    assert.equal(current.head.id, removed.group.head.id);
    assert.equal(current.status, "removed");
    assert.equal(
      current.pendingConsent,
      null,
      "fresh invitation became consent without a local action",
    );
    const inbox = (await f.command(f.b, { action: "notice-list" })).notices;
    assert.equal(
      inbox.some(
        (e: any) =>
          e.notice.certificate.id === offered.operation.certificate.id,
      ),
      !blocked,
    );
    const witness = await f.b.call("publish", {
      content: { type: "post", text: "Reachable after replay fence" },
      recipients: "public",
    });
    await until(
      async () => packets,
      (values) => values.some((p) => p.bundle?.manifest.id === witness.id),
    );
    assert.equal(
      packets.some((p) => p.bundle?.manifest.id === pending.id),
      false,
    );
    assert.equal(
      (await f.b.call("state")).objects.some(
        (o: any) => o.kind === "group-notice",
      ),
      false,
    );
  } finally {
    await wire.stop();
    await f.close();
  }
}
