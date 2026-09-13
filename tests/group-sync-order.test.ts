import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBundle, importVault } from "../packages/core/src/index.js";
import { Router } from "../packages/transport/src/index.js";
import { messagingPair } from "./fixtures/group-send.js";
import { password, until } from "./helpers.js";

test(
  "real wire delivers newest snapshot before missing predecessors and projects the verified newest title",
  { timeout: 45000 },
  async () => {
    const f = await messagingPair();
    const wire = new Router({ relay: false });
    try {
      const identity = importVault(
        (await f.a.call("export", { password })).vault,
        password,
      );
      const entries: { head: any; snapshot: any }[] = [];
      let expected = f.epoch;
      for (let i = 0; i < 3; i++) {
        const changed = await f.command(f.a, {
          action: "commit",
          operationId: randomUUID(),
          groupId: f.groupId,
          expected,
          title: `Verified title ${i}`,
          members: [f.alice, f.bob],
          joins: [],
        });
        expected = changed.group.head.id;
        entries.push({
          head: changed.group.head,
          snapshot: (
            await f.command(f.a, {
              action: "private-state",
              groupId: f.groupId,
              epochId: expected,
            })
          ).snapshot,
        });
      }
      wire.connectTcp("127.0.0.1", f.b.tcpPort);
      await until(
        async () => wire.peers,
        (peers) => peers.some((p) => p.connected),
      );
      // Certificates came from production APIs. The fixture only controls network
      // order; no target registry or private snapshot is installed by HTTP.
      wire.broadcast({
        type: "bundle",
        bundle: createBundle(
          identity,
          "group-control",
          {
            type: "group-control",
            version: 1,
            action: "headers",
            groupId: f.groupId,
            to: f.bob.id,
            from: entries[0].head.body.number,
            headers: entries.map((e) => e.head),
            head: entries[2].head,
          },
          [f.bob],
          3600000,
        ),
      });
      await until(
        () => f.command(f.b, { action: "state", groupId: f.groupId }),
        (s) => s.group.head?.id === expected,
      );
      const send = (entry: (typeof entries)[number]) =>
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
              epoch: entry.head,
              snapshot: entry.snapshot,
            },
            [f.alice, f.bob],
            3600000,
          ),
        });
      send(entries[2]);
      await until(
        () =>
          f.command(f.b, {
            action: "private-state",
            groupId: f.groupId,
            epochId: expected,
          }),
        (s) => s.snapshot !== null,
      );
      assert.equal(
        (await f.command(f.b, { action: "state", groupId: f.groupId })).group
          .status,
        "awaiting-snapshot",
      );
      for (const entry of entries.slice(0, 2)) {
        send(entry);
        await until(
          () =>
            f.command(f.b, {
              action: "private-state",
              groupId: f.groupId,
              epochId: entry.head.id,
            }),
          (s) => s.snapshot !== null,
        );
      }
      const state = await until(
        () => f.command(f.b, { action: "state", groupId: f.groupId }),
        (s) => s.group.status === "active",
      );
      assert.equal(state.group.title, "Verified title 2");
    } finally {
      await wire.stop();
      await f.close();
    }
  },
);
