import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createBundle, importVault } from "../packages/core/src/index.js";
import { Router } from "../packages/transport/src/index.js";
import { messagingPair } from "./fixtures/group-send.js";
import { password, until } from "./helpers.js";

test(
  "available encrypted controls replay before a locked member can retry or sign after removal",
  { timeout: 60000 },
  async () => {
    const f = await messagingPair(),
      wire = new Router({ relay: false }),
      observed: any[] = [];
    wire.on("payload", (p) => observed.push(p));
    try {
      const identity = importVault(
        (await f.a.call("export", { password })).vault,
        password,
      );
      const head = (
        await f.command(f.a, { action: "state", groupId: f.groupId })
      ).group.head;
      const pending = await f.b.call("send", {
        operationId: randomUUID(),
        content: {
          type: "message",
          text: "Never leave after the received fence",
          conversation: f.groupId,
          groupEpoch: f.epoch,
          groupAudience: "epoch",
        },
        recipients: [f.alice.id],
      });
      assert.equal(pending.outbox.status, "pending");
      await f.b.call("lock", {});
      wire.connectTcp("127.0.0.1", f.b.tcpPort);
      await until(
        async () => wire.peers,
        (p) => p.some((v) => v.connected),
      );
      // Fill more than one replay slice with valid old carriers. Certificates and
      // snapshot are real; only envelope multiplicity/order are controlled here.
      for (let i = 0; i < 18; i++)
        wire.broadcast({
          type: "bundle",
          bundle: createBundle(
            identity,
            "group-control",
            {
              type: "group-control",
              version: 1,
              action: "snapshot",
              groupId: f.groupId,
              epoch: head,
              snapshot: f.snapshot,
            },
            [f.alice, f.bob],
            3600000,
          ),
        });
      const closed = await f.command(f.a, {
        action: "commit",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: f.epoch,
        title: "Member removed during lock",
        members: [f.alice],
        joins: [],
      });
      const fence = createBundle(
        identity,
        "group-control",
        {
          type: "group-control",
          version: 1,
          action: "headers",
          groupId: f.groupId,
          to: f.bob.id,
          from: closed.group.head.body.number,
          headers: [closed.group.head],
          head: closed.group.head,
        },
        [f.bob],
        3600000,
      );
      wire.broadcast({ type: "bundle", bundle: fence });
      await until(
        () => f.b.call("state"),
        (s) => s.storage.count >= 20,
      );
      await f.b.call("unlock", { password });
      await assert.rejects(() =>
        f.b.call("send", {
          operationId: randomUUID(),
          content: {
            type: "message",
            text: "Fresh write cannot bypass replay",
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
            (o: any) => o.id === pending.id && o.status === "superseded",
          ),
      );
      assert.equal(
        state.outbox.find((o: any) => o.id === pending.id).attempts,
        0,
      );
      assert.equal(
        (await f.command(f.b, { action: "state", groupId: f.groupId })).group
          .status,
        "removed",
      );
      const witness = await f.b.call("publish", {
        content: { type: "post", text: "Public positive path after replay" },
        recipients: "public",
      });
      await until(
        async () => observed,
        (ps) => ps.some((p) => p.bundle?.manifest.id === witness.id),
      );
      await delay(250);
      assert.equal(
        observed.some((p) => p.bundle?.manifest.id === pending.id),
        false,
      );
    } finally {
      await wire.stop();
      await f.close();
    }
  },
);
