import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  canonical,
  createBundle,
  type Identity,
} from "../packages/core/src/index.js";
import { GroupLedger } from "../packages/groups/src/ledger.js";
import { LoomNode } from "../apps/node/src/node.js";
import { serve } from "../apps/node/src/server.js";
import { password } from "./helpers.js";

async function fixture(t: TestContext) {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".cache/group-admission-fault-")),
    node = new LoomNode(dir),
    server = await serve(node);
  // These persistence fault controls use explicit HTTP observations. The real
  // multi-process TCP test separately exercises the running sync timer.
  clearInterval((node as any).syncTimer);
  t.after(async () => {
    await server.close();
    await node.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  node.setup("Owner", password);
  const identity = node.identity as Identity;
  const created = node.groupCommand({
    action: "create",
    operationId: randomUUID(),
    title: "Boundary",
  }) as any;
  const groupId = created.group.id,
    epoch = created.group.head.id;
  const snapshot = (
    node.groupCommand({
      action: "private-state",
      groupId,
      epochId: epoch,
    }) as any
  ).snapshot;
  const call = async (path = "state", body?: unknown) => {
    const response = await fetch(server.url + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + server.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  const read = (id: string) =>
    (node as any).privateDatabase.transaction(
      (tx: any) =>
        GroupLedger.run(tx, identity, (l) => ({
          accepted: l.accepted(id),
          held: l.held(),
        })).value,
    );
  const message = (text: string, publishingEpoch = epoch) =>
    createBundle(
      identity,
      "message",
      {
        type: "message",
        conversation: groupId,
        groupAudience: "epoch",
        groupEpoch: publishingEpoch,
        members: snapshot.members,
        text,
      },
      snapshot.members,
      60000,
    );
  return { dir, node, identity, groupId, epoch, snapshot, call, read, message };
}

test("an API observation cannot display an admission whose outer transaction rolled back", async (t) => {
  const f = await fixture(t),
    bundle = f.message("Must commit before display");
  f.node.store.put(bundle);
  const database = (f.node as any).privateDatabase,
    transaction = database.transaction.bind(database);
  database.transaction = (callback: any) =>
    transaction((tx: any) => {
      const generation = tx.generation(),
        result = callback(tx);
      if (tx.generation() !== generation)
        throw new Error("synthetic before-commit failure");
      return result;
    });
  const rejected = await f.call();
  assert.equal(rejected.status, 400);
  assert.equal(f.read(bundle.manifest.id).accepted, null);
  const recovered = await f.call();
  assert.equal(recovered.status, 200);
  assert.equal(
    recovered.value.objects.some((o: any) => o.id === bundle.manifest.id),
    true,
  );
  assert.ok(f.read(bundle.manifest.id).accepted);
});

test("a historical delete and its accepted context recover together after lost commit response and real cache removal", async (t) => {
  const f = await fixture(t),
    original = f.message("Historical original");
  f.node.store.put(original);
  assert.equal((await f.call()).status, 200);
  assert.ok(f.read(original.manifest.id).accepted);
  f.node.store.remove(original.manifest.id);
  f.node.groupCommand({
    action: "close",
    operationId: randomUUID(),
    groupId: f.groupId,
    expected: f.epoch,
  });
  const event = createBundle(
    f.identity,
    "delete",
    {
      type: "delete",
      conversation: f.groupId,
      groupAudience: "historical",
      target: original.manifest.id,
      targetEpoch: f.epoch,
    },
    f.snapshot.members,
    60000,
  );
  f.node.store.put(event);
  const database = (f.node as any).privateDatabase,
    transaction = database.transaction.bind(database);
  let committed = false;
  database.transaction = (callback: any) => {
    let wrote = false;
    const result = transaction((tx: any) => {
      const generation = tx.generation();
      const result = callback(tx);
      wrote = tx.generation() !== generation;
      return result;
    });
    if (wrote) {
      committed = true;
      throw new Error("synthetic lost response after commit");
    }
    return result;
  };
  assert.equal((await f.call()).status, 400);
  assert.equal(committed, true);
  assert.ok(f.read(event.manifest.id).accepted);
  assert.equal(
    (f.node as any).privateState.mutations[original.manifest.id].deleted,
    true,
  );
  f.node.store.put(original);
  const restored = await f.call();
  assert.equal(restored.status, 200);
  assert.equal(
    restored.value.objects.find((o: any) => o.id === original.manifest.id)
      .deleted,
    true,
  );
});

test("failure to reserve quarantine bytes aborts the hold and locks until authenticated reconciliation succeeds", async (t) => {
  const f = await fixture(t),
    bundle = f.message("Awaiting proof", "f".repeat(64));
  f.node.store.put(bundle);
  const path = join(f.node.store.dir, "index.json"),
    backup = path + ".backup";
  renameSync(path, backup);
  mkdirSync(path);
  try {
    assert.equal((await f.call()).status, 400);
    assert.equal(
      f.node.identity,
      undefined,
      "cannot continue after reservation reconciliation also failed",
    );
    assert.deepEqual(
      f.node.store.reservations(),
      [bundle.manifest.id],
      "uncertain availability remains conservative",
    );
  } finally {
    rmSync(path, { recursive: true });
    renameSync(backup, path);
  }
  assert.equal((await f.call("unlock", { password })).status, 200);
  assert.deepEqual(f.read(bundle.manifest.id).held, []);
  assert.deepEqual(f.node.store.reservations(), []);
  const recovered = await f.call();
  assert.equal(recovered.status, 200);
  assert.equal(recovered.value.groupContent.held[0].id, bundle.manifest.id);
  assert.equal(recovered.value.groupContent.held[0].available, true);
  assert.equal(
    recovered.value.objects.some((o: any) => o.id === bundle.manifest.id),
    false,
  );
});

test("an unavailable quarantined blob cannot block admission of another valid group object", async (t) => {
  const f = await fixture(t),
    held = f.message("Will be damaged", "f".repeat(64));
  f.node.store.put(held);
  assert.equal((await f.call()).value.groupContent.held[0].available, true);
  const path = join(f.node.store.dir, "objects", held.manifest.id + ".json");
  const damaged = JSON.parse(readFileSync(path, "utf8")),
    key = Object.keys(damaged.chunks)[0];
  damaged.chunks[key] =
    (damaged.chunks[key][0] === "A" ? "B" : "A") + damaged.chunks[key].slice(1);
  writeFileSync(path, JSON.stringify(damaged));
  const good = f.message("Still admissible");
  f.node.store.put(good);
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(
    response.value.objects.some(
      (object: any) => object.id === good.manifest.id,
    ),
    true,
  );
  assert.equal(response.value.groupContent.held[0].available, false);
  assert.equal(response.value.storage.reserved, 0);
});

test("authenticated history with an expiry inconsistent with its signed bundle is rejected", async (t) => {
  const f = await fixture(t),
    bundle = f.message("Bound expiry");
  f.node.store.put(bundle);
  assert.equal((await f.call()).status, 200);
  const record = f.read(bundle.manifest.id).accepted;
  const replace = (value: unknown) =>
    (f.node as any).privateDatabase.transaction((tx: any) =>
      tx.put(
        "group-history:" + bundle.manifest.id,
        Buffer.from(canonical(value)),
      ),
    );
  replace({ ...record, expires: record.expires + 1 });
  assert.equal((await f.call()).status, 400);
  replace(record);
  assert.equal((await f.call()).status, 200);
});
