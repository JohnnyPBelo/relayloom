import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { groupOutboxFixture } from "./fixtures/group-outbox.js";
import { readProfileState } from "../packages/profile/src/state.js";
import { canonical } from "../packages/core/src/index.js";
import { Router } from "../packages/transport/src/index.js";
import { until } from "./helpers.js";

async function fixture(t: TestContext) {
  const f = groupOutboxFixture(t),
    sink = new Router({ relay: false }),
    received: any[] = [];
  t.after(() => sink.stop());
  sink.on("payload", (p) => received.push(p));
  f.node.router.connectTcp("127.0.0.1", await sink.listen());
  await until(
    async () => f.node.router.peers,
    (peers) => peers.some((p) => p.connected),
  );
  f.node.router.broadcast({ witness: "connected" });
  await until(
    async () => received,
    (items) => items.some((p) => p.witness === "connected"),
  );
  const operation = randomUUID();
  const content = {
    type: "message",
    text: "An exact recoverable group intent",
    conversation: f.group.id,
    groupEpoch: f.group.head.id,
    groupAudience: "epoch",
  };
  const send = () =>
    f.node.send(operation, content, [f.reader.public.id], 600000);
  return { ...f, operation, send, received };
}

for (const committed of [false, true])
  test(`group send intent ${committed ? "lost response" : "rollback"} has no transport side effect`, async (t) => {
    const f = await fixture(t),
      database = f.internals.privateDatabase,
      transaction = database.transaction.bind(database);
    let captured = "",
      hit = false;
    const inspect = (result: any) => {
      if (result?.state?.outbox?.[f.operation]?.phase === "preparing") {
        captured = result.bundle.manifest.id;
        hit = true;
        return true;
      }
      return false;
    };
    database.transaction = (callback: any) => {
      if (committed) {
        const result = transaction(callback);
        if (inspect(result)) throw new Error("fixture after intent commit");
        return result;
      }
      return transaction((tx: any) => {
        const result = callback(tx);
        if (inspect(result)) throw new Error("fixture before intent commit");
        return result;
      });
    };
    assert.throws(f.send, /fixture/);
    assert.equal(hit, true);
    await delay(200);
    assert.equal(
      f.received.some((p) => p.bundle?.manifest.id === captured),
      false,
    );
    const item = f.node
      .state()
      .outbox.find((e) => e.operationId === f.operation);
    assert.equal(!!item, committed);
    if (committed) {
      assert.equal(item!.id, captured);
      assert.equal(item!.status, "unavailable");
      assert.equal(f.send().id, captured);
      assert.equal(f.send().outbox.attempts, 0);
    }
  });

for (const committed of [false, true])
  test(`group send recovers original stored bytes after ${committed ? "lost ready response" : "ready rollback"}`, async (t) => {
    const f = await fixture(t),
      database = f.internals.privateDatabase,
      transaction = database.transaction.bind(database);
    let hit = false;
    const phase = (tx: any) =>
      JSON.parse(readProfileState(tx)!.bytes.toString()).outbox?.[f.operation]
        ?.phase;
    database.transaction = (callback: any) => {
      let promote = false;
      const result = transaction((tx: any) => {
        const before = phase(tx),
          value = callback(tx);
        promote = before === "preparing" && phase(tx) === "ready";
        if (promote && !committed) {
          hit = true;
          throw new Error("fixture before ready commit");
        }
        return value;
      });
      if (promote && committed) {
        hit = true;
        throw new Error("fixture after ready commit");
      }
      return result;
    };
    assert.throws(f.send, /fixture/);
    assert.equal(hit, true);
    const record = f.internals.privateState.outbox[f.operation],
      id = record.id;
    const expected = canonical(f.node.store.get(id, false));
    await delay(200);
    assert.equal(
      f.received.some((p) => p.bundle?.manifest.id === id),
      false,
    );
    const item = f.node.state().outbox.find((e) => e.id === id)!;
    assert.equal(item.accepted, true);
    assert.equal(item.status, "pending");
    assert.equal(item.attempts, 0);
    assert.equal(f.node.retryOutbox(f.operation).id, id);
    await until(
      async () => f.received,
      (items) => items.some((p) => p.bundle?.manifest.id === id),
    );
    assert.equal(
      canonical(f.received.find((p) => p.bundle?.manifest.id === id).bundle),
      expected,
    );
    assert.equal(f.send().id, id);
  });

test("a reported content-store failure cannot leak the new group packet or silently create another ID", async (t) => {
  const f = await fixture(t),
    put = f.node.store.putReserved.bind(f.node.store);
  let id = "";
  f.node.store.putReserved = (bundle, ...rest) => {
    id = bundle.manifest.id;
    put(bundle, ...rest);
    throw new Error("fixture content-store response failure");
  };
  assert.throws(f.send, /fixture content-store/);
  f.node.store.putReserved = put;
  const item = f.node.state().outbox.find((e) => e.id === id)!;
  assert.equal(item.status, "unavailable");
  assert.equal(item.attempts, 0);
  assert.equal(f.send().id, id);
  assert.equal(f.node.retryOutbox(f.operation).outbox.status, "unavailable");
  await delay(250);
  assert.equal(
    f.received.some((p) => p.bundle?.manifest.id === id),
    false,
  );
});
