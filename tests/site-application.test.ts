import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { launch, password, until as poll, type Client } from "./helpers";
import { siteAddress } from "../packages/sites/src/protocol";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import {
  createBundle,
  createIdentity,
  verifyBundle,
} from "../packages/core/src/index";
import { Router } from "../packages/transport/src/index";
const until = (fn: () => boolean | Promise<boolean>) =>
  poll(
    async () => fn(),
    (value) => value === true,
  );
const payload = (title: string) => ({
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title,
    description: "Published through the real API",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [
      {
        id: "home",
        slug: "inicio",
        title: "Início",
        blocks: [{ id: "text", type: "text", title: "Content", body: title }],
      },
    ],
  },
});
async function publish(
  node: Client,
  ownerId: string,
  title: string,
  recipients: unknown = "public",
) {
  const state = await node.call("site-command", {
    action: "state",
    address: siteAddress(ownerId, "profile"),
  });
  const request = {
    action: "publish",
    name: "profile",
    sequence: state.nextSequence,
    operationId: randomUUID(),
    expectedBase: state.base,
    payload: payload(title),
    recipients,
    ttlMs: 86400_000,
  };
  return { request, result: await node.call("site-command", request) };
}
async function resolve(node: Client, address: string, revisionId?: string) {
  return node.call("site-command", {
    action: "resolve",
    address,
    ...(revisionId ? { revisionId } : {}),
  });
}
async function cleanup(nodes: Client[]) {
  for (const node of nodes) {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
}

test("real application APIs preserve revision identity, resolve updates and serve a new reader after the author exits", async () => {
  const nodes: Client[] = [];
  try {
    const a = await launch(undefined, 0, 0, "node");
    nodes.push(a);
    const b = await launch(undefined, 0, 0, "node");
    nodes.push(b);
    const author = await a.call("setup", {
      name: "Site application author",
      password,
    });
    await b.call("setup", { name: "Site application seeder", password });
    const address = siteAddress(author.id, "profile");
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const one = await publish(a, author.id, "Version one");
    assert.equal(one.result.operation.phase, "ready");
    const replay = await a.call("site-command", one.request);
    assert.equal(replay.operation.bundleId, one.result.operation.bundleId);
    await until(async () => (await resolve(b, address)).status === "available");
    const first = await resolve(b, address);
    assert.equal(first.object.content.site.title, "Version one");
    assert.equal(first.object.author.id, author.id);
    assert.equal(first.state.number, 1);
    const two = await publish(a, author.id, "Version two");
    assert.equal(two.result.operation.sequence, 2);
    await until(async () => (await resolve(b, address)).state.number === 2);
    const current = await resolve(b, address);
    assert.equal(current.object.content.site.title, "Version two");
    assert.equal(
      (await resolve(b, address, first.revisionId)).object.content.site.title,
      "Version one",
    );
    await assert.rejects(() =>
      a.call("site-command", { ...one.request, operationId: randomUUID() }),
    );
    // An outage can end a process by signal, which intentionally leaves
    // exitCode null. Await the actual exit, then retain the TCP refusal control.
    const exited = new Promise<void>((done, fail) => {
      const timeout = setTimeout(
        () => fail(new Error("Owned publisher did not exit")),
        8000,
      );
      a.process.once("exit", () => {
        clearTimeout(timeout);
        done();
      });
    });
    void exited.catch(() => {});
    assert.equal(a.process.kill("SIGKILL"), true);
    await exited;
    await a.stop();
    assert.ok(a.process.exitCode !== null || a.process.signalCode !== null);
    const reachable = await new Promise<boolean>((done) => {
      const socket = createConnection({ host: "127.0.0.1", port: a.tcpPort });
      socket.on("connect", () => {
        socket.destroy();
        done(true);
      });
      socket.on("error", () => done(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        done(false);
      });
    });
    assert.equal(reachable, false, "author is actually unavailable");
    const c = await launch(undefined, 0, 0, "node");
    nodes.push(c);
    await c.call("setup", { name: "New site reader", password });
    assert.equal((await resolve(c, address)).status, "pending");
    await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(
      async () =>
        (await resolve(c, address)).state.number === 2 &&
        (await resolve(c, address)).status === "available",
    );
    const seeded = await resolve(c, address);
    assert.equal(seeded.object.author.id, author.id);
    assert.equal(seeded.object.content.site.title, "Version two");
    assert.equal(seeded.object.id, two.result.operation.bundleId);
  } finally {
    await cleanup(nodes);
  }
});

test("private site APIs preserve reading scope and generic publication cannot bypass version authority", async () => {
  const nodes: Client[] = [];
  try {
    const a = await launch(undefined, 0, 0, "node");
    nodes.push(a);
    const b = await launch(undefined, 0, 0, "node");
    nodes.push(b);
    const c = await launch(undefined, 0, 0, "node");
    nodes.push(c);
    const author = await a.call("setup", {
        name: "Private site author",
        password,
      }),
      reader = await b.call("setup", { name: "Private site reader", password });
    await c.call("setup", { name: "Opaque site relay", password });
    await a.call("contact", { contact: reader });
    await a.call("connect", { host: "127.0.0.1", port: c.tcpPort });
    await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const address = siteAddress(author.id, "profile"),
      sent = await publish(a, author.id, "Private page", [reader.id]);
    assert.equal(sent.result.operation.phase, "ready");
    await until(async () => (await resolve(b, address)).status === "available");
    const opened = await resolve(b, address);
    assert.equal(opened.object.public, false);
    assert.equal(opened.object.content.site.title, "Private page");
    assert.equal((await resolve(c, address)).status, "pending");
    await assert.rejects(() =>
      b.call("publish", {
        content: opened.object.content,
        recipients: "public",
      }),
    );
    await a.call("lock", {});
    await assert.rejects(() => a.call("site-command", sent.request));
    await a.call("unlock", { password });
    assert.equal(
      (await a.call("site-command", sent.request)).operation.bundleId,
      sent.result.operation.bundleId,
    );
  } finally {
    await cleanup(nodes);
  }
});

test("a valid outer signature cannot smuggle another owner snapshot into application storage through TCP", async () => {
  const nodes: Client[] = [],
    wire = new Router({ relay: false });
  try {
    const target = await launch(undefined, 0, 0, "node");
    nodes.push(target);
    await target.call("setup", { name: "Snapshot verifier", password });
    const owner = createIdentity("Original owner"),
      attacker = createIdentity("Other signer"),
      snapshots = createSiteContentProtocol(nodeCertificateCrypto);
    wire.connectTcp("127.0.0.1", target.tcpPort);
    await until(() => wire.peers.some((p) => p.connected));
    const validContent = snapshots.create(
      owner,
      "profile",
      1,
      [],
      payload("Valid control"),
    );
    const good = createBundle(owner, "site", validContent, "public");
    wire.broadcast({ type: "bundle", bundle: good });
    const address = siteAddress(owner.public.id, "profile");
    await until(
      async () => (await resolve(target, address)).status === "available",
    );
    const before = (await target.call("state")).counters.rejected;
    const forged = createBundle(
      attacker,
      "site",
      snapshots.create(
        owner,
        "profile",
        2,
        [validContent.siteRevision.id],
        payload("Forged head"),
      ),
      "public",
    );
    verifyBundle(forged);
    wire.broadcast({ type: "bundle", bundle: forged });
    await until(
      async () => (await target.call("state")).counters.rejected > before,
    );
    assert.equal((await resolve(target, address)).state.number, 1);
    assert.equal(
      (await target.call("state")).objects.some(
        (o: any) => o.id === forged.manifest.id,
      ),
      false,
    );
  } finally {
    try {
      await wire.stop();
    } finally {
      await cleanup(nodes);
    }
  }
});

test("two installations with the same owner preserve a fork until the owner explicitly confirms all known heads", async () => {
  const nodes: Client[] = [];
  try {
    const a = await launch(undefined, 0, 0, "node");
    nodes.push(a);
    const b = await launch(undefined, 0, 0, "node");
    nodes.push(b);
    const owner = await a.call("setup", {
      name: "Two-device site owner",
      password,
    });
    const vault = await a.call("export", { password });
    const restored = await b.call("setup", {
      name: "Unused restore label",
      password,
      recovery: vault.vault,
    });
    assert.equal(restored.id, owner.id);
    const address = siteAddress(owner.id, "profile");
    await publish(a, owner.id, "Device one");
    await publish(b, owner.id, "Device two");
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(async () => (await resolve(a, address)).status === "conflict");
    const state = await a.call("site-command", { action: "state", address });
    assert.equal(state.heads.length, 2);
    const request = {
      action: "publish",
      name: "profile",
      sequence: state.nextSequence,
      operationId: randomUUID(),
      expectedBase: state.base,
      payload: payload("Explicit combined choice"),
      recipients: "public",
      ttlMs: 86400_000,
    };
    await assert.rejects(() => a.call("site-command", request), /concorrentes/);
    assert.equal((await resolve(a, address)).status, "conflict");
    const published = await a.call("site-command", {
      ...request,
      confirmedHeads: state.heads.map((h: any) => h.id).sort(),
    });
    assert.equal(published.operation.phase, "ready");
    await until(async () => (await resolve(b, address)).state.number === 2);
    const result = await resolve(b, address);
    assert.equal(result.status, "available");
    assert.equal(result.object.content.site.title, "Explicit combined choice");
  } finally {
    await cleanup(nodes);
  }
});
