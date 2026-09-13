import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { messagingPair } from "../fixtures/group-send.js";
import { until } from "../helpers.js";

for (const [creator, reader] of [
  ["native", "node"],
  ["node", "native"],
  ["native", "native"],
] as const)
  test(
    `real ${creator}/${reader} synchronises group changes and closure over encrypted transport`,
    { timeout: 45000 },
    async () => {
      const f = await messagingPair(creator, reader);
      try {
        await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
        const changed = await f.command(f.a, {
          action: "commit",
          operationId: randomUUID(),
          groupId: f.groupId,
          expected: f.epoch,
          title: "Automatically synchronised mixed group",
          members: [f.alice, f.bob],
          joins: [],
        });
        const epoch = changed.group.head;
        await until(
          () => f.command(f.b, { action: "state", groupId: f.groupId }),
          (s) => s.group.head?.id === epoch.id && s.group.status === "active",
          25000,
        );
        const sent = await f.a.call("send", {
          operationId: randomUUID(),
          content: {
            type: "message",
            text: "With automatically acquired group proofs",
            conversation: f.groupId,
            groupEpoch: epoch.id,
            groupAudience: "epoch",
          },
          recipients: [f.bob.id],
        });
        await until(
          () => f.b.call("state"),
          (s) => s.objects.some((o: any) => o.id === sent.id),
        );
        const closed = await f.command(f.a, {
          action: "close",
          operationId: randomUUID(),
          groupId: f.groupId,
          expected: epoch.id,
        });
        await until(
          () => f.command(f.b, { action: "state", groupId: f.groupId }),
          (s) =>
            s.group.status === "closed" &&
            s.group.head.id === closed.group.head.id,
          20000,
        );
        assert.equal((await f.b.call("state")).contacts.length, 0);
      } finally {
        await f.close();
      }
    },
  );
