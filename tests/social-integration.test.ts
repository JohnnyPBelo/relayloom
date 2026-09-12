import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launch, until, password } from "./helpers.js";

test(
  "collections and following integrate with encrypted persistence and hashed peer retrieval respects read ACL",
  { timeout: 35000 },
  async () => {
    const a = await launch(),
      b = await launch(),
      c = await launch();
    let restored;
    try {
      const alice = await a.call("setup", { name: "Alice", password }),
        bob = await b.call("setup", { name: "Bob", password });
      await c.call("setup", { name: "Carol", password });
      await a.call("contact", { contact: bob });
      await b.call("contact", { contact: alice });
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await until(
        () => b.call("state"),
        (s) => s.peers.length === 2,
      );
      const post = await a.call("publish", {
        content: { type: "post", text: "Shared author-owned content" },
        recipients: "public",
      });
      const privateMessage = await a.call("publish", {
        content: { type: "message", text: "Only Bob can read" },
        recipients: [bob.id],
      });
      await until(
        () => b.call("state"),
        (s) => s.objects.some((o: any) => o.id === post.id),
      );
      const id = randomUUID();
      await b.call("collection", {
        action: "create",
        id,
        title: "Private collection title",
      });
      await b.call("collection", { action: "add", id, objectId: post.id });
      await b.call("action", {
        action: "follow",
        target: alice.id,
        value: true,
      });
      let state = await b.call("state");
      assert.deepEqual(state.collections[0].objectIds, [post.id]);
      assert.ok(state.followedPostIds.includes(post.id));
      await b.call("collection", {
        action: "rename",
        id,
        title: "Updated private title",
      });
      assert.ok(
        !readFileSync(join(b.dir, "profile-state.sqlite"), "utf8").includes(
          "Updated private title",
        ),
      );
      await until(
        () => c.call("state"),
        (s) => s.storage.count >= 2,
      );
      assert.equal(
        (await c.call("retrieve", { id: privateMessage.id })).status,
        "unreadable",
      );
      assert.equal(
        (await c.call("retrieve", { id: post.id })).status,
        "available",
      );
      await assert.rejects(
        () => c.call("retrieve", { id: "../secret" }),
        /Endereço/,
      );
      await assert.rejects(
        () =>
          c.call("collection", {
            action: "add",
            id: randomUUID(),
            objectId: privateMessage.id,
          }),
        /autorizado/,
      );
      await b.stop();
      restored = await launch(b.dir);
      await restored.call("unlock", { password });
      state = await restored.call("state");
      assert.equal(state.collections[0].title, "Updated private title");
      assert.ok(state.followedPostIds.includes(post.id));
      await restored.call("collection", {
        action: "remove",
        id,
        objectId: post.id,
      });
      assert.deepEqual(
        (await restored.call("state")).collections[0].objectIds,
        [],
      );
      await restored.call("collection", { action: "delete", id });
      assert.deepEqual((await restored.call("state")).collections, []);
    } finally {
      const results = await Promise.allSettled([
        a.stop(),
        b.stop(),
        c.stop(),
        ...(restored ? [restored.stop()] : []),
      ]);
      for (const r of results) if (r.status === "rejected") throw r.reason;
      for (const n of [a, b, c])
        rmSync(n.dir, { recursive: true, force: true });
    }
  },
);
