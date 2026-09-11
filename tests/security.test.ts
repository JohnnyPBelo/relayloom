import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LoomNode } from "../apps/node/src/node.js";
import { serve } from "../apps/node/src/server.js";
import {
  createIdentity,
  createBundle,
  hash,
} from "../packages/core/src/index.js";
import { request } from "node:http";
const password = "long regression password";
function local() {
  mkdirSync(".cache", { recursive: true });
  return new LoomNode(mkdtempSync(join(process.cwd(), ".cache/security-")));
}

test("inbound semantic ACL: forged public receipt/message and private wrong-reader mutation are hidden", async () => {
  const node = local();
  try {
    const alice = node.setup("Alice", password),
      bob = createIdentity("Bob"),
      eve = createIdentity("Unprivileged seeder");
    node.addContact(bob.public);
    const message = node.publish({ type: "message", text: "private" }, [
      bob.public.id,
    ]);
    const fakeReceipt = createBundle(
      eve,
      "receipt",
      { type: "receipt", target: message.id },
      "public",
    );
    const publicMessage = createBundle(
      bob,
      "message",
      {
        type: "message",
        text: "public but claims private",
        members: [alice, bob.public],
        conversation: "dm:" + hash([alice.id, bob.public.id].sort().join(":")),
      },
      "public",
    );
    const wrongReaders = createBundle(
      bob,
      "reaction",
      { type: "reaction", target: message.id, emoji: "heart", value: true },
      [alice, eve.public],
    );
    const forgedEdit = createBundle(
      bob,
      "edit",
      { type: "edit", target: message.id, text: "I am the owner" },
      [alice],
    );
    const badGroup = createBundle(
      bob,
      "group",
      {
        type: "group",
        title: "Fake members",
        members: [alice, bob.public, eve.public],
      },
      [alice],
    );
    for (const b of [
      fakeReceipt,
      publicMessage,
      wrongReaders,
      forgedEdit,
      badGroup,
    ])
      node.store.put(b);
    const ids = node.objects().map((o) => o.id);
    for (const b of [
      fakeReceipt,
      publicMessage,
      wrongReaders,
      forgedEdit,
      badGroup,
    ]) {
      assert.ok(!ids.includes(b.manifest.id));
      assert.throws(() => node.view(b.manifest.id));
    }
    const receipt = createBundle(
      bob,
      "receipt",
      { type: "receipt", target: message.id },
      [alice],
    );
    node.store.put(receipt);
    const valid = node.objects();
    assert.ok(valid.some((o) => o.id === message.id));
    assert.ok(valid.some((o) => o.id === receipt.manifest.id));
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});
test("malformed unauthenticated HTTP paths return 400; service survives and auth boundary holds", async () => {
  const node = local(),
    server = await serve(node);
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(server.url + "/%", (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 400);
    const res = await fetch(server.url + "/api/state", {
      headers: { Authorization: "Bearer " + server.token },
    });
    assert.equal(res.status, 200);
    const rebinding = await new Promise<number>((resolve, reject) => {
      const req = request(
        server.url + "/api/state",
        {
          headers: {
            Authorization: "Bearer " + server.token,
            Host: "evil.example",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(rebinding, 403);
  } finally {
    await server.close();
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("private site draft and local deletion survive cache removal/restart without plaintext on disk", async () => {
  const { readFileSync } = await import("node:fs");
  const node = local();
  let restored: LoomNode | undefined;
  try {
    node.setup("Alice", password);
    node.saveDraft(
      [
        {
          id: "hero",
          type: "hero",
          title: "Unpublished private idea",
          body: "Only on this device",
        },
      ],
      "forest",
    );
    const post = node.publish(
      { type: "post", text: "Owner publication" },
      "public",
    );
    node.store.pin(post.id, true);
    const deletion = node.publish(
      { type: "delete", target: post.id },
      "public",
    );
    node.store.remove(deletion.id); // Explicit cache-loss fault: authenticated local decision must survive.
    assert.ok(node.objects().find((o) => o.id === post.id)?.deleted);
    assert.ok(
      !readFileSync(join(node.dir, "private-state.json"), "utf8").includes(
        "Unpublished private idea",
      ),
    );
    await node.stop();
    restored = new LoomNode(node.dir);
    restored.unlock(password);
    assert.ok(restored.objects().find((o) => o.id === post.id)?.deleted);
    assert.equal(
      restored.state().siteDraft!.blocks[0] &&
        (restored.state().siteDraft!.blocks[0] as any).title,
      "Unpublished private idea",
    );
    const file = join(node.dir, "private-state.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.data = "AAAA";
    (await import("node:fs")).writeFileSync(file, JSON.stringify(json));
    restored.lock();
    assert.throws(() => restored!.unlock(password));
    assert.equal(restored.identity, undefined);
  } finally {
    await node.stop();
    if (restored) await restored.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("relay consent: no application-level cached serving while paused, positive control after enabling", async () => {
  const { Router } = await import("../packages/transport/src/index.js");
  const { until } = await import("./helpers.js");
  const { setTimeout: delay } = await import("node:timers/promises");
  const node = local(),
    peer = new Router();
  try {
    node.setup("Relay B", password);
    await node.start();
    const author = createIdentity("Offline author A");
    const bundle = createBundle(
      author,
      "post",
      { type: "post", text: "seeded exact original" },
      "public",
    );
    node.store.put(bundle);
    node.settings({ relay: false });
    peer.connectTcp("127.0.0.1", node.tcpPort);
    await until(
      async () => peer.peers,
      (p) => p.length === 1,
    );
    const received: any[] = [];
    peer.on("payload", (p) => {
      if (p.type === "bundle") received.push(p);
    });
    peer.broadcast({ type: "request", ids: [bundle.manifest.id] });
    await delay(600);
    assert.equal(received.length, 0);
    node.settings({ relay: true });
    peer.broadcast({ type: "request", ids: [bundle.manifest.id] });
    await until(
      async () => received,
      (p) => p.length === 1,
    );
    assert.equal(received[0].bundle.manifest.author.id, author.public.id);
  } finally {
    await peer.stop();
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("deletion journal survives when publication itself evicts its unpinned original", async () => {
  const node = local();
  try {
    node.setup("Alice", password);
    const post = node.publish(
        { type: "post", text: "content ".repeat(600) },
        "public",
      ),
      original = node.store.get(post.id);
    node.store.quota = node.store.stats().bytes;
    node.publish({ type: "delete", target: post.id }, "public");
    assert.equal(node.store.has(post.id), false);
    node.store.put(original); // Re-seeding the older original must not resurrect it.
    assert.equal(node.objects().find((o) => o.id === post.id)?.deleted, true);
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});
