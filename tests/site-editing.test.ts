import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSiteEditingContext } from "../packages/sites/src/editing";
const owner = "a".repeat(64),
  other = "b".repeat(64);
const valid = {
  domain: "relayloom/site-editing/1",
  address: "relayloom:site:" + owner + "/profile",
  base: "c".repeat(64),
  sequence: 2,
  recipients: "public",
  ttlMs: 30 * 86400_000,
};
const pending = {
  operationId: "10000000-0000-0000-0000-000000000000",
  requestHash: "d".repeat(64),
  confirmedHeads: ["1".repeat(64), "2".repeat(64)],
};

test("draft context retains original base and exact pending request across serialisation without transferring ownership", () => {
  const source = { ...valid, pending },
    accepted = validateSiteEditingContext(source, owner);
  assert.deepEqual(accepted, source);
  assert.notEqual(accepted, source);
  assert.notEqual(accepted.pending, source.pending);
  accepted.pending!.confirmedHeads!.push("3".repeat(64));
  assert.equal(source.pending.confirmedHeads.length, 2);
  assert.deepEqual(
    validateSiteEditingContext(JSON.parse(JSON.stringify(source)), owner),
    source,
  );
  assert.throws(() => validateSiteEditingContext(source, other));
});

test("malformed or ambiguous draft context cannot replace valid private editing metadata", () => {
  const cases: unknown[] = [
    null,
    {},
    [],
    { ...valid, domain: "relayloom/site-editing/2" },
    { ...valid, address: "relayloom:site:" + other + "/profile" },
    { ...valid, address: valid.address + "/extra" },
    { ...valid, base: "c".repeat(63) },
    { ...valid, base: "C".repeat(64) },
    { ...valid, sequence: 0 },
    { ...valid, recipients: [owner] },
    { ...valid, recipients: [other, other] },
    { ...valid, recipients: null },
    { ...valid, ttlMs: 0 },
    { ...valid, ttlMs: 1.5 },
    { ...valid, ttlMs: 366 * 86400_000 },
    { ...valid, sequence: 1.1 },
    { ...valid, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, remoteScript: "https://example.invalid/code.js" },
    { ...valid, pending: null },
    { ...valid, pending: { ...pending, operationId: "reuse" } },
    { ...valid, pending: { ...pending, requestHash: "bad" } },
    { ...valid, pending: { ...pending, confirmedHeads: [] } },
    { ...valid, pending: { ...pending, confirmedHeads: [other] } },
    { ...valid, pending: { ...pending, confirmedHeads: [other, owner] } },
    { ...valid, pending: { ...pending, confirmedHeads: [owner, owner] } },
    { ...valid, pending: { ...pending, confirmedHeads: new Array(2) } },
    { ...valid, pending: { ...pending, extra: true } },
  ];
  const extra = [owner, other] as any;
  extra.extra = true;
  cases.push({ ...valid, pending: { ...pending, confirmedHeads: extra } });
  let reads = 0;
  const getter = [owner, other];
  Object.defineProperty(getter, "0", {
    get() {
      reads++;
      return owner;
    },
  });
  cases.push({ ...valid, pending: { ...pending, confirmedHeads: getter } });
  for (const [index, value] of cases.entries())
    assert.throws(
      () => validateSiteEditingContext(value, owner),
      "rejected case " + index,
    );
  assert.equal(reads, 0);
  assert.deepEqual(validateSiteEditingContext(valid, owner), valid);
});
