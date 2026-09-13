import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBundle } from "../packages/core/src/index.js";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import { LoomNode } from "../apps/node/src/node.js";
import { password } from "./helpers.js";

test(
  "an unchanged group snapshot walks its authority chain once, and a later closure still invalidates new admission",
  { timeout: 45000 },
  async (t) => {
    mkdirSync(".cache", { recursive: true });
    const dir = mkdtempSync(
        join(process.cwd(), ".cache/group-observation-work-"),
      ),
      node = new LoomNode(dir);
    clearInterval((node as any).syncTimer);
    t.after(async () => {
      await node.stop();
      rmSync(dir, { recursive: true, force: true });
    });
    node.setup("History", password);
    let group = (
      node.groupCommand({
        action: "create",
        operationId: randomUUID(),
        title: "Version 0",
      }) as any
    ).group;
    for (let i = 1; i < 32; i++)
      group = (
        node.groupCommand({
          action: "commit",
          operationId: randomUUID(),
          groupId: group.id,
          expected: group.head.id,
          title: "Version " + i,
          members: [node.identity!.public],
          joins: [],
        }) as any
      ).group;
    const snapshot = (
      node.groupCommand({
        action: "private-state",
        groupId: group.id,
        epochId: group.head.id,
      }) as any
    ).snapshot;
    const make = (text: string) =>
      createBundle(
        node.identity!,
        "message",
        {
          type: "message",
          text,
          conversation: group.id,
          groupAudience: "epoch",
          groupEpoch: group.head.id,
          members: snapshot.members,
        },
        snapshot.members,
        60000,
      );
    for (let i = 0; i < 32; i++) node.store.put(make("Message " + i));
    assert.equal(node.objects().length, 32);
    const original = GroupRegistry.prototype.proofs;
    let visited = 0;
    t.mock.method(
      GroupRegistry.prototype,
      "proofs",
      function (
        this: GroupRegistry,
        groupId: string,
        from: number,
        count?: number,
      ) {
        const page = original.call(this, groupId, from, count);
        visited += page.length;
        return page;
      },
    );
    const started = performance.now();
    assert.equal(node.objects().length, 32);
    t.diagnostic(
      JSON.stringify({
        retainedObjects: 32,
        epochs: 32,
        visitedHeaders: visited,
        elapsedMs: performance.now() - started,
      }),
    );
    assert.ok(
      visited <= 32,
      "unchanged polling repeated the full authority chain for every retained object: " +
        visited,
    );
    node.groupCommand({
      action: "close",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
    });
    const late = make("Unseen at closure");
    node.store.put(late);
    const after = node.objects();
    assert.equal(after.length, 32);
    assert.equal(
      after.some((o) => o.id === late.manifest.id),
      false,
      "cached authority bypassed the new closure",
    );
  },
);
