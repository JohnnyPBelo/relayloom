import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  createBundle,
  canonical,
  hash,
} from "../packages/core/src/index";
import { describeSiteResource } from "../packages/content/src/site-resource";
import {
  createResourceOperations,
  RESOURCE_OPERATION_LIMIT,
} from "../packages/sites/src/resource-operations";
const registry = createResourceOperations({ hash }),
  owner = createIdentity("Resource owner"),
  ownerId = owner.public.id;
const content = {
  type: "site-resource" as const,
  domain: "relayloom/site-resource/1" as const,
  kind: "file" as const,
  name: "Guia.txt",
  mime: "text/plain",
  data: "Zg==",
};
const request = (sequence = 1) => ({
  sequence,
  operationId: randomUUID(),
  content,
  recipients: "public" as const,
  ttlMs: 3600000,
});
function stage(q: ReturnType<typeof request>) {
  const bundle = createBundle(
    owner,
    "site-resource",
    q.content,
    "public",
    q.ttlMs,
  );
  return {
    reference: describeSiteResource(q.content, {
      id: bundle.manifest.id,
      authorId: ownerId,
      kind: bundle.manifest.kind,
    }),
    created: bundle.manifest.created,
    expires: bundle.manifest.expires,
    bundleHash: hash(canonical(bundle)),
    recipients: "public" as const,
  };
}
test("resource creation retries retain one signed identity and reject UUID reuse with a different request", () => {
  const q = request(),
    prepared = stage(q),
    start = registry.initial(ownerId),
    first = registry.prepare(start, ownerId, q, prepared);
  assert.equal(start.nextSequence, 1);
  const retry = registry.prepare(first.record, ownerId, q, stage(q));
  assert.deepEqual(retry, first);
  assert.throws(() =>
    registry.prepare(first.record, ownerId, { ...q, ttlMs: 7200000 }, prepared),
  );
  assert.throws(() =>
    registry.prepare(
      first.record,
      ownerId,
      { ...q, operationId: randomUUID() },
      prepared,
    ),
  );
  retry.record.operations[0].reference.name = "changed";
  assert.equal(first.record.operations[0].reference.name, "Guia.txt");
});
test("a pending copy holds the slot; only its exact ciphertext may complete it", () => {
  const q = request(),
    signed = stage(q),
    prepared = registry.prepare(registry.initial(ownerId), ownerId, q, signed);
  const next = request(2);
  assert.throws(() =>
    registry.prepare(prepared.record, ownerId, next, stage(next)),
  );
  assert.throws(() =>
    registry.ready(
      prepared.record,
      ownerId,
      1,
      q.operationId,
      prepared.operation.fingerprint,
      "0".repeat(64),
    ),
  );
  const ready = registry.ready(
    prepared.record,
    ownerId,
    1,
    q.operationId,
    prepared.operation.fingerprint,
    signed.bundleHash,
  );
  assert.equal(ready.operations[0].phase, "ready");
  assert.deepEqual(
    registry.ready(
      ready,
      ownerId,
      1,
      q.operationId,
      prepared.operation.fingerprint,
      signed.bundleHash,
    ),
    ready,
  );
  assert.equal(
    registry.prepare(ready, ownerId, next, stage(next)).record.nextSequence,
    3,
  );
});
test("expired pending work remains a terminal outcome instead of silently signing a replacement", () => {
  const q = request(),
    signed = stage(q),
    first = registry.prepare(registry.initial(ownerId), ownerId, q, signed);
  const expired = registry.expire(first.record, ownerId, signed.expires);
  assert.equal(expired.operations[0].phase, "expired");
  const repeated = registry.prepare(expired, ownerId, q, stage(q));
  assert.equal(
    repeated.operation.reference.bundleId,
    first.operation.reference.bundleId,
  );
  assert.equal(repeated.operation.phase, "expired");
  assert.throws(() =>
    registry.ready(
      expired,
      ownerId,
      1,
      q.operationId,
      first.operation.fingerprint,
      signed.bundleHash,
    ),
  );
  const renewed = request(2);
  assert.equal(
    registry.prepare(expired, ownerId, renewed, stage(renewed)).record
      .nextSequence,
    3,
  );
});
test("retirement is bounded by committed sequence and cannot turn an old uncertain retry into new work", () => {
  let record = registry.initial(ownerId);
  const first = request(),
    firstStage = stage(first);
  for (let i = 1; i <= RESOURCE_OPERATION_LIMIT + 2; i++) {
    const q = i === 1 ? first : request(i),
      signed = i === 1 ? firstStage : stage(q);
    const prepared = registry.prepare(record, ownerId, q, signed);
    record = registry.ready(
      prepared.record,
      ownerId,
      i,
      q.operationId,
      prepared.operation.fingerprint,
      signed.bundleHash,
    );
  }
  assert.equal(record.operations.length, RESOURCE_OPERATION_LIMIT);
  assert.equal(record.operations[0].sequence, 3);
  assert.equal(
    registry.lookup(record, ownerId, 1, first.operationId).retired,
    true,
  );
  assert.throws(() => registry.prepare(record, ownerId, first, firstStage));
  const invalid = structuredClone(record);
  invalid.nextSequence--;
  assert.throws(() => registry.validate(invalid, ownerId));
  invalid.nextSequence++;
  invalid.operations[0].fingerprint = "0".repeat(64);
  assert.throws(() => registry.validate(invalid, ownerId));
});
test("staging cannot change creator, size, scope or lifespan; private reader scope must include the owner", () => {
  const q = request(),
    signed = stage(q),
    initial = registry.initial(ownerId);
  for (const invalid of [
    { ...signed, expires: signed.expires + 1 },
    { ...signed, recipients: [ownerId] },
    { ...signed, reference: { ...signed.reference, bytes: 5 } },
    { ...signed, reference: { ...signed.reference, authorId: "c".repeat(64) } },
  ])
    assert.throws(() => registry.prepare(initial, ownerId, q, invalid));
  for (const recipients of [[], ["c".repeat(64)], [ownerId, ownerId]])
    assert.throws(() => registry.request({ ...q, recipients }, ownerId));
  assert.doesNotThrow(() =>
    registry.request({ ...q, recipients: [ownerId] }, ownerId),
  );
});
test("untrusted local record and request getters are refused without execution", () => {
  let calls = 0;
  const q = request();
  Object.defineProperty(q, "content", {
    get: () => {
      calls++;
      return content;
    },
  });
  assert.throws(() => registry.request(q, ownerId));
  const record = registry.initial(ownerId);
  Object.defineProperty(record, "nextSequence", {
    get: () => {
      calls++;
      return 1;
    },
  });
  assert.throws(() => registry.validate(record, ownerId));
  assert.equal(calls, 0);
});
