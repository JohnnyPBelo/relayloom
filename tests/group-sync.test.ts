import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { messagingPair } from "./fixtures/group-send.js";
import { launch, password, until } from "./helpers.js";

test(
  "real Node peers synchronise epoch snapshots and closure without HTTP proof transfer after setup",
  { timeout: 45000 },
  async () => {
    const f = await messagingPair();
    try {
      await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
      const committed = await f.command(f.a, {
        action: "commit",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: f.epoch,
        title: "Automatically verified new epoch",
        members: [f.alice, f.bob],
        joins: [],
      });
      const epoch = committed.group.head;
      const synced = await until(
        () => f.command(f.b, { action: "state", groupId: f.groupId }),
        (s) => s.group.head?.id === epoch.id && s.group.status === "active",
        25000,
      );
      assert.equal(synced.group.title, "Automatically verified new epoch");
      const sent = await f.a.call("send", {
        operationId: randomUUID(),
        content: {
          type: "message",
          text: "After automatic group proof sync",
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
      assert.equal(
        (await f.b.call("state")).objects.some(
          (o: any) => o.kind === "group-control",
        ),
        false,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "remembered invitation fetches paginated public ancestry automatically but no pre-join private snapshot",
  { timeout: 60000 },
  async () => {
    const a = await launch(),
      b = await launch();
    const command = (c: typeof a, body: unknown) =>
      c.call("group-command", body);
    try {
      const alice = await a.call("setup", {
        name: "Creator of long history",
        password,
      });
      const bob = await b.call("setup", {
        name: "New consenting reader",
        password,
      });
      let group = (
        await command(a, {
          action: "create",
          operationId: randomUUID(),
          title: "Private history",
        })
      ).group;
      const id = group.id;
      for (let i = 0; i < 18; i++)
        group = (
          await command(a, {
            action: "commit",
            operationId: randomUUID(),
            groupId: id,
            expected: group.head.id,
            title: `Private epoch ${i}`,
            members: [alice],
            joins: [],
          })
        ).group;
      const anchor = (
        await command(a, { action: "proofs", groupId: id, from: 0 })
      ).anchor;
      const invitation = (
        await command(a, {
          action: "invite",
          operationId: randomUUID(),
          groupId: id,
          expected: group.head.id,
          card: bob,
        })
      ).operation.certificate;
      await command(b, {
        action: "remember",
        operationId: randomUUID(),
        anchor,
        parent: group.head,
        invitation,
      });
      assert.equal(
        (await command(b, { action: "state", groupId: id })).group.head,
        null,
      );
      await b.call("connect", { host: "127.0.0.1", port: a.tcpPort });
      await until(
        () => command(b, { action: "state", groupId: id }),
        (s) => s.group.head?.id === group.head.id,
        30000,
      );
      assert.equal(
        (
          await command(b, {
            action: "private-state",
            groupId: id,
            epochId: group.head.id,
          })
        ).snapshot,
        null,
      );
      const consent = (
        await command(b, {
          action: "accept",
          operationId: randomUUID(),
          groupId: id,
          expected: group.head.id,
        })
      ).operation.certificate;
      // Consent transport is the following phase; only that certificate is
      // supplied here. Headers and snapshots now cross actual transport workers.
      group = (
        await command(a, {
          action: "commit",
          operationId: randomUUID(),
          groupId: id,
          expected: group.head.id,
          title: "Joined by explicit consent",
          members: [alice, bob],
          joins: [consent],
        })
      ).group;
      const joined = await until(
        () => command(b, { action: "state", groupId: id }),
        (s) =>
          s.group.head?.id === group.head.id && s.group.status === "active",
        20000,
      );
      assert.equal(joined.group.title, "Joined by explicit consent");
      assert.equal((await b.call("state")).contacts.length, 0);
    } finally {
      await a.stop();
      await b.stop();
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  },
);
