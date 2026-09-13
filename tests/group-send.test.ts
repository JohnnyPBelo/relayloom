import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIdentity } from "../packages/core/src/index.js";
import { messagingPair } from "./fixtures/group-send.js";
import { until } from "./helpers.js";

test(
  "actual group send APIs create durable encrypted text, attachment and reply over TCP without global contacts",
  { timeout: 45000 },
  async () => {
    const f = await messagingPair();
    try {
      assert.equal((await f.a.call("state")).contacts.length, 0);
      assert.equal((await f.b.call("state")).contacts.length, 0);
      const bytes = Buffer.from("Actual group attachment\0with exact bytes"),
        operationId = randomUUID();
      const content = {
        type: "message",
        text: "From the real group send API",
        conversation: f.groupId,
        groupEpoch: f.epoch,
        groupAudience: "epoch",
        attachments: [
          {
            name: "group.txt",
            mime: "text/plain",
            data: bytes.toString("base64"),
          },
        ],
      };
      const request = {
        operationId,
        content,
        recipients: [f.bob.id],
        ttlMs: 600000,
      };
      const first = await f.a.call("send", request);
      assert.equal(first.accepted, true);
      assert.equal(first.outbox.groupEpoch, f.epoch);
      assert.equal(first.outbox.attempts, 0);
      assert.equal((await f.a.call("state")).storage.reserved, 1);
      assert.equal((await f.a.call("send", request)).id, first.id);
      await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
      const received = await until(
        () => f.b.call("state"),
        (s) => s.objects.some((o: any) => o.id === first.id),
      );
      const message = received.objects.find((o: any) => o.id === first.id);
      assert.equal(message.author.id, f.alice.id);
      assert.equal(message.public, false);
      assert.deepEqual(
        [...message.readers].sort(),
        [f.alice.id, f.bob.id].sort(),
      );
      assert.equal(message.content.text, content.text);
      const file = await f.b.call("attachment", { id: first.id, index: 0 });
      assert.deepEqual(Buffer.from(file.data, "base64"), bytes);
      const reply = await f.b.call("send", {
        operationId: randomUUID(),
        content: {
          type: "message",
          text: "An actual reply",
          conversation: f.groupId,
          groupEpoch: f.epoch,
          groupAudience: "target",
          replyTo: first.id,
          targetEpoch: f.epoch,
        },
        recipients: [f.alice.id],
        ttlMs: 600000,
      });
      const response = await until(
        () => f.a.call("state"),
        (s) => s.objects.some((o: any) => o.id === reply.id),
      );
      assert.equal(
        response.objects.find((o: any) => o.id === reply.id).author.id,
        f.bob.id,
      );
      assert.equal((await f.b.call("state")).contacts.length, 0);
    } finally {
      await f.close();
    }
  },
);

test(
  "new group sends require current head and exact snapshot audience; retained operation remains immutable",
  { timeout: 45000 },
  async () => {
    const f = await messagingPair();
    try {
      const content = {
        type: "message",
        text: "Original epoch",
        conversation: f.groupId,
        groupEpoch: f.epoch,
        groupAudience: "epoch",
      };
      const request = {
        operationId: randomUUID(),
        content,
        recipients: [f.bob.id],
        ttlMs: 600000,
      };
      const original = await f.a.call("send", request);
      await assert.rejects(
        f.a.call("send", {
          ...request,
          operationId: randomUUID(),
          recipients: [createIdentity("Outsider").public.id],
        }),
        /audiência|destinatários/,
      );
      await assert.rejects(
        f.a.call("send", {
          ...request,
          operationId: randomUUID(),
          content: {
            ...content,
            members: [f.alice, createIdentity("Wrong card").public],
          },
        }),
        /cartões/,
      );
      const changed = await f.command(f.a, {
        action: "commit",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: f.epoch,
        title: "Changed title",
        members: f.snapshot.members,
        joins: [],
      });
      assert.equal((await f.a.call("send", request)).id, original.id);
      await assert.rejects(
        f.a.call("send", { ...request, operationId: randomUUID() }),
        /grupo mudou/,
      );
      const fresh = await f.a.call("send", {
        ...request,
        operationId: randomUUID(),
        content: { ...content, groupEpoch: changed.group.head.id },
      });
      assert.notEqual(fresh.id, original.id);
      await f.command(f.a, {
        action: "close",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: changed.group.head.id,
      });
      const stopped = await f.a.call("send", request);
      assert.equal(stopped.id, original.id);
      assert.equal(stopped.outbox.status, "superseded");
      assert.equal(stopped.outbox.attempts, 0);
      assert.equal(
        (await f.a.call("outbox-retry", { operationId: request.operationId }))
          .id,
        original.id,
      );
      assert.equal((await f.a.call("state")).storage.reserved, 0);
    } finally {
      await f.close();
    }
  },
);
