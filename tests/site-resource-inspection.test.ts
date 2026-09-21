import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";
import { ResourceInspector } from "../apps/web/src/site/resource-inspection";
import { describeSiteResource } from "../packages/content/src/site-resource";

const target = (blockId: string) => ({
  snapshotId: "a".repeat(64),
  pageId: "home",
  blockId,
});
function fixture(parallel: number, queued = 8) {
  const calls: {
    path: string;
    body: any;
    signal?: AbortSignal;
    resolve(value: any): void;
    reject(error: Error): void;
  }[] = [];
  const inspector = new ResourceInspector(
    (path, body, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ path, body, signal, resolve, reject });
      }),
    parallel,
    queued,
  );
  return { inspector, calls };
}

test("automatic resource checks bound concurrency and retain each authenticated target", async () => {
  const { inspector, calls } = fixture(2);
  const mutable = target("third");
  const results = [
    inspector.inspect(target("first")),
    inspector.inspect(target("second")),
    inspector.inspect(mutable),
  ];
  mutable.blockId = "changed-after-enqueue";
  await turn();
  assert.equal(calls.length, 2);
  calls[1].resolve("second result");
  await turn();
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((c) => [c.path, c.body.action, c.body.blockId]),
    [
      ["resource-command", "inspect", "first"],
      ["resource-command", "inspect", "second"],
      ["resource-command", "inspect", "third"],
    ],
  );
  calls[0].resolve("first result");
  calls[2].resolve("third result");
  assert.deepEqual(await Promise.all(results), [
    "first result",
    "second result",
    "third result",
  ]);
});

test("aborting an active view cannot release its real request slot early", async () => {
  const { inspector, calls } = fixture(1),
    controller = new AbortController();
  const first = inspector.inspect(target("old"), controller.signal);
  const cancelled = assert.rejects(first, { name: "AbortError" });
  const second = inspector.inspect(target("new"));
  await turn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal, undefined);
  controller.abort();
  await cancelled;
  await turn();
  assert.equal(calls.length, 1);
  calls[0].resolve("obsolete");
  await turn();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.blockId, "new");
  calls[1].resolve("current");
  assert.equal(await second, "current");
});

test("queued cancellation never reaches the runtime and a failed request advances the queue", async () => {
  const { inspector, calls } = fixture(1),
    controller = new AbortController();
  const first = inspector.inspect(target("first"));
  const failure = assert.rejects(first, /storage unavailable/);
  const gone = inspector.inspect(target("unmounted"), controller.signal);
  const cancelled = assert.rejects(gone, { name: "AbortError" });
  const last = inspector.inspect(target("last"));
  controller.abort();
  await cancelled;
  await turn();
  assert.equal(calls.length, 1);
  calls[0].reject(new Error("storage unavailable"));
  await failure;
  await turn();
  assert.deepEqual(
    calls.map((c) => c.body.blockId),
    ["first", "last"],
  );
  calls[1].resolve("last result");
  assert.equal(await last, "last result");
});

test("queue exhaustion preserves admitted checks and already-aborted work never starts", async () => {
  const { inspector, calls } = fixture(1, 2),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(inspector.inspect(target("gone"), controller.signal), {
    name: "AbortError",
  });
  const first = inspector.inspect(target("one")),
    second = inspector.inspect(target("two")),
    third = inspector.inspect(target("three"));
  await assert.rejects(
    inspector.inspect(target("over-budget")),
    /demasiadas operações/,
  );
  for (let i = 0; i < 3; i++) {
    await turn();
    assert.equal(calls.length, i + 1);
    calls[i].resolve(i);
  }
  assert.deepEqual(await Promise.all([first, second, third]), [0, 1, 2]);
  assert.deepEqual(
    calls.map((c) => c.body.blockId),
    ["one", "two", "three"],
  );
});

