import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  decryptBundle,
  verifyBundle,
} from "../../packages/core/src/index.js";
import { messagingPair } from "./group-send.js";
import { until } from "../helpers.js";

/** Real clients and automatic transport; only control proofs are moved by API. */
export async function groupConfirmationJourney(
  creator: "node" | "native",
  reader: "node" | "native",
) {
  const f = await messagingPair(creator, reader);
  try {
    const request = {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "Historical delivery and read",
        conversation: f.groupId,
        groupEpoch: f.epoch,
        groupAudience: "epoch",
      },
      recipients: [f.bob.id],
      ttlMs: 600000,
    };
    const sent = await f.a.call("send", request);
    await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    const delivered = await until(
      () => f.a.call("state"),
      (s) =>
        s.outbox.some((e: any) => e.id === sent.id && e.status === "received"),
    );
    const receivedAt = delivered.outbox.find((e: any) => e.id === sent.id)
      .recipients[0].receivedAt;
    assert.ok(receivedAt > 0);
    assert.equal((await f.b.call("state")).contacts.length, 0);
    const closed = await f.command(f.a, {
      action: "close",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: f.epoch,
    });
    await f.command(f.b, {
      action: "headers",
      groupId: f.groupId,
      headers: [closed.group.head],
    });
    const viewed = await f.b.call("view", { id: sent.id });
    assert.equal(viewed.content.text, request.content.text);
    const read = await until(
      () => f.a.call("state"),
      (s) => s.outbox.some((e: any) => e.id === sent.id && e.status === "read"),
    );
    const item = read.outbox.find((e: any) => e.id === sent.id);
    assert.equal(item.recipients[0].receivedAt, receivedAt);
    assert.ok(item.recipients[0].readAt >= receivedAt);
    assert.equal(item.groupAuthority.allowed, false);
    assert.equal((await f.a.call("send", request)).id, sent.id);
    assert.equal(
      (await f.a.call("outbox-retry", { operationId: request.operationId }))
        .outbox.attempts,
      item.attempts,
    );
    const events = read.objects.filter(
      (o: any) =>
        ["receipt", "delivery"].includes(o.kind) &&
        o.content.target === sent.id,
    );
    assert.deepEqual(events.map((o: any) => o.kind).sort(), [
      "delivery",
      "receipt",
    ]);
    for (const event of events) {
      assert.equal(event.author.id, f.bob.id);
      assert.deepEqual(
        [...event.readers].sort(),
        [f.alice.id, f.bob.id].sort(),
      );
      const full = await f.a.call("view", { id: event.id });
      assert.deepEqual(full.content, {
        type: event.kind,
        target: sent.id,
        conversation: f.groupId,
        targetEpoch: f.epoch,
        groupAudience: "historical",
      });
      const encrypted = JSON.parse(
        readFileSync(
          join(f.a.dir, "store", "objects", event.id + ".json"),
          "utf8",
        ),
      );
      verifyBundle(encrypted);
      assert.throws(
        () => decryptBundle(encrypted, createIdentity("Uninvited observer")),
        /autoriz|permiss|destinat|chave/i,
      );
    }
    await f.b.call("view", { id: sent.id });
    const again = await f.b.call("state");
    assert.equal(
      again.objects.filter(
        (o: any) => o.kind === "receipt" && o.content.target === sent.id,
      ).length,
      1,
    );
    assert.equal(again.contacts.length, 0);
    assert.equal(read.storage.reserved, 0);
    return {
      creator,
      reader,
      events: 2,
      receivedBeforeClose: true,
      readAfterClose: true,
      originalReadersOnly: true,
    };
  } finally {
    await f.close();
  }
}
