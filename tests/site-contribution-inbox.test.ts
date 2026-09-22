import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  createIdentity,
  createBundleAt,
  decryptStoredBundle,
  type Bundle,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { createContributionContextResolver } from "../packages/sites/src/contribution-context";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { NodeContributionInbox } from "../packages/sites/src/contribution-inbox-catalog";
import {
  createContributionInboxProtocol,
  CONTRIBUTION_INBOX_LIMITS,
} from "../packages/sites/src/contribution-inbox";
import { NodeContributionCatalog } from "../packages/sites/src/contribution-catalog";
import { SitePrivateRecords } from "../packages/sites/src/private-storage";
import {
  ProtectedGroupStore,
  RegistryIntegrityError,
} from "../packages/groups/src/storage";
import { formPayload } from "./fixtures/site-form";
import { projectTemp } from "./project-temp";
const allow = () => {},
  protocol = createSiteContributionProtocol(nodeCertificateCrypto),
  registry = createContributionInboxProtocol(nodeCertificateCrypto);
function fixture() {
  const directory = projectTemp("contribution-inbox-"),
    path = join(directory, "profile.sqlite"),
    owner = createIdentity("Owner"),
    visitor = createIdentity("Visitor"),
    now = Date.now(),
    content = createSiteContentProtocol(nodeCertificateCrypto).create(
      owner,
      "profile",
      1,
      [],
      formPayload(),
    ),
    source = createBundleAt(
      owner,
      "site",
      content,
      [visitor.public],
      3600000,
      now,
    ),
    context = createContributionContextResolver(nodeCertificateCrypto).resolve(
      {
        action: "form",
        snapshotId: source.manifest.id,
        pageId: "entry",
        formId: "form",
      },
      source,
      decryptStoredBundle(source, owner),
      visitor.public.id,
      now,
    ).context,
    database = new ProtectedGroupStore(path, owner, { create: true });
  const certificate = (
    operationId: string = randomUUID(),
    name = "PRIVATE_INBOX_VALUE_78415",
    expires = now + 60000,
  ) =>
    protocol.create(visitor, {
      target: context.target,
      schemaHash: protocol.schemaHash(context.form, context.table),
      operationId,
      created: now,
      expires,
      values: { name, count: 0, open: false },
      publicationScope: "public",
    });
  const envelope = (proposal = certificate()): Bundle =>
    createBundleAt(
      visitor,
      "site-contribution",
      { type: "site-contribution", proposal },
      [owner.public],
      proposal.body.expires - proposal.body.created,
      proposal.body.created,
    );
  return {
    directory,
    path,
    owner,
    visitor,
    now,
    source,
    database,
    certificate,
    envelope,
  };
}
test("private inbox preserves verified source and proposal across reopening, separately from sender staging", () => {
  const f = fixture();
  let db = f.database;
  try {
    const storeId = db.storeId(),
      c = new NodeContributionInbox(db, f.owner),
      cert = f.certificate(),
      bundle = f.envelope(cert),
      queue = new NodeContributionCatalog(db, f.owner),
      prepared = queue.prepare(
        {
          sequence: 1,
          operationId: randomUUID(),
          snapshotId: f.source.manifest.id,
          pageId: "entry",
          formId: "form",
          values: { name: "SEPARATE_SENDER_STAGE", count: 1, open: false },
          publicationScope: "public",
          ttlMs: 60000,
        },
        () => f.source,
        allow,
      );
    const received = c.admit(bundle, allow);
    assert.equal(received.outcome, "new");
    assert.equal(received.entry.phase, "missing-source");
    assert.equal(c.read(cert.id, allow)?.proposal, undefined);
    assert.equal(
      JSON.stringify(c.state()).includes("PRIVATE_INBOX_VALUE_78415"),
      false,
    );
    const verified = c.attachSource(cert.id, f.source, allow);
    assert.equal(verified.phase, "verified-candidate");
    assert.deepEqual(c.read(cert.id, allow)?.proposal, cert);
    assert.deepEqual(queue.state().operations, [prepared]);
    db.close();
    assert.equal(
      readFileSync(f.path).includes(Buffer.from("PRIVATE_INBOX_VALUE_78415")),
      false,
    );
    db = new ProtectedGroupStore(f.path, f.owner, { expectedStoreId: storeId });
    const reopened = new NodeContributionInbox(db, f.owner),
      restored = reopened.read(cert.id, allow)!;
    assert.deepEqual(restored.proposal, cert);
    assert.equal(canonical(restored.source), canonical(f.source));
    assert.deepEqual(reopened.attachSource(cert.id, f.source, allow), verified);
    assert.equal(
      new NodeContributionCatalog(db, f.owner).state().operations[0].phase,
      "prepared",
    );
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("repackaging is idempotent and a conflicting visitor UUID cannot replace the original candidate", () => {
  const f = fixture();
  try {
    const c = new NodeContributionInbox(f.database, f.owner),
      cert = f.certificate(),
      first = c.admit(f.envelope(cert), allow);
    c.attachSource(cert.id, f.source, allow);
    const before = c.state(),
      repacked = f.envelope(cert);
    assert.notEqual(repacked.manifest.id, first.entry.proof!.bundleId);
    const repeated = c.admit(repacked, allow);
    assert.equal(repeated.outcome, "duplicate");
    assert.deepEqual(repeated.record, before);
    const conflict = f.certificate(
        cert.body.operationId,
        "DIFFERENT_VALUES",
        f.now + 120000,
      ),
      other = c.admit(f.envelope(conflict), allow);
    assert.equal(other.outcome, "conflict");
    assert.equal(other.record.entries.length, 1);
    assert.equal(other.entry.proof!.bundleId, first.entry.proof!.bundleId);
    assert.deepEqual(other.entry.conflicts, [
      { id: conflict.id, expires: conflict.body.expires },
    ]);
    assert.deepEqual(c.read(cert.id, allow)?.proposal, cert);
    assert.equal(c.read(conflict.id, allow), null);
    assert.deepEqual(c.admit(f.envelope(conflict), allow).record, other.record);
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("an interrupted admission/source transaction rolls back without losing the earlier proof", () => {
  const f = fixture();
  try {
    const c = new NodeContributionInbox(f.database, f.owner),
      cert = f.certificate(),
      bundle = f.envelope(cert),
      failing = {
        transaction<T>(fn: (tx: any) => T): T {
          return f.database.transaction((tx) => {
            fn(tx);
            throw Error("fixture before commit");
          });
        },
      },
      broken = new NodeContributionInbox(failing, f.owner);
    assert.throws(() => broken.admit(bundle, allow), /fixture before commit/);
    assert.equal(c.state().entries.length, 0);
    const admitted = c.admit(bundle, allow);
    assert.throws(
      () => broken.attachSource(cert.id, f.source, allow),
      /fixture before commit/,
    );
    assert.deepEqual(c.state().entries, [admitted.entry]);
    assert.equal(c.read(cert.id, allow)?.proposal, undefined);
    assert.equal(
      c.attachSource(cert.id, f.source, allow).phase,
      "verified-candidate",
    );
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("expiry removes private payloads but keeps replay metadata for the bounded retention window", () => {
  const f = fixture();
  let now = f.now;
  try {
    const c = new NodeContributionInbox(f.database, f.owner, () => now),
      cert = f.certificate();
    c.admit(f.envelope(cert), allow);
    c.attachSource(cert.id, f.source, allow);
    now = cert.body.expires;
    assert.equal(c.state().entries[0].phase, "expired");
    assert.equal(c.read(cert.id, allow)?.proposal, undefined);
    f.database.transaction((tx) =>
      SitePrivateRecords.runContributionInbox(tx, f.owner, (v) =>
        assert.equal(v.read("contribution-inbox:" + cert.id + ":stage"), null),
      ),
    );
    assert.throws(() => c.admit(f.envelope(cert), allow), /prazo/);
    now += CONTRIBUTION_INBOX_LIMITS.retentionMs - 1;
    assert.equal(c.state().entries.length, 1);
    now++;
    assert.equal(c.state().entries.length, 0);
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("unreadable/public proposals, wrong source and revoked policy never become verified candidates", () => {
  const f = fixture();
  let now = f.now;
  try {
    const c = new NodeContributionInbox(f.database, f.owner, () => now),
      cert = f.certificate(),
      bundle = f.envelope(cert);
    const publicBundle = createBundleAt(
      f.visitor,
      "site-contribution",
      { type: "site-contribution", proposal: cert },
      "public",
      60000,
      f.now,
    );
    assert.throws(() => c.admit(publicBundle, allow));
    const outsider = createIdentity("Wrong recipient"),
      other = createBundleAt(
        f.visitor,
        "site-contribution",
        { type: "site-contribution", proposal: cert },
        [outsider.public],
        60000,
        f.now,
      );
    assert.throws(() => c.admit(other, allow));
    assert.equal(c.state().entries.length, 0);
    c.admit(bundle, allow);
    assert.throws(() => c.attachSource(cert.id, bundle, allow));
    assert.throws(
      () =>
        c.attachSource(cert.id, f.source, () => {
          throw Error("blocked");
        }),
      /blocked/,
    );
    assert.equal(c.state().entries[0].phase, "missing-source");
    c.attachSource(cert.id, f.source, allow);
    assert.throws(
      () =>
        c.read(cert.id, () => {
          now = cert.body.expires;
        }),
      /expirada/,
    );
    assert.equal(
      c.state().entries[0].phase,
      "expired",
      "normal expiry must not invalidate the encrypted session",
    );
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("tampered retained evidence is an integrity failure, never repaired into a new proposal", () => {
  const f = fixture();
  try {
    const c = new NodeContributionInbox(f.database, f.owner),
      cert = f.certificate();
    c.admit(f.envelope(cert), allow);
    c.attachSource(cert.id, f.source, allow);
    f.database.transaction((tx) =>
      SitePrivateRecords.runContributionInbox(tx, f.owner, (v) => {
        const key = "contribution-inbox:" + cert.id + ":stage",
          proof = v.read(key) as any;
        proof.envelope.manifest.signature = "A".repeat(88);
        v.write(key, proof);
      }),
    );
    assert.throws(() => c.read(cert.id, allow), RegistryIntegrityError);
    assert.throws(() => c.state(), /Registo fechado/);
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("journal quotas preserve pending entries and conflict floods have bounded descriptors and writes", () => {
  const f = fixture();
  try {
    let record = registry.initial(f.owner.public.id);
    const proof = {
        bundleId: "1".repeat(64),
        envelopeHash: "2".repeat(64),
        digest: "3".repeat(64),
        bytes: 100,
      },
      first = f.certificate();
    record = registry.observe(
      record,
      f.owner.public.id,
      first,
      proof,
      f.now,
    ).record;
    for (let i = 1; i < CONTRIBUTION_INBOX_LIMITS.pendingPerContributor; i++)
      record = registry.observe(
        record,
        f.owner.public.id,
        f.certificate(),
        proof,
        f.now,
      ).record;
    const before = canonical(record);
    assert.throws(
      () =>
        registry.observe(
          record,
          f.owner.public.id,
          f.certificate(),
          proof,
          f.now,
        ),
      /quota/,
    );
    assert.equal(canonical(record), before);
    for (let i = 0; i < 20; i++)
      record = registry.observe(
        record,
        f.owner.public.id,
        f.certificate(first.body.operationId, "conflict-" + i),
        proof,
        f.now,
      ).record;
    assert.equal(
      record.entries[0].conflicts.length,
      CONTRIBUTION_INBOX_LIMITS.conflicts,
    );
    assert.equal(record.entries[0].conflictOverflow, true);
    assert.equal(
      record.revision,
      CONTRIBUTION_INBOX_LIMITS.pendingPerContributor +
        CONTRIBUTION_INBOX_LIMITS.conflicts +
        1,
    );
    const later = f.certificate(
      first.body.operationId,
      "longer conflicting certificate",
      f.now + 120000,
    );
    const extended = registry.observe(
      record,
      f.owner.public.id,
      later,
      proof,
      f.now,
    ).record;
    assert.equal(
      extended.entries[0].retainUntil,
      later.body.expires + CONTRIBUTION_INBOX_LIMITS.retentionMs,
    );
    assert.equal(extended.entries[0].id, first.id);
    const changed = structuredClone(record);
    changed.entries[0].target.formId = "changed";
    assert.throws(
      () => registry.observe(changed, f.owner.public.id, first, proof, f.now),
      /certificado diferente/i,
    );
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