const reference = describeSiteResource(
  {
    domain: "relayloom/site-resource/1",
    type: "site-resource",
    kind: "file",
    name: "shared.txt",
    mime: "text/plain",
    data: "YQ==",
  },
  { id: "b".repeat(64), authorId: "c".repeat(64), kind: "site-resource" },
);
test("identical reference checks coalesce only in flight and return independent result objects", async () => {
  const { inspector, calls } = fixture(2);
  const first = inspector.inspect(target("first"), undefined, reference),
    second = inspector.inspect(
      target("second"),
      undefined,
      structuredClone(reference),
    );
  await turn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.blockId, "first");
  calls[0].resolve({ status: "available", reference });
  const [a, b] = await Promise.all([first, second]);
  a.reference.name = "local edit";
  assert.equal(b.reference.name, "shared.txt");
  assert.equal(reference.name, "shared.txt");
  const later = inspector.inspect(target("first"), undefined, reference);
  await turn();
  assert.equal(calls.length, 2);
  calls[1].resolve({ status: "blocked", reference });
  assert.equal((await later).status, "blocked");
});
test("reference coalescing separates snapshots, pages and descriptor changes", async () => {
  const { inspector, calls } = fixture(4);
  const values = [
    inspector.inspect(target("first"), undefined, reference),
    inspector.inspect(
      { ...target("second"), snapshotId: "d".repeat(64) },
      undefined,
      reference,
    ),
    inspector.inspect(
      { ...target("third"), pageId: "other" },
      undefined,
      reference,
    ),
    inspector.inspect(target("fourth"), undefined, {
      ...reference,
      payloadHash: "e".repeat(64),
    }),
  ];
  await turn();
  assert.equal(calls.length, 4);
  for (const [i, c] of calls.entries()) c.resolve(i);
  assert.deepEqual(await Promise.all(values), [0, 1, 2, 3]);
  await assert.rejects(
    inspector.inspect(target("bad"), undefined, { ...reference, bytes: -1 }),
  );
  assert.equal(calls.length, 4);
});
test("one cancelled consumer does not cancel its live sibling; abandoned views cannot be revived", async () => {
  const { inspector, calls } = fixture(1),
    one = new AbortController(),
    two = new AbortController();
  const first = inspector.inspect(target("first"), one.signal, reference),
    second = inspector.inspect(target("second"), two.signal, reference);
  const firstCancelled = assert.rejects(first, { name: "AbortError" });
  await turn();
  one.abort();
  await firstCancelled;
  calls[0].resolve("sibling result");
  assert.equal(await second, "sibling result");
  await turn();
  const gone = new AbortController(),
    old = inspector.inspect(target("old"), gone.signal, reference),
    cancelled = assert.rejects(old, { name: "AbortError" });
  await turn();
  gone.abort();
  await cancelled;
  const current = inspector.inspect(target("current"), undefined, reference);
  await turn();
  assert.equal(calls.length, 2);
  calls[1].resolve("obsolete result");
  await turn();
  assert.equal(calls.length, 3);
  calls[2].resolve("current session");
  assert.equal(await current, "current session");
});
test("shared-request failures reject every caller and do not become cached success", async () => {
  const { inspector, calls } = fixture(1);
  const first = inspector.inspect(target("one"), undefined, reference),
    second = inspector.inspect(target("two"), undefined, reference);
  const a = assert.rejects(first, /corrupt/),
    b = assert.rejects(second, /corrupt/);
  await turn();
  calls[0].reject(Error("corrupt"));
  await Promise.all([a, b]);
  const next = inspector.inspect(target("next"), undefined, reference);
  await turn();
  assert.equal(calls.length, 2);
  calls[1].resolve("verified anew");
  assert.equal(await next, "verified anew");
});
test("coalesced observers remain bounded even when they share one runtime request", async () => {
  const { inspector, calls } = fixture(1, 2);
  const values = Array.from({ length: 3 }, (_, i) =>
    inspector.inspect(target("same-" + i), undefined, reference),
  );
  await assert.rejects(
    inspector.inspect(target("over"), undefined, reference),
    /demasiadas/,
  );
  await turn();
  assert.equal(calls.length, 1);
  calls[0].resolve("ok");
  assert.deepEqual(await Promise.all(values), ["ok", "ok", "ok"]);
});
