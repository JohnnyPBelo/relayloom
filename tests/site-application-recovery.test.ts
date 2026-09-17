import { projectTemp } from "./project-temp";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LoomNode } from "../apps/node/src/node";
import { serve } from "../apps/node/src/server";
import { Router } from "../packages/transport/src/index";
import { RegistryTransaction } from "../packages/groups/src/storage";
import { siteAddress } from "../packages/sites/src/protocol";
import { launch, password, until } from "./helpers";
import { launchOwned } from "./native/process-helper";
const payload = {
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "Recover exactly once",
    description: "Application publication",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [{ id: "home", slug: "inicio", title: "Início", blocks: [] }],
  },
};
function client(url: string, token: string) {
  return async (path: string, body: unknown) => {
    const response = await fetch(url + "/api/" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
  };
}

test("failed application profile commit cannot publish and a failed public copy remains recoverable", async () => {
  const directory = projectTemp("site-app-failure-"),
    node = new LoomNode(directory),
    wire = new Router({ relay: false });
  const seen: any[] = [];
  wire.on("payload", (payload) => seen.push(payload));
  await node.start();
  const server = await serve(node),
    call = client(server.url, server.token);
  try {
    const owner = await call("setup", {
      name: "Publication failure owner",
      password,
    });
    node.router.connectTcp("127.0.0.1", await wire.listen());
    await until(
      async () => node.router.peers,
      (p) => p.some((p) => p.connected),
    );
    node.router.broadcast({ witness: "connected" });
    await until(
      async () => seen,
      (p) => p.some((p) => p.witness === "connected"),
    );
    const state = await call("site-command", {
      action: "state",
      address: siteAddress(owner.id, "profile"),
    });
    const request = {
      action: "publish",
      name: "profile",
      sequence: state.nextSequence,
      operationId: randomUUID(),
      expectedBase: state.base,
      payload,
      recipients: "public",
      ttlMs: 3600000,
    };
    const put = RegistryTransaction.prototype.put;
    let hit = false;
    RegistryTransaction.prototype.put = function (key, bytes, storageClass) {
      if (key.startsWith("site:")) {
        hit = true;
        throw new Error("fixture site record write failed");
      }
      return put.call(this, key, bytes, storageClass);
    };
    try {
      await assert.rejects(() => call("site-command", request), /fixture/);
    } finally {
      RegistryTransaction.prototype.put = put;
    }
    assert.equal(hit, true);
    assert.equal(
      seen.some((p) => p.bundle?.manifest.kind === "site"),
      false,
    );
    const unchanged = await call("site-command", {
      action: "state",
      address: siteAddress(owner.id, "profile"),
    });
    assert.equal(unchanged.nextSequence, 1);
    const copy = node.store.put.bind(node.store);
    node.store.put = (bundle, pin) => {
      if (bundle.manifest.kind === "site")
        throw new Error("fixture public copy failed");
      return copy(bundle, pin);
    };
    const pending = await call("site-command", request);
    assert.equal(pending.operation.phase, "committed");
    assert.match(pending.error, /fixture/);
    assert.equal(
      seen.some((p) => p.bundle?.manifest.kind === "site"),
      false,
    );
    node.store.put = copy;
    const done = await call("site-command", {
      action: "resume",
      name: "profile",
      sequence: 1,
      operationId: request.operationId,
    });
    assert.equal(done.operation.phase, "ready");
    await until(
      async () => seen,
      (p) =>
        p.some((p) => p.bundle?.manifest.id === pending.operation.bundleId),
    );
    assert.equal(
      (await call("site-command", request)).operation.bundleId,
      pending.operation.bundleId,
    );
  } finally {
    await server.close();
    await node.stop();
    await wire.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the real application recovers its exact publication after process exit between authorization and public storage", async () => {
  const directory = projectTemp("site-app-crash-");
  const worker = launchOwned(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("tests/fixtures/site-application-worker.ts"),
      directory,
    ],
    { ipc: true, timeout: 20000 },
  );
  let info: any;
  worker.child.on("message", (value) => {
    if ((value as any).ready) info = value;
  });
  let resumed: Awaited<ReturnType<typeof launch>> | undefined,
    reader: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await worker.ready;
    assert.ok(info);
    const call = client(info.url, info.token);
    const owner = await call("setup", {
        name: "Interrupted application owner",
        password,
      }),
      address = siteAddress(owner.id, "profile");
    reader = await launch(undefined, 0, 0, "node");
    await reader.call("setup", { name: "Recovery reader", password });
    await call("connect", { host: "127.0.0.1", port: reader.tcpPort });
    const state = await call("site-command", { action: "state", address });
    const request = {
      action: "publish",
      name: "profile",
      sequence: 1,
      operationId: randomUUID(),
      expectedBase: state.base,
      payload,
      recipients: "public",
      ttlMs: 3600000,
    };
    await assert.rejects(() => call("site-command", request));
    const ended = await worker.done;
    assert.equal(ended.code, 81);
    assert.equal(ended.timedOut, false);
    const marker = JSON.parse(
      readFileSync(join(directory, "site-crash.json"), "utf8"),
    );
    assert.equal(
      (await reader.call("site-command", { action: "resolve", address }))
        .status,
      "pending",
    );
    resumed = await launch(directory, 0, 0, "node");
    await resumed.call("unlock", { password });
    await resumed.call("connect", { host: "127.0.0.1", port: reader.tcpPort });
    await until(
      () => reader!.call("site-command", { action: "resolve", address }),
      (value) => value.status === "available",
    );
    const result = await reader.call("site-command", {
      action: "resolve",
      address,
    });
    assert.equal(result.object.id, marker.bundleId);
    assert.equal(result.state.number, 1);
    const repeated = await resumed.call("site-command", request);
    assert.equal(repeated.operation.bundleId, marker.bundleId);
    assert.equal(repeated.operation.sequence, 1);
    assert.equal(
      (await resumed.call("site-command", { action: "state", address }))
        .nextSequence,
      2,
    );
  } finally {
    await worker.stop();
    await resumed?.stop();
    await reader?.stop();
    if (reader) rmSync(reader.dir, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a known newer head without bytes never falls back to an older site, including after profile unlock", async () => {
  const directory = projectTemp("site-unavailable-"),
    node = new LoomNode(directory);
  await node.start();
  const server = await serve(node),
    call = client(server.url, server.token);
  try {
    const owner = await call("setup", {
        name: "Unavailable payload owner",
        password,
      }),
      address = siteAddress(owner.id, "profile");
    const publish = async (title: string) => {
      const state = await call("site-command", { action: "state", address });
      return call("site-command", {
        action: "publish",
        name: "profile",
        sequence: state.nextSequence,
        operationId: randomUUID(),
        expectedBase: state.base,
        payload: { ...payload, site: { ...payload.site, title } },
        recipients: "public",
        ttlMs: 3600000,
      });
    };
    const one = await publish("Older available"),
      old = await call("site-command", { action: "resolve", address });
    const two = await publish("Newer missing");
    node.store.remove(two.operation.bundleId);
    await call("lock", {});
    await call("unlock", { password });
    const current = await call("site-command", { action: "resolve", address });
    assert.equal(current.status, "pending");
    assert.equal(current.state.number, 2);
    assert.equal(current.object, undefined);
    const pinned = await call("site-command", {
      action: "resolve",
      address,
      revisionId: old.revisionId,
    });
    assert.equal(pinned.status, "available");
    assert.equal(pinned.object.id, one.operation.bundleId);
  } finally {
    await server.close();
    await node.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blocking a private-site reader pauses a committed copy and clears the publication error after resumption", async () => {
  const directory = projectTemp("site-reader-block-"),
    node = new LoomNode(directory);
  await node.start();
  const server = await serve(node),
    call = client(server.url, server.token);
  try {
    const owner = await call("setup", {
      name: "Block publication owner",
      password,
    });
    const { createIdentity } = await import("../packages/core/src/index");
    const reader = createIdentity("Blocked site reader");
    await call("contact", { contact: reader.public });
    const state = await call("site-command", {
      action: "state",
      address: siteAddress(owner.id, "profile"),
    });
    const put = node.store.put.bind(node.store);
    node.store.put = (bundle, pin) => {
      if (bundle.manifest.kind === "site")
        throw new Error("fixture copy unavailable");
      return put(bundle, pin);
    };
    const request = {
      action: "publish",
      name: "profile",
      sequence: 1,
      operationId: randomUUID(),
      expectedBase: state.base,
      payload,
      recipients: [reader.public.id],
      ttlMs: 3600000,
    };
    const prepared = await call("site-command", request);
    assert.equal(prepared.operation.phase, "committed");
    node.store.put = put;
    await call("action", {
      action: "block",
      target: reader.public.id,
      value: true,
    });
    const blocked = await call("site-command", {
      action: "resume",
      name: "profile",
      sequence: 1,
      operationId: request.operationId,
    });
    assert.equal(blocked.operation.phase, "committed");
    assert.match(blocked.error, /bloqueado/);
    assert.equal(node.store.has(prepared.operation.bundleId), false);
    await call("action", {
      action: "block",
      target: reader.public.id,
      value: false,
    });
    const resumed = await call("site-command", {
      action: "resume",
      name: "profile",
      sequence: 1,
      operationId: request.operationId,
    });
    assert.equal(resumed.operation.phase, "ready");
    assert.equal(node.state().sitePublishing?.error, "");
    assert.equal(node.state().sitePublishing?.pending, 0);
  } finally {
    await server.close();
    await node.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
