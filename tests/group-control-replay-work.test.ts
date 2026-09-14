import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { LoomNode } from "../apps/node/src/node.js";
import { createBundle } from "../packages/core/src/index.js";
import { closeAnchoredGroup } from "../packages/groups/src/certificates.js";
import { password } from "./helpers.js";
import { fixture, enroll } from "./fixtures/group-access.js";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import {
  alreadyAppliedSnapshot,
  openGroupControl,
  snapshotCarrier,
} from "../packages/groups/src/carriers.js";

test("proof no-op optimisation still checks recipient scope, snapshot bytes and local participation", (t) => {
  const f = fixture(t),
    a = f.actor("Fast-path owner"),
    b = f.actor("Fast-path member"),
    c = f.actor("Outside");
  const id = a.registry.create(randomUUID(), "Verified scope").groupId;
  enroll(a, b, id);
  const head = a.registry.state(id).head!,
    snapshot = a.registry.privateState(id, head.id)!;
  const bundle = a.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, a.identity, (g) =>
      snapshotCarrier(g, a.identity, head, snapshot),
    ),
  ).value;
  const payload = openGroupControl(bundle, b.identity);
  assert.equal(payload.action, "snapshot");
  if (payload.action !== "snapshot") throw new Error("fixture kind");
  const check = (candidate: typeof bundle) =>
    b.store.transaction((tx) =>
      GroupRegistry.inTransaction(tx, b.identity, (g) => {
        const value = openGroupControl(candidate, b.identity);
        if (value.action !== "snapshot") throw new Error("fixture kind");
        return alreadyAppliedSnapshot(g, candidate, value);
      }),
    ).value;
  assert.ok(check(bundle));
  const widened = createBundle(
    a.identity,
    "group-control",
    payload,
    [...snapshot.members, c.identity.public],
    3600000,
  );
  assert.equal(check(widened), null, "same proof ID bypassed the reader check");
  const forged = createBundle(
    a.identity,
    "group-control",
    { ...payload, snapshot: { ...snapshot, title: "Not committed" } },
    snapshot.members,
    3600000,
  );
  assert.equal(check(forged), null, "same header bypassed snapshot commitment");
  b.registry.leave(randomUUID(), id);
  assert.equal(
    check(bundle),
    null,
    "local departure was treated as current participation",
  );
});

test(
  "verified cached proof replay avoids authority reapplication but still adopts a new safety header before a bad snapshot",
  { timeout: 45000 },
  async (t) => {
    mkdirSync(".cache/group-carriers", { recursive: true });
    const dir = mkdtempSync(resolve(".cache/group-carriers/replay-work-"));
    const node = new LoomNode(dir);
    clearInterval((node as any).syncTimer);
    try {
      node.setup("Replay work", password);
      let group = (
        node.groupCommand({
          action: "create",
          operationId: randomUUID(),
          title: "Epoch 0",
        }) as any
      ).group;
      for (let i = 1; i <= 10; i++)
        group = (
          node.groupCommand({
            action: "commit",
            operationId: randomUUID(),
            groupId: group.id,
            expected: group.head.id,
            title: `Epoch ${i}`,
            members: [node.identity!.public],
            joins: [],
          }) as any
        ).group;
      const count = node.store
        .list()
        .filter((m) => m.kind === "group-control").length;
      assert.equal(count, 11);
      const identity = node.identity!;
      const anchor = (
        node.groupCommand({
          action: "proofs",
          groupId: group.id,
          from: 0,
        }) as any
      ).anchor;
      const original = node.groupCommand.bind(node);
      let applications = 0;
      t.mock.method(
        node,
        "groupCommand",
        (command: Parameters<typeof original>[0]) => {
          if (command.action === "headers" || command.action === "snapshot")
            applications++;
          return original(command);
        },
      );
      node.lock();
      const before = performance.now();
      node.unlock(password);
      t.diagnostic(
        JSON.stringify({
          replayed: count,
          applications,
          unlockMs: performance.now() - before,
        }),
      );
      assert.equal(
        applications,
        0,
        "already incorporated authority was needlessly applied again",
      );
      const closed = closeAnchoredGroup(identity, anchor, group.head);
      const fence = createBundle(
        identity,
        "group-control",
        {
          type: "group-control",
          version: 1,
          action: "snapshot",
          groupId: group.id,
          epoch: closed,
          snapshot: { invalid: "tail must not suppress closure" },
        },
        [identity.public],
        3600000,
      );
      node.store.put(fence);
      (node as any).groupSync.receive(fence);
      assert.ok(
        applications > 0,
        "new safety authority was skipped with duplicate work",
      );
      assert.equal(
        (node.groupCommand({ action: "state", groupId: group.id }) as any).group
          .status,
        "closed",
      );
    } finally {
      await node.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
