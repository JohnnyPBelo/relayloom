import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  createIdentity,
  createBundle,
  ContentStore,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { NodeContributionCatalog } from "../packages/sites/src/contribution-catalog";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
import { SitePrivateRecords } from "../packages/sites/src/private-storage";
import { formPayload } from "./fixtures/site-form";
import { projectTemp } from "./project-temp";
const allow = () => {};
function fixture() {
  const directory = projectTemp("contribution-queue-"),
    identity = createIdentity("Visitor"),
    author = createIdentity("Site owner"),
    path = join(directory, "profile.sqlite"),
    database = new ProtectedGroupStore(path, identity, { create: true }),
    storeId = database.storeId();
  const content = createSiteContentProtocol(nodeCertificateCrypto).create(
      author,
      "profile",
      1,
      [],
      formPayload(),
    ),
    source = createBundle(author, "site", content, [identity.public]);
  const request = (sequence: number, ttlMs = 60000) => ({
    sequence,
    operationId: randomUUID(),
    snapshotId: source.manifest.id,
    pageId: "entry",
    formId: "form",
    values: { name: "PRIVATE_QUEUE_VALUE_73912", count: sequence, open: false },
    publicationScope: [identity.public.id, author.public.id].sort(),
    ttlMs,
  });
  return {
    directory,
    path,
    identity,
    author,
    database,
    storeId,
    source,
    request,
  };
}
function seal(
  catalog: NodeContributionCatalog,
  f: ReturnType<typeof fixture>,
  sequence: number,
  ttlMs = 60000,
) {
  const prepared = catalog.prepare(
      f.request(sequence, ttlMs),
      () => f.source,
      allow,
    ),
    signed = catalog.sign(prepared, allow);
  catalog.seal(signed, allow);
  return signed;
}

test("queued source and envelope survive restart while a second preparation uses its own slot", () => {
  const f = fixture();
  let db = f.database;
  try {
    let c = new NodeContributionCatalog(db, f.identity);
    const first = seal(c, f, 1),
      envelope = c.authorizedBundle(first, allow)!;
    const queued = c.queue(first, allow);
    assert.equal(queued.phase, "queued");
    assert.equal(queued.transport!.copied, false);
    assert.equal(queued.transport!.bundleId, envelope.manifest.id);
    assert.deepEqual(
      c.queue(first, () => {
        throw Error("retained queue result must not create another intent");
      }),
      queued,
    );
    const second = c.prepare(f.request(2), () => f.source, allow);
    assert.equal(second.phase, "prepared");
    db.close();
    db = new ProtectedGroupStore(f.path, f.identity, {
      expectedStoreId: f.storeId,
    });
    c = new NodeContributionCatalog(db, f.identity);
    assert.equal(c.state().nextSequence, 3);
    assert.equal(
      JSON.stringify(c.state()).includes("PRIVATE_QUEUE_VALUE_73912"),
      false,
    );
    assert.equal(
      canonical(c.authorizedBundle(queued, allow)),
      canonical(envelope),
    );
    assert.equal(canonical(c.queuedSource(queued, allow)), canonical(f.source));
    const store = new ContentStore(join(f.directory, "public-store"));
    assert.equal(store.list().length, 0, "queueing alone must not gossip");
    const damaged = structuredClone(envelope);
    damaged.manifest.signature = "A".repeat(88);
    assert.throws(() => c.markCopied(queued, damaged));
    store.put(envelope, true);
    const copied = c.markCopied(queued, store.get(envelope.manifest.id, false));
    assert.equal(copied.transport!.copied, true);
    const cancelled = c.cancel(queued);
    assert.equal(cancelled.transport!.bundleId, envelope.manifest.id);
    assert.equal(c.authorizedBundle(queued, allow), null);
    c.cancel(queued);
    assert.equal(
      c.sign(second, allow).phase,
      "signed",
      "repeated cancellation must not remove the second source",
    );
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("queue transaction rollback retains the signed envelope and never frees a preparation early", () => {
  const f = fixture();
  try {
    const c = new NodeContributionCatalog(f.database, f.identity),
      op = seal(c, f, 1),
      bundle = c.authorizedBundle(op, allow);
    const failing = {
      transaction<T>(fn: (tx: any) => T): T {
        return f.database.transaction((tx) => {
          fn(tx);
          throw Error("before queue commit");
        });
      },
    };
    assert.throws(
      () => new NodeContributionCatalog(failing, f.identity).queue(op, allow),
      /before queue commit/,
    );
    assert.equal(c.state().operations[0].phase, "signed");
    assert.deepEqual(c.authorizedBundle(op, allow), bundle);
    assert.throws(() => c.prepare(f.request(2), () => f.source, allow));
    assert.equal(c.queue(op, allow).phase, "queued");
    assert.equal(
      c.prepare(f.request(2), () => f.source, allow).phase,
      "prepared",
    );
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("queued expiry retires private payload but retains packet identity for cancellation", () => {
  const f = fixture();
  let now = Date.now();
  try {
    const c = new NodeContributionCatalog(f.database, f.identity, () => now),
      first = seal(c, f, 1, 1000),
      q = c.queue(first, allow),
      second = c.prepare(f.request(2, 60000), () => f.source, allow);
    now = q.expires;
    const state = c.state();
    assert.equal(state.operations[0].phase, "expired");
    assert.deepEqual(state.operations[0].transport, q.transport);
    assert.equal(state.operations[1].phase, "prepared");
    assert.equal(c.authorizedBundle(q, allow), null);
    assert.equal(
      f.database.view(
        (tx) => tx.keys("contribution:" + q.certificateId + ":").length,
      ),
      0,
    );
    assert.equal(c.sign(second, allow).phase, "signed");
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("32 pending queues apply backpressure without losing old payloads or the current prepared envelope", () => {
  const f = fixture();
  const now = Date.now();
  try {
    const c = new NodeContributionCatalog(f.database, f.identity, () => now),
      queued = [];
    for (let i = 1; i <= 32; i++) queued.push(c.queue(seal(c, f, i), allow));
    const pending = seal(c, f, 33);
    assert.throws(() => c.queue(pending, allow), /orçamento/);
    assert.equal(
      c.state().operations.filter((op) => op.phase === "queued").length,
      32,
    );
    assert.equal(c.state().operations.at(-1)!.phase, "signed");
    assert.ok(c.authorizedBundle(queued[0], allow));
    c.cancel(queued[0]);
    assert.equal(c.queue(pending, allow).phase, "queued");
    assert.equal(c.state().nextSequence, 34);
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("missing queued payload is corruption, not an excuse to create new bytes or cancel a different stage", () => {
  const f = fixture();
  try {
    const c = new NodeContributionCatalog(f.database, f.identity),
      q = c.queue(seal(c, f, 1), allow);
    c.prepare(f.request(2), () => f.source, allow);
    f.database.transaction((tx) =>
      SitePrivateRecords.runContribution(tx, f.identity, (values) =>
        values.remove("contribution:" + q.certificateId + ":stage"),
      ),
    );
    assert.throws(() => c.authorizedBundle(q, allow));
    assert.throws(() => c.cancel(q));
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
