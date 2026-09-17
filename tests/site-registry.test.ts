import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIdentity, canonical, hash } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { siteRevisions } from "../packages/sites/src/index";
import {
  createSiteRegistry,
  SITE_REGISTRY_LIMITS,
  type SiteRecord,
} from "../packages/sites/src/registry";
const registry = createSiteRegistry(nodeCertificateCrypto);
function request(
  owner: ReturnType<typeof createIdentity>,
  record: SiteRecord,
  text: string,
) {
  const state = registry.state(record),
    sequence = state.nextSequence!;
  return {
    sequence,
    operationId: randomUUID(),
    fingerprint: hash(text),
    expectedBase: registry.baseHash(record),
    revision: siteRevisions.createRevision(
      owner,
      record.name,
      sequence,
      state.heads
        .map((r) => r.id)
        .sort()
        .slice(0, 16),
      siteRevisions.documentHash(text),
    ),
    bundleId: hash("bundle:" + text + ":" + sequence),
  };
}

test("site sequence reservation is not publication; replay is stable and stale bases do not mutate state", () => {
  const owner = createIdentity("Writer"),
    initial = registry.initial(owner.public.id, "profile"),
    r = request(owner, initial, "first");
  const before = canonical(initial),
    started = registry.begin(initial, r);
  assert.equal(canonical(initial), before);
  assert.equal(started.operation.phase, "prepared");
  assert.equal(registry.state(started.record).status, "empty");
  assert.equal(registry.state(started.record).nextSequence, 2);
  const repeated = registry.begin(started.record, {
    ...r,
    bundleId: "f".repeat(64),
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.operation.bundleId, r.bundleId);
  assert.throws(() =>
    registry.lookup(started.record, 1, r.operationId, hash("different")),
  );
  const committed = registry.commit(
    started.record,
    1,
    r.operationId,
    r.fingerprint,
  );
  assert.equal(committed.operation.phase, "committed");
  assert.equal(registry.state(committed.record).heads[0].id, r.revision.id);
  assert.deepEqual(committed.record.headers[0].bundles, []);
  assert.equal(
    registry.cancel(committed.record, 1, r.operationId, r.fingerprint).operation
      .phase,
    "committed",
  );
  const ready = registry.markReady(
    committed.record,
    1,
    r.operationId,
    r.fingerprint,
  );
  assert.equal(ready.operation.phase, "ready");
  assert.deepEqual(ready.record.headers[0].bundles, [r.bundleId]);
  assert.equal(
    registry.commit(ready.record, 1, r.operationId, r.fingerprint).operation
      .phase,
    "ready",
  );
  const next = request(owner, ready.record, "next"),
    unchanged = canonical(ready.record);
  assert.throws(() =>
    registry.begin(ready.record, {
      ...next,
      expectedBase: registry.baseHash(initial),
    }),
  );
  assert.equal(canonical(ready.record), unchanged);
  const response = registry.state(committed.record);
  response.heads[0].body.name = "modified";
  assert.equal(committed.record.headers[0].revision.body.name, "profile");
});

test("a newer signed observation supersedes an unfinished publication and cannot roll back to older headers", () => {
  const owner = createIdentity("Updates"),
    empty = registry.initial(owner.public.id, "profile");
  const one = request(owner, empty, "local one"),
    pending = registry.begin(empty, one);
  const remote = siteRevisions.createRevision(
    owner,
    "profile",
    5,
    [],
    siteRevisions.documentHash("other device"),
  );
  const observed = registry.observe(
    pending.record,
    remote,
    hash("remote bundle"),
  );
  const finished = registry.commit(
    observed,
    one.sequence,
    one.operationId,
    one.fingerprint,
  );
  assert.equal(finished.operation.phase, "superseded");
  assert.equal(registry.state(finished.record).number, 5);
  const replay = registry.observe(finished.record, one.revision, one.bundleId);
  assert.equal(registry.state(replay).heads[0].id, remote.id);
  const foreign = createIdentity("Reader");
  const forged = siteRevisions.createRevision(
    foreign,
    "profile",
    10,
    [],
    siteRevisions.documentHash("forged"),
  );
  assert.throws(() => registry.observe(replay, forged, hash("foreign")));
});

test("retired site operation sequences cannot be replayed as new writes", () => {
  const owner = createIdentity("Journal");
  let record = registry.initial(owner.public.id, "profile");
  const first = request(owner, record, "first");
  let started = registry.begin(record, first);
  record = registry.cancel(
    started.record,
    first.sequence,
    first.operationId,
    first.fingerprint,
  ).record;
  for (let i = 0; i < SITE_REGISTRY_LIMITS.operations + 1; i++) {
    const r = request(owner, record, "next " + i);
    started = registry.begin(record, r);
    record = registry.cancel(
      started.record,
      r.sequence,
      r.operationId,
      r.fingerprint,
    ).record;
  }
  assert.equal(record.operations.length, SITE_REGISTRY_LIMITS.operations);
  assert.throws(() =>
    registry.lookup(
      record,
      first.sequence,
      first.operationId,
      first.fingerprint,
    ),
  );
  assert.equal(registry.state(record).status, "empty");
  assert.equal(
    registry.state(record).nextSequence,
    SITE_REGISTRY_LIMITS.operations + 3,
  );
});

test("a full site history can advance while the latest known header is retained without payloads", () => {
  const owner = createIdentity("History");
  let record = registry.initial(owner.public.id, "profile");
  record.counter = SITE_REGISTRY_LIMITS.headers;
  record.headers = Array.from(
    { length: SITE_REGISTRY_LIMITS.headers },
    (_, i) => ({
      revision: siteRevisions.createRevision(
        owner,
        "profile",
        i + 1,
        [],
        siteRevisions.documentHash("page " + i),
      ),
      bundles: [],
    }),
  );
  registry.validate(record, owner.public.id, "profile");
  const latest = registry.state(record).heads[0].id,
    r = request(owner, record, "new highest");
  const started = registry.begin(record, r);
  record = registry.commit(
    started.record,
    r.sequence,
    r.operationId,
    r.fingerprint,
  ).record;
  assert.equal(record.headers.length, SITE_REGISTRY_LIMITS.headers);
  assert.equal(registry.state(record).heads[0].id, r.revision.id);
  assert.equal(registry.state(record).number, SITE_REGISTRY_LIMITS.headers + 1);
  assert.ok(record.headers.some((entry) => entry.revision.id === latest));
  for (let i = 0; i < 7; i++)
    record = registry.observe(record, r.revision, hash("copy " + i));
  assert.equal(
    record.headers[0].bundles.length,
    SITE_REGISTRY_LIMITS.bundlesPerRevision,
  );
});

test("registry shape and single pending operation limits reject malformed state without invoking getters", () => {
  const owner = createIdentity("Limits"),
    record = registry.initial(owner.public.id, "profile"),
    r = request(owner, record, "one");
  const pending = registry.begin(record, r).record,
    before = canonical(pending);
  assert.throws(() => registry.begin(pending, request(owner, pending, "two")));
  assert.equal(canonical(pending), before);
  for (const change of [
    (v: any) => (v.counter = -1),
    (v: any) => (v.operations[0].sequence = 4),
    (v: any) => (v.extra = true),
    (v: any) => (v.headers = Array(1)),
  ]) {
    const altered = structuredClone(pending);
    change(altered);
    assert.throws(() => registry.validate(altered, owner.public.id, "profile"));
  }
  let called = false;
  const altered = { ...record };
  Object.defineProperty(altered, "ownerId", {
    enumerable: true,
    get() {
      called = true;
      return owner.public.id;
    },
  });
  assert.throws(() => registry.state(altered));
  assert.equal(called, false);
});

test("equal-sequence signed concurrency changes the base before durable authorization", () => {
  const owner = createIdentity("Concurrent owner"),
    empty = registry.initial(owner.public.id, "profile");
  const r = request(owner, empty, "private candidate"),
    pending = registry.begin(empty, r).record;
  const rival = siteRevisions.createRevision(
    owner,
    "profile",
    r.sequence,
    [],
    siteRevisions.documentHash("other device"),
  );
  const observed = registry.observe(pending, rival, hash("rival bundle"));
  const stopped = registry.commit(
    observed,
    r.sequence,
    r.operationId,
    r.fingerprint,
  );
  assert.equal(stopped.operation.phase, "superseded");
  assert.equal(registry.state(stopped.record).heads[0].id, rival.id);
  assert.throws(() =>
    registry.markReady(
      stopped.record,
      r.sequence,
      r.operationId,
      r.fingerprint,
    ),
  );
  assert.equal(
    stopped.record.headers.some((h) => h.revision.id === r.revision.id),
    false,
  );
});

test("committed publication recovery is irreversible and never rolls back a newer signed head", () => {
  const owner = createIdentity("Recovery owner"),
    empty = registry.initial(owner.public.id, "profile");
  const r = request(owner, empty, "authorized candidate"),
    pending = registry.begin(empty, r).record;
  assert.throws(() =>
    registry.markReady(pending, r.sequence, r.operationId, r.fingerprint),
  );
  const authorized = registry.commit(
    pending,
    r.sequence,
    r.operationId,
    r.fingerprint,
  ).record;
  assert.throws(() =>
    registry.begin(authorized, request(owner, authorized, "must wait")),
  );
  const newer = siteRevisions.createRevision(
    owner,
    "profile",
    7,
    [r.revision.id],
    siteRevisions.documentHash("newer"),
  );
  const observed = registry.observe(authorized, newer, hash("newer bundle"));
  const cancellation = registry.cancel(
    observed,
    r.sequence,
    r.operationId,
    r.fingerprint,
  );
  assert.equal(cancellation.operation.phase, "committed");
  const ready = registry.markReady(
    cancellation.record,
    r.sequence,
    r.operationId,
    r.fingerprint,
  );
  assert.equal(ready.operation.phase, "ready");
  assert.equal(registry.state(ready.record).heads[0].id, newer.id);
  assert.deepEqual(
    ready.record.headers.find((h) => h.revision.id === r.revision.id)?.bundles,
    [r.bundleId],
  );
  const next = request(owner, ready.record, "next");
  assert.throws(() =>
    registry.begin(ready.record, { ...next, operationId: r.operationId }),
  );
});

test("cryptographic memoization is confined to one transition and cannot hide subsequent mutations", () => {
  let verifies = 0;
  const counted = createSiteRegistry({
    ...nodeCertificateCrypto,
    verify(...args) {
      verifies++;
      return nodeCertificateCrypto.verify(...args);
    },
  });
  const owner = createIdentity("Bounded history");
  const record = counted.initial(owner.public.id, "profile");
  record.counter = SITE_REGISTRY_LIMITS.headers;
  record.headers = Array.from(
    { length: SITE_REGISTRY_LIMITS.headers },
    (_, i) => ({
      revision: siteRevisions.createRevision(
        owner,
        "profile",
        i + 1,
        [],
        siteRevisions.documentHash("payload " + i),
      ),
      bundles: [],
    }),
  );
  counted.state(record);
  assert.equal(verifies, SITE_REGISTRY_LIMITS.headers);
  counted.state(record);
  assert.equal(verifies, SITE_REGISTRY_LIMITS.headers * 2);
  record.headers[0].revision.signature = record.headers[1].revision.signature;
  assert.throws(() => counted.state(record));
});
