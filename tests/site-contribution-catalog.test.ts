import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import {
  createIdentity,
  createBundle,
  ContentStore,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { createContributionContextResolver } from "../packages/sites/src/contribution-context";
import { createContributionOperations } from "../packages/sites/src/contribution-operations";
import { NodeContributionCatalog } from "../packages/sites/src/contribution-catalog";
import { SitePrivateRecords } from "../packages/sites/src/private-storage";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
import { formPayload } from "./fixtures/site-form";
import { projectTemp } from "./project-temp";
const allow = () => {},
  noSource = () => {
    throw Error("Retained intent must not reload source");
  };
function fixture() {
  const directory = projectTemp("contribution-catalog-"),
    identity = createIdentity("Visitante"),
    author = createIdentity("Dona"),
    path = join(directory, "profile.sqlite");
  const content = createSiteContentProtocol(nodeCertificateCrypto).create(
      author,
      "profile",
      1,
      [],
      formPayload([identity.public.id]),
    ),
    source = createBundle(author, "site", content, [identity.public]);
  const database = new ProtectedGroupStore(path, identity, { create: true }),
    storeId = database.storeId();
  const request = {
    sequence: 1,
    operationId: randomUUID(),
    snapshotId: source.manifest.id,
    pageId: "entry",
    formId: "form",
    values: {
      name: "PRIVATE_UNPUBLISHED_PROPOSAL_40512",
      count: 0,
      open: false,
    },
    publicationScope: [identity.public.id, author.public.id].sort(),
    ttlMs: 60000,
  };
  return {
    directory,
    path,
    identity,
    author,
    source,
    content,
    request,
    database,
    storeId,
  };
}
test("intent commits without a visitor signature; later signing survives reopen with private consent and no public store", () => {
  const f = fixture();
  let db = f.database;
  try {
    let catalog = new NodeContributionCatalog(db, f.identity);
    const op = catalog.prepare(f.request, () => f.source, allow);
    assert.equal(op.phase, "prepared");
    assert.equal(catalog.authorizedCertificate(op, allow), null);
    db.transaction((tx) =>
      SitePrivateRecords.runContribution(tx, f.identity, (values) => {
        const key = tx.keys("contribution:").find((k) => k.endsWith(":stage"))!;
        const stage: any = values.read(key);
        assert.equal(stage.certificate, null);
        assert.equal(stage.source.manifest.author.id, f.author.public.id);
        assert.notEqual(stage.source.manifest.author.id, f.identity.public.id);
      }),
    );
    assert.equal(
      readFileSync(f.path).includes(Buffer.from(f.request.values.name)),
      false,
    );
    assert.equal(new ContentStore(join(f.directory, "store")).list().length, 0);
    db.close();
    db = new ProtectedGroupStore(f.path, f.identity, {
      expectedStoreId: f.storeId,
    });
    catalog = new NodeContributionCatalog(db, f.identity);
    assert.deepEqual(catalog.prepare(f.request, noSource, allow), op);
    const signed = catalog.sign(op, allow),
      cert = catalog.authorizedCertificate(signed, allow)!;
    assert.equal(signed.phase, "signed");
    assert.equal(cert.body.created, op.created);
    assert.equal(cert.body.expires, op.expires);
    assert.deepEqual(cert.body.values, f.request.values);
    const context = createContributionContextResolver(
      nodeCertificateCrypto,
    ).resolve(
      {
        action: "form",
        snapshotId: f.source.manifest.id,
        pageId: "entry",
        formId: "form",
      },
      f.source,
      f.content,
      f.identity.public.id,
      op.created,
    ).context;
    const protocol = createSiteContributionProtocol(nodeCertificateCrypto);
    assert.ok(protocol.verifyForSubmission(cert, context, Date.now()));
    assert.throws(() => protocol.verifyPublicationScope(cert, "public"));
    db.close();
    db = new ProtectedGroupStore(f.path, f.identity, {
      expectedStoreId: f.storeId,
    });
    catalog = new NodeContributionCatalog(db, f.identity);
    assert.deepEqual(catalog.sign(op, allow), signed);
    assert.deepEqual(catalog.authorizedCertificate(signed, allow), cert);
    assert.throws(() =>
      catalog.authorizedCertificate(signed, () => {
        throw Error("blocked now");
      }),
    );
    assert.deepEqual(catalog.state().operations, [signed]);
    assert.equal(
      JSON.stringify(catalog.state()).includes(f.request.values.name),
      false,
    );
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test("failed transactions and changed policy retain a prepared intent without handing out a signature", () => {
  const f = fixture();
  try {
    const failing = {
      transaction<T>(fn: (tx: any) => T): T {
        return f.database.transaction((tx) => {
          fn(tx);
          throw Error("failed before commit");
        });
      },
    };
    const broken = new NodeContributionCatalog(failing, f.identity),
      catalog = new NodeContributionCatalog(f.database, f.identity);
    assert.throws(
      () => broken.prepare(f.request, () => f.source, allow),
      /before commit/,
    );
    assert.equal(catalog.state().nextSequence, 1);
    const op = catalog.prepare(f.request, () => f.source, allow);
    assert.throws(
      () =>
        catalog.sign(op, () => {
          throw Error("owner blocked");
        }),
      /blocked/,
    );
    assert.equal(catalog.authorizedCertificate(op, allow), null);
    assert.throws(() => broken.sign(op, allow), /before commit/);
    assert.equal(catalog.state().operations[0].phase, "prepared");
    assert.equal(catalog.sign(op, allow).phase, "signed");
    assert.throws(() =>
      catalog.prepare(
        { ...f.request, values: { ...f.request.values, name: "different" } },
        noSource,
        allow,
      ),
    );
    assert.throws(() =>
      catalog.prepare(
        { ...f.request, sequence: 2, operationId: randomUUID() },
        () => f.source,
        allow,
      ),
    );
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test("expiry and cancellation keep retired sequence outcomes and never renew a signature", () => {
  const f = fixture();
  let now = Date.now();
  try {
    const catalog = new NodeContributionCatalog(
        f.database,
        f.identity,
        () => now,
      ),
      q = { ...f.request, ttlMs: 1000 };
    const op = catalog.prepare(q, () => f.source, allow);
    const signed = catalog.sign(op, allow);
    now = op.expires;
    assert.equal(catalog.state().operations[0].phase, "expired");
    assert.equal(catalog.authorizedCertificate(signed, allow), null);
    assert.equal(catalog.prepare(q, noSource, allow).phase, "expired");
    now += 1;
    const next = catalog.prepare(
      { ...q, sequence: 2, operationId: randomUUID(), ttlMs: 60000 },
      () => f.source,
      allow,
    );
    assert.equal(catalog.cancel(next).phase, "cancelled");
    assert.equal(catalog.cancel(next).phase, "cancelled");
    assert.equal(catalog.authorizedCertificate(next, allow), null);
    const registry = createContributionOperations(nodeCertificateCrypto);
    let record = registry.initial(f.identity.public.id);
    const context = createContributionContextResolver(
      nodeCertificateCrypto,
    ).resolve(
      {
        action: "form",
        snapshotId: f.source.manifest.id,
        pageId: "entry",
        formId: "form",
      },
      f.source,
      f.content,
      f.identity.public.id,
      now,
    ).context;
    for (let i = 1; i <= 130; i++) {
      const made = registry.prepare(
        record,
        f.identity.public.id,
        {
          ...f.request,
          sequence: i,
          operationId: i === 1 ? f.request.operationId : randomUUID(),
        },
        context,
        now,
      );
      record = registry.cancel(
        made.record,
        f.identity.public.id,
        made.operation,
      );
    }
    assert.equal(record.operations.length, 128);
    assert.equal(record.nextSequence, 131);
    for (const edited of [
      { ...record, operations: record.operations.slice(1) },
      { ...record, operations: record.operations.slice(0, -1) },
      { ...record, nextSequence: 132 },
      {
        ...record,
        operations: record.operations.map((op, i) =>
          i === 1 ? { ...op, sequence: op.sequence + 1 } : op,
        ),
      },
    ])
      assert.throws(() => registry.validate(edited, f.identity.public.id));

    assert.equal(
      registry.lookup(record, f.identity.public.id, 1, f.request.operationId)
        .retired,
      true,
    );
    assert.throws(() =>
      registry.prepare(record, f.identity.public.id, f.request, context, now),
    );
    const counterfeit = structuredClone(record);
    counterfeit.operations[0].phase = "signed";
    assert.throws(() => registry.validate(counterfeit, f.identity.public.id));
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
for (const mode of ["missing-stage", "wrong-source", "read-key"] as const)
  test(`private contribution storage refuses ${mode} without resetting an intent`, () => {
    const f = fixture();
    try {
      const catalog = new NodeContributionCatalog(f.database, f.identity),
        op = catalog.prepare(f.request, () => f.source, allow);
      if (mode === "read-key") {
        const other = createIdentity("Foreign signer"),
          fake = { ...f.identity, signSecret: other.signSecret };
        assert.throws(() =>
          new NodeContributionCatalog(f.database, fake).state(),
        );
        // An integrity failure intentionally poisons this open database session.
        // Reopen with the legitimate owner to prove the durable intent survived.
        f.database.close();
        const recovered = new ProtectedGroupStore(f.path, f.identity, {
          expectedStoreId: f.storeId,
        });
        try {
          assert.equal(
            new NodeContributionCatalog(recovered, f.identity).state()
              .operations[0].sequence,
            op.sequence,
          );
        } finally {
          recovered.close();
        }
        return;
      }
      f.database.transaction((tx) =>
        SitePrivateRecords.runContribution(tx, f.identity, (values) => {
          const key = tx
            .keys("contribution:")
            .find((k) => k.endsWith(":stage"))!;
          if (mode === "missing-stage") values.remove(key);
          else {
            const raw: any = values.read(key);
            raw.source.manifest.author = f.identity.public;
            values.write(key, raw);
          }
        }),
      );
      assert.throws(() => catalog.state());
      assert.throws(() => catalog.prepare(f.request, noSource, allow));
    } finally {
      f.database.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const mode of [
  "before-intent-commit",
  "after-intent",
  "after-signature",
] as const)
  test(`real abrupt process exit ${mode} preserves the intent and fixed certificate identity`, () => {
    const f = fixture();
    let db = f.database;
    try {
      db.close();
      const control = join(f.directory, "fixture.json");
      writeFileSync(
        control,
        JSON.stringify({ ...f, database: undefined, mode }),
        { mode: 0o600 },
      );
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/contribution-crash.ts", control],
        { encoding: "utf8", timeout: 20000 },
      );
      if (process.platform === "win32")
        assert.equal(child.status, 86, child.stderr);
      else assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.equal(child.stdout.trim(), mode);
      db = new ProtectedGroupStore(f.path, f.identity, {
        expectedStoreId: f.storeId,
      });
      const catalog = new NodeContributionCatalog(db, f.identity),
        state = catalog.state();
      if (mode === "before-intent-commit") {
        assert.equal(state.nextSequence, 1);
        assert.equal(state.operations.length, 0);
      } else {
        assert.equal(state.nextSequence, 2);
        assert.equal(
          state.operations[0].phase,
          mode === "after-intent" ? "prepared" : "signed",
        );
      }
      const op = catalog.prepare(f.request, () => f.source, allow),
        signed = catalog.sign(op, allow),
        cert = catalog.authorizedCertificate(signed, allow)!;
      assert.equal(cert.body.operationId, f.request.operationId);
      assert.equal(cert.body.created, op.created);
      assert.equal(cert.body.expires, op.expires);
      assert.deepEqual(
        catalog.authorizedCertificate(catalog.sign(op, allow), allow),
        cert,
      );
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("preparation quota failure rolls back stage and sequence before any signature exists", () => {
  const f = fixture(),
    db = new ProtectedGroupStore(
      join(f.directory, "limited.sqlite"),
      f.identity,
      { create: true, limits: { totalBytes: 128 * 1024, reserveBytes: 8192 } },
    );
  try {
    const payload = {
      ...formPayload([f.identity.public.id]),
      attachments: [
        {
          name: "synthetic.png",
          mime: "image/png",
          data: Buffer.alloc(256 * 1024, 7).toString("base64"),
        },
      ],
    };
    const content = createSiteContentProtocol(nodeCertificateCrypto).create(
        f.author,
        "large",
        1,
        [],
        payload,
      ),
      source = createBundle(f.author, "site", content, [f.identity.public]);
    const catalog = new NodeContributionCatalog(db, f.identity),
      before = catalog.state();
    assert.throws(() =>
      catalog.prepare(
        { ...f.request, snapshotId: source.manifest.id },
        () => source,
        allow,
      ),
    );
    assert.deepEqual(catalog.state(), before);
    assert.equal(
      db.view((tx) => tx.keys("contribution:").length),
      0,
    );
    const valid = catalog.prepare(f.request, () => f.source, allow);
    assert.equal(valid.sequence, 1);
    assert.equal(valid.phase, "prepared");
  } finally {
    db.close();
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
