import { createContributionReceiptProtocol } from "../../packages/sites/src/contribution-receipt";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  createIdentity,
  createBundle,
  createBundleAt,
  decryptStoredBundle,
  decryptBundle,
  canonical,
} from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../../packages/sites/src/content";
import { createContributionOperations } from "../../packages/sites/src/contribution-operations";
import { NodeContributionCatalog } from "../../packages/sites/src/contribution-catalog";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { SitePrivateRecords } from "../../packages/sites/src/private-storage";
import { formPayload } from "../fixtures/site-form";
import { projectTemp } from "../project-temp";
let executable: string;
function binary() {
  if (executable) return executable;
  mkdirSync(".cache/contribution-catalog-interop", { recursive: true });
  executable = resolve(
    ".cache/contribution-catalog-interop",
    process.platform === "win32" ? "sites.test.exe" : "sites.test",
  );
  const built = spawnSync(
    process.execPath,
    [
      "scripts/go.mjs",
      "test",
      "-c",
      "-race",
      "-p=1",
      "-o",
      executable,
      "./sites",
    ],
    { encoding: "utf8", timeout: 120000, maxBuffer: 128 * 1024 },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  return executable;
}
const allow = () => {};
function fixture(limited = false) {
  const directory = projectTemp("contribution-catalog-interop-"),
    identity = createIdentity("Visitante Node Go"),
    author = createIdentity("Dona da página"),
    databasePath = join(directory, "profile.sqlite");
  const store = new ProtectedGroupStore(databasePath, identity, {
      create: true,
      ...(limited
        ? { limits: { totalBytes: 128 * 1024, reserveBytes: 8192 } }
        : {}),
    }),
    storeId = store.storeId();
  const payload = formPayload([identity.public.id]),
    content = createSiteContentProtocol(nodeCertificateCrypto).create(
      author,
      "profile",
      1,
      [],
      payload,
    ),
    source = createBundle(author, "site", content, [identity.public]);
  const now = Date.now(),
    request = {
      sequence: 1,
      operationId: randomUUID(),
      snapshotId: source.manifest.id,
      pageId: "entry",
      formId: "form",
      values: {
        name: "INTEROP_PRIVATE_CONTRIBUTION_47290",
        count: 0,
        open: false,
      },
      publicationScope: [identity.public.id, author.public.id].sort(),
      ttlMs: 60000,
    };
  const fingerprint = createContributionOperations(
      nodeCertificateCrypto,
    ).request(request, identity.public.id).fingerprint,
    handle = { sequence: 1, operationId: request.operationId, fingerprint };
  return {
    directory,
    identity,
    author,
    databasePath,
    storeId,
    store,
    payload,
    content,
    source,
    now,
    request,
    handle,
  };
}
type Fixture = ReturnType<typeof fixture>;
function run(
  f: Fixture,
  commands: any[],
  options: Record<string, unknown> = {},
) {
  const path = join(f.directory, "control-" + randomUUID() + ".json");
  writeFileSync(
    path,
    JSON.stringify({
      database: f.databasePath,
      storeId: f.storeId,
      identity: f.identity,
      source: f.source,
      now: f.now,
      commands,
      ...options,
    }),
    { mode: 0o600 },
  );
  const result = spawnSync(
    binary(),
    ["-test.run=^TestContributionCatalogWorker$", "-test.v"],
    {
      cwd: resolve("native/sites"),
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 128 * 1024,
      env: { ...process.env, RELAYLOOM_CONTRIBUTION_CATALOG_CONTROL: path },
    },
  );
  if (options.mode) {
    return result;
  }
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(readFileSync(path + ".result.json", "utf8"));
}
const reopen = (f: Fixture) =>
  new ProtectedGroupStore(f.databasePath, f.identity, {
    expectedStoreId: f.storeId,
  });
for (const first of ["node", "go"] as const)
  test(`${first} prepares without signing; the other runtime resumes the same private intent and certificate`, () => {
    const f = fixture();
    let db = f.store;
    try {
      let prepared: any;
      if (first === "node")
        prepared = new NodeContributionCatalog(
          db,
          f.identity,
          () => f.now,
        ).prepare(f.request, () => f.source, allow);
      db.close();
      if (first === "go")
        prepared = run(f, [
          { action: "prepare", request: f.request },
          { action: "certificate", handle: f.handle },
        ])[0];
      assert.equal(prepared.phase, "prepared");
      db = reopen(f);
      let catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.deepEqual(catalog.state().operations, [prepared]);
      assert.equal(catalog.authorizedCertificate(prepared, allow), null);
      assert.equal(
        readFileSync(f.databasePath).includes(
          Buffer.from(f.request.values.name),
        ),
        false,
      );
      let signed: any, certificate: any;
      if (first === "go") {
        signed = catalog.sign(prepared, allow);
        certificate = catalog.authorizedCertificate(signed, allow);
      }
      db.close();
      if (first === "node")
        [signed, certificate] = run(
          f,
          [
            { action: "sign", handle: f.handle },
            { action: "certificate", handle: f.handle },
          ],
          { denyLoad: true },
        );
      const retained = run(
        f,
        [
          { action: "prepare", request: f.request },
          { action: "sign", handle: f.handle },
          { action: "certificate", handle: f.handle },
        ],
        { denyLoad: true },
      );
      assert.deepEqual(retained, [signed, signed, certificate]);
      db = reopen(f);
      catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.deepEqual(
        catalog.prepare(
          f.request,
          () => {
            throw Error("Do not reload source");
          },
          allow,
        ),
        signed,
      );
      assert.deepEqual(
        catalog.authorizedCertificate(signed, allow),
        certificate,
      );
      assert.equal(certificate.body.created, prepared.created);
      assert.equal(certificate.body.expires, prepared.expires);
      assert.deepEqual(certificate.body.values, f.request.values);
      assert.equal(certificate.body.contributor.id, f.identity.public.id);
      db.close();
      assert.deepEqual(
        run(
          f,
          [{ action: "certificate", handle: f.handle, expectError: true }],
          { blocked: true },
        ),
        [{ error: true }],
      );
      const cancelled = run(f, [
        { action: "cancel", handle: f.handle },
        { action: "certificate", handle: f.handle },
      ]);
      assert.equal(cancelled[0].phase, "cancelled");
      assert.equal(cancelled[1], null);
      db = reopen(f);
      catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.equal(
        catalog.prepare(f.request, () => f.source, allow).phase,
        "cancelled",
      );
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const mode of [
  "before-intent-commit",
  "after-intent",
  "before-signature-commit",
  "after-signature",
] as const)
  test(`real Go process exit ${mode} leaves exactly the committed state for Node recovery`, () => {
    const f = fixture();
    let db = f.store;
    try {
      let prepared: any;
      if (mode.includes("signature"))
        prepared = new NodeContributionCatalog(
          db,
          f.identity,
          () => f.now,
        ).prepare(f.request, () => f.source, allow);
      db.close();
      const command = mode.includes("signature")
        ? { action: "sign", handle: f.handle }
        : { action: "prepare", request: f.request };
      const child = run(f, [command], { mode });
      assert.equal(
        child.status,
        {
          "before-intent-commit": 81,
          "after-intent": 82,
          "before-signature-commit": 83,
          "after-signature": 84,
        }[mode],
        child.stdout + child.stderr,
      );
      db = reopen(f);
      const catalog = new NodeContributionCatalog(db, f.identity, () => f.now),
        state = catalog.state();
      if (mode === "before-intent-commit") {
        assert.equal(state.nextSequence, 1);
        assert.equal(state.operations.length, 0);
      } else {
        assert.equal(state.nextSequence, 2);
        assert.equal(
          state.operations[0].phase,
          mode === "after-signature" ? "signed" : "prepared",
        );
      }
      prepared = catalog.prepare(f.request, () => f.source, allow);
      const signed = catalog.sign(prepared, allow),
        certificate = catalog.authorizedCertificate(signed, allow);
      db.close();
      const [go] = run(f, [{ action: "certificate", handle: f.handle }], {
        denyLoad: true,
      });
      assert.deepEqual(go, certificate);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("Go catalogue honors expiry without renewing, rejects another request and preserves a new monotonic sequence", () => {
  const f = fixture();
  let db = f.store;
  try {
    db.close();
    const prepared = run(f, [
      { action: "prepare", request: f.request },
      { action: "sign", handle: f.handle },
    ])[0];
    const result = run(
      f,
      [
        { action: "state" },
        { action: "prepare", request: f.request },
        { action: "certificate", handle: f.handle },
      ],
      { now: prepared.expires, denyLoad: true },
    );
    assert.equal(result[0].operations[0].phase, "expired");
    assert.equal(result[1].phase, "expired");
    assert.equal(result[2], null);
    db = reopen(f);
    const catalog = new NodeContributionCatalog(
      db,
      f.identity,
      () => prepared.expires,
    );
    assert.equal(catalog.state().operations[0].phase, "expired");
    db.close();
    const q = { ...f.request, sequence: 2, operationId: randomUUID() },
      next = run(f, [{ action: "prepare", request: q }], {
        now: prepared.expires + 1,
      })[0];
    assert.equal(next.sequence, 2);
    assert.deepEqual(
      run(f, [
        {
          action: "prepare",
          request: { ...q, values: { ...q.values, name: "other" } },
          expectError: true,
        },
      ]),
      [{ error: true }],
    );
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
for (const corruption of ["stage", "record"] as const)
  test(`Go refuses authenticated-but-inconsistent ${corruption} without replacing the preparation`, () => {
    const f = fixture();
    let db = f.store;
    try {
      const op = new NodeContributionCatalog(
        db,
        f.identity,
        () => f.now,
      ).prepare(f.request, () => f.source, allow);
      db.transaction((tx) =>
        SitePrivateRecords.runContribution(tx, f.identity, (values) => {
          const key = tx
            .keys("contribution:")
            .find((k) => k.endsWith(":" + corruption))!;
          if (corruption === "stage") values.remove(key);
          else {
            const value: any = values.read(key);
            value.operations = [];
            values.write(key, value);
          }
        }),
      );
      db.close();
      assert.deepEqual(run(f, [{ action: "state", expectError: true }]), [
        { error: true },
      ]);
      db = reopen(f);
      assert.throws(() =>
        new NodeContributionCatalog(db, f.identity, () => f.now).prepare(
          f.request,
          () => f.source,
          allow,
        ),
      );
      assert.equal(op.sequence, 1);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("Go quota refusal leaves no proposal counter/stage and allows the original smaller request", () => {
  const f = fixture(true);
  let db = f.store;
  try {
    db.close();
    const payload = {
        ...f.payload,
        attachments: [
          {
            name: "synthetic.png",
            mime: "image/png",
            data: Buffer.alloc(256 * 1024, 7).toString("base64"),
          },
        ],
      },
      content = createSiteContentProtocol(nodeCertificateCrypto).create(
        f.author,
        "large",
        1,
        [],
        payload,
      ),
      source = createBundle(f.author, "site", content, [f.identity.public]);
    const result = run(
      f,
      [
        {
          action: "prepare",
          request: { ...f.request, snapshotId: source.manifest.id },
          expectError: true,
        },
        { action: "state" },
      ],
      { source },
    );
    assert.equal(result[1].nextSequence, 1);
    assert.deepEqual(result[1].operations, []);
    db = reopen(f);
    const catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
    assert.equal(catalog.prepare(f.request, () => f.source, allow).sequence, 1);
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const delta of [-1, 0])
  test(`Go policy clock boundary ${delta}ms rechecks the actual proposal handle`, () => {
    const f = fixture();
    let db = f.store;
    try {
      const catalog = new NodeContributionCatalog(db, f.identity, () => f.now),
        op = catalog.prepare(
          { ...f.request, ttlMs: 1000 },
          () => f.source,
          allow,
        );
      db.close();
      const result = run(
        f,
        [
          {
            action: "sign",
            handle: op,
            ...(delta === 0 ? { expectError: true } : {}),
          },
        ],
        { policyNow: op.expires + delta },
      );
      if (delta === 0) assert.deepEqual(result, [{ error: true }]);
      else assert.equal(result[0].phase, "signed");
      db = reopen(f);
      const reopened = new NodeContributionCatalog(
        db,
        f.identity,
        () => op.expires,
      );
      assert.equal(reopened.state().operations[0].phase, "expired");
      assert.equal(reopened.authorizedCertificate(op, allow), null);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

for (const first of ["node", "go"] as const)
  test(`${first} seals a private envelope once and the other engine recovers its exact bytes and fixed deadline`, () => {
    const f = fixture();
    let db = f.store;
    try {
      let catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      const prepared = catalog.prepare(f.request, () => f.source, allow),
        signed = catalog.sign(prepared, allow);
      assert.equal(catalog.authorizedBundle(signed, allow), null);
      let sealed: any, bundle: any;
      if (first === "node") {
        sealed = catalog.seal(signed, allow);
        bundle = catalog.authorizedBundle(signed, allow);
      }
      db.close();
      if (first === "go")
        [sealed, bundle] = run(
          f,
          [
            { action: "seal", handle: f.handle },
            { action: "bundle", handle: f.handle },
          ],
          { denyLoad: true },
        );
      assert.equal(bundle.manifest.id, sealed.bundleId);
      assert.equal(bundle.manifest.created, prepared.created);
      assert.equal(bundle.manifest.expires, prepared.expires);
      assert.equal(bundle.manifest.publicKey, null);
      assert.deepEqual(
        bundle.manifest.keys.map((k: any) => k.reader).sort(),
        [f.author.public.id, f.identity.public.id].sort(),
      );
      assert.equal(
        (decryptBundle(bundle, f.author) as any).proposal.body.values.name,
        f.request.values.name,
      );
      const foreign = createIdentity("No envelope key");
      assert.throws(() => decryptBundle(bundle, foreign));
      const reopened = run(
        f,
        [
          { action: "seal", handle: f.handle },
          { action: "bundle", handle: f.handle },
        ],
        { denyLoad: true },
      );
      assert.deepEqual(reopened, [sealed, bundle]);
      db = reopen(f);
      catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.deepEqual(catalog.seal(signed, allow), sealed);
      assert.deepEqual(catalog.authorizedBundle(signed, allow), bundle);
      assert.equal(
        readFileSync(f.databasePath).includes(
          Buffer.from(f.request.values.name),
        ),
        false,
      );
      db.close();
      assert.deepEqual(
        run(f, [{ action: "bundle", handle: f.handle, expectError: true }], {
          blocked: true,
        }),
        [{ error: true }],
      );
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const mode of ["before-envelope-commit", "after-envelope"] as const)
  test(`Go abrupt exit ${mode} preserves only a committed encrypted envelope`, () => {
    const f = fixture();
    let db = f.store;
    try {
      let catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      const signed = catalog.sign(
        catalog.prepare(f.request, () => f.source, allow),
        allow,
      );
      db.close();
      const child = run(f, [{ action: "seal", handle: f.handle }], { mode });
      assert.equal(
        child.status,
        mode === "before-envelope-commit" ? 85 : 86,
        child.stdout + child.stderr,
      );
      db = reopen(f);
      catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
      const before = catalog.authorizedBundle(signed, allow);
      assert.equal(before === null, mode === "before-envelope-commit");
      const sealed = catalog.seal(signed, allow),
        bundle = catalog.authorizedBundle(signed, allow)!;
      if (before) assert.deepEqual(bundle, before);
      assert.equal(bundle.manifest.id, sealed.bundleId);
      assert.equal(bundle.manifest.expires, signed.expires);
      db.close();
      assert.deepEqual(
        run(f, [{ action: "bundle", handle: f.handle }])[0],
        bundle,
      );
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("both catalogues reject a corrupted retained envelope without falling back to a fresh nonce", () => {
  const f = fixture();
  let db = f.store;
  try {
    const catalog = new NodeContributionCatalog(db, f.identity, () => f.now),
      signed = catalog.sign(
        catalog.prepare(f.request, () => f.source, allow),
        allow,
      );
    catalog.seal(signed, allow);
    db.transaction((tx) =>
      SitePrivateRecords.runContribution(tx, f.identity, (values) => {
        const key = tx.keys("contribution:").find((k) => k.endsWith(":stage"))!,
          stage: any = values.read(key);
        stage.envelope.manifest.signature = "A".repeat(88);
        values.write(key, stage);
      }),
    );
    db.close();
    assert.deepEqual(
      run(f, [{ action: "seal", handle: f.handle, expectError: true }]),
      [{ error: true }],
    );
    db = reopen(f);
    const reopened = new NodeContributionCatalog(db, f.identity, () => f.now);
    assert.throws(() => reopened.seal(signed, allow));
    assert.throws(() => reopened.authorizedBundle(signed, allow));
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test(
  "a Node sealer waits on the real Go writer transaction and recovers the envelope committed by that writer",
  { timeout: 30000 },
  async () => {
    const f = fixture();
    let db = f.store;
    const children: ReturnType<typeof spawn>[] = [];
    const waitFor = async (check: () => boolean) => {
      const end = Date.now() + 8000;
      while (!check()) {
        if (Date.now() > end) throw Error("owned writer fixture deadline");
        await delay(10);
      }
    };
    try {
      const catalog = new NodeContributionCatalog(db, f.identity, () => f.now),
        signed = catalog.sign(
          catalog.prepare(f.request, () => f.source, allow),
          allow,
        );
      db.close();
      const path = join(f.directory, "concurrent-seal.json");
      writeFileSync(
        path,
        JSON.stringify({
          database: f.databasePath,
          storeId: f.storeId,
          identity: f.identity,
          source: f.source,
          now: f.now,
          handle: f.handle,
          holdBeforeCommit: true,
          commands: [{ action: "seal", handle: f.handle }],
        }),
        { mode: 0o600 },
      );
      const start = (
        command: string,
        args: string[],
        env = process.env,
        cwd = process.cwd(),
      ) => {
        const child = spawn(command, args, {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.push(child);
        let out = "",
          err = "";
        child.stdout!.on("data", (b) => (out += b));
        child.stderr!.on("data", (b) => (err += b));
        const done = new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(Error("owned writer failed " + code + " " + out + err)),
          );
        });
        void done.catch(() => {});
        return { child, done, stdout: () => out };
      };
      const go = start(
        binary(),
        ["-test.run=^TestContributionCatalogWorker$", "-test.v"],
        { ...process.env, RELAYLOOM_CONTRIBUTION_CATALOG_CONTROL: path },
        resolve("native/sites"),
      );
      await waitFor(() => existsSync(join(f.directory, "envelope-held")));
      const node = start(process.execPath, [
        "--import",
        "tsx",
        "tests/fixtures/contribution-seal-writer.ts",
        path,
      ]);
      await waitFor(() => node.stdout().includes("SEALING"));
      await delay(100);
      assert.equal(
        existsSync(path + ".node-result.json"),
        false,
        "second writer escaped the first uncommitted transaction",
      );
      assert.equal(node.child.exitCode, null);
      assert.equal(go.child.exitCode, null);
      writeFileSync(
        join(f.directory, "envelope-release"),
        "release owned fixture",
        { mode: 0o600 },
      );
      await Promise.all([go.done, node.done]);
      const first = JSON.parse(readFileSync(path + ".result.json", "utf8"))[0],
        second = JSON.parse(readFileSync(path + ".node-result.json", "utf8"));
      assert.deepEqual(second, first);
      db = reopen(f);
      const after = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.equal(after.state().nextSequence, 2);
      assert.equal(
        after.authorizedBundle(signed, allow)!.manifest.id,
        first.bundleId,
      );
    } finally {
      writeFileSync(join(f.directory, "envelope-release"), "cleanup release", {
        mode: 0o600,
      });
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await new Promise<void>((resolve) =>
            child.once("exit", () => resolve()),
          );
        }
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
);

test("repeated Go cancellation of an old operation cannot remove the current preparation", () => {
  const f = fixture();
  let db = f.store;
  try {
    const catalog = new NodeContributionCatalog(db, f.identity, () => f.now),
      first = catalog.prepare(f.request, () => f.source, allow);
    catalog.cancel(first);
    const second = catalog.prepare(
      { ...f.request, sequence: 2, operationId: randomUUID() },
      () => f.source,
      allow,
    );
    db.close();
    const result = run(f, [
      { action: "cancel", handle: first },
      { action: "sign", handle: second },
    ]);
    assert.equal(result[1].phase, "signed");
    db = reopen(f);
    assert.equal(
      new NodeContributionCatalog(db, f.identity, () => f.now).state()
        .nextSequence,
      3,
    );
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const creator of ["node", "go"] as const)
  test(`${creator} queues before public copying, recovers bytes and frees only its own preparation slot`, () => {
    const f = fixture();
    let db = f.store;
    try {
      let c = new NodeContributionCatalog(db, f.identity, () => f.now);
      const signed = c.sign(
        c.prepare(f.request, () => f.source, allow),
        allow,
      );
      c.seal(signed, allow);
      const bundle = c.authorizedBundle(signed, allow)!;
      let queued: any;
      if (creator === "node") queued = c.queue(signed, allow);
      db.close();
      if (creator === "go")
        queued = run(f, [{ action: "queue", handle: signed }])[0];
      const result = run(f, [
        { action: "bundle", handle: signed },
        { action: "source", handle: signed },
        { action: "copied", handle: signed, bundle },
      ]);
      assert.deepEqual(result[0], bundle);
      assert.deepEqual(result[1], f.source);
      assert.equal(result[2].transport.copied, true);
      const next = { ...f.request, sequence: 2, operationId: randomUUID() };
      const second = run(f, [{ action: "prepare", request: next }])[0];
      assert.equal(second.phase, "prepared");
      assert.equal(queued.phase, "queued");
      db = reopen(f);
      c = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.deepEqual(c.authorizedBundle(queued, allow), bundle);
      c.cancel(queued);
      c.cancel(queued);
      assert.equal(c.sign(second, allow).phase, "signed");
      db.close();
      assert.equal(run(f, [{ action: "state" }])[0].nextSequence, 3);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const mode of ["before-queue-commit", "after-queue"] as const)
  test(`Go exit ${mode} retains either the signed stage or its durable queued replacement`, () => {
    const f = fixture();
    let db = f.store;
    try {
      let c = new NodeContributionCatalog(db, f.identity, () => f.now);
      const signed = c.sign(
        c.prepare(f.request, () => f.source, allow),
        allow,
      );
      c.seal(signed, allow);
      const bundle = c.authorizedBundle(signed, allow);
      db.close();
      const child = run(f, [{ action: "queue", handle: signed }], { mode });
      assert.equal(
        child.status,
        mode === "before-queue-commit" ? 87 : 88,
        child.stdout + child.stderr,
      );
      db = reopen(f);
      c = new NodeContributionCatalog(db, f.identity, () => f.now);
      assert.equal(
        c.state().operations[0].phase,
        mode === "before-queue-commit" ? "signed" : "queued",
      );
      const queued = c.queue(signed, allow);
      assert.deepEqual(c.authorizedBundle(queued, allow), bundle);
      assert.equal(
        c.prepare(
          { ...f.request, sequence: 2, operationId: randomUUID() },
          () => f.source,
          allow,
        ).phase,
        "prepared",
      );
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

function copiedReceiptFixture(f: Fixture) {
  const catalog = new NodeContributionCatalog(f.store, f.identity, () => f.now),
    prepared = catalog.prepare(f.request, () => f.source, allow),
    signed = catalog.sign(prepared, allow);
  catalog.seal(signed, allow);
  const queued = catalog.queue(signed, allow),
    bundle = catalog.authorizedBundle(queued, allow)!;
  const copied = catalog.markCopied(queued, bundle),
    request = {
      contributorId: f.identity.public.id,
      certificateId: copied.certificateId!,
      operationId: copied.operationId,
      target: copied.target,
      proposalCreated: copied.created,
      proposalExpires: copied.expires,
      verifiedAt: f.now,
      created: f.now,
      expires: f.now + 3600000,
    },
    certificate = createContributionReceiptProtocol(
      nodeCertificateCrypto,
    ).create(f.author, request),
    receipt = createBundleAt(
      f.author,
      "site-contribution-receipt",
      { type: "site-contribution-receipt", receipt: certificate },
      [f.identity.public],
      3600000,
      f.now,
    );
  return { catalog, copied, bundle, certificate, receipt };
}
for (const backend of ["node", "go"] as const)
  for (const phase of ["queued", "cancelled", "expired"] as const)
    test(`${backend} admits historical owner receipt from ${phase}, removes only the original payload and preserves a new preparation`, () => {
      const f = fixture();
      let db = f.store;
      try {
        const setup = copiedReceiptFixture(f);
        if (phase === "cancelled") setup.catalog.cancel(setup.copied);
        const now = phase === "expired" ? setup.copied.expires : f.now;
        const clocked = new NodeContributionCatalog(db, f.identity, () => now);
        clocked.state();
        const next = clocked.prepare(
            { ...f.request, sequence: 2, operationId: randomUUID() },
            () => f.source,
            allow,
          ),
          before = clocked.state();
        db.close();
        const after =
          backend === "go"
            ? run(f, [{ action: "receive-receipt", bundle: setup.receipt }], {
                now,
              })[0]
            : (() => {
                db = reopen(f);
                try {
                  return new NodeContributionCatalog(
                    db,
                    f.identity,
                    () => now,
                  ).receiveReceipt(setup.receipt, allow);
                } finally {
                  db.close();
                }
              })();
        assert.equal(after.phase, phase === "queued" ? "received" : phase);
        assert.deepEqual(after.receipt, setup.certificate);
        assert.equal(after.expires, setup.copied.expires);
        db = reopen(f);
        const c = new NodeContributionCatalog(db, f.identity, () => now);
        assert.deepEqual(c.operation(2, next.operationId).operation, next);
        assert.deepEqual(c.receiveReceipt(setup.receipt, allow), after);
        assert.equal(c.state().nextSequence, before.nextSequence);
        assert.equal(
          db.transaction((tx) =>
            SitePrivateRecords.runContribution(tx, f.identity, (v) =>
              v.read("contribution:" + setup.copied.certificateId + ":stage"),
            ),
          ),
          null,
        );
        const source = decryptStoredBundle(f.source, f.identity);
        assert(source);
        db.close();
        assert.deepEqual(
          run(f, [{ action: "receive-receipt", bundle: setup.receipt }], {
            now,
          })[0],
          after,
        );
      } finally {
        db.close();
        rmSync(f.directory, { recursive: true, force: true });
      }
    });
for (const mode of ["before-receipt-commit", "after-receipt"] as const)
  test(`Go ${mode} leaves receipt and payload on the same side of the transaction boundary`, () => {
    const f = fixture();
    let db = f.store;
    try {
      const setup = copiedReceiptFixture(f);
      db.close();
      const child = run(
        f,
        [{ action: "receive-receipt", bundle: setup.receipt }],
        { mode },
      );
      assert.equal(
        child.status,
        mode === "before-receipt-commit" ? 91 : 92,
        child.stdout + child.stderr,
      );
      db = reopen(f);
      const c = new NodeContributionCatalog(db, f.identity, () => f.now),
        state = c.state().operations[0];
      assert.equal(
        state.phase,
        mode === "before-receipt-commit" ? "queued" : "received",
      );
      const payload = db.transaction((tx) =>
        SitePrivateRecords.runContribution(tx, f.identity, (v) =>
          v.read("contribution:" + setup.copied.certificateId + ":stage"),
        ),
      );
      assert.equal(payload !== null, mode === "before-receipt-commit");
      const done = c.receiveReceipt(setup.receipt, allow);
      assert.equal(done.phase, "received");
      assert.deepEqual(done.receipt, setup.certificate);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("uncopied or cross-reference receipts cannot release an authorised private proposal", () => {
  const f = fixture();
  let db = f.store;
  try {
    const setup = copiedReceiptFixture(f),
      receiptProtocol = createContributionReceiptProtocol(
        nodeCertificateCrypto,
      ),
      original = setup.certificate.body;
    const { domain: _d, owner: _o, ...intent } = original;
    const wrong = receiptProtocol.create(f.author, {
        ...intent,
        certificateId: "f".repeat(64),
      }),
      bundle = createBundleAt(
        f.author,
        "site-contribution-receipt",
        { type: "site-contribution-receipt", receipt: wrong },
        [f.identity.public],
        intent.expires - intent.created,
        intent.created,
      );
    assert.throws(() => setup.catalog.receiveReceipt(bundle, allow));
    assert.equal(setup.catalog.state().operations[0].phase, "queued");
    db.close();
    assert.deepEqual(
      run(f, [{ action: "receive-receipt", bundle, expectError: true }]),
      [{ error: true }],
    );
    db = reopen(f);
    db.transaction((tx) =>
      SitePrivateRecords.runContribution(tx, f.identity, (v) => {
        const key = tx
            .keys("contribution:")
            .find((k) => k.endsWith(":record"))!,
          record = v.read(key) as any;
        record.operations[0].transport.copied = false;
        v.write(key, record);
      }),
    );
    const c = new NodeContributionCatalog(db, f.identity, () => f.now);
    assert.throws(() => c.receiveReceipt(setup.receipt, allow));
    assert.equal(c.state().operations[0].phase, "queued");
    db.close();
    assert.deepEqual(
      run(f, [
        { action: "receive-receipt", bundle: setup.receipt, expectError: true },
      ]),
      [{ error: true }],
    );
  } finally {
    db.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const mode of ["before-receipt-commit", "after-receipt"] as const)
  test(`Node ${mode} preserves the receipt/payload boundary when reopened by Go`, () => {
    const f = fixture();
    let db = f.store;
    try {
      const setup = copiedReceiptFixture(f);
      db.close();
      const control = join(f.directory, "node-receive-control.json");
      writeFileSync(
        control,
        JSON.stringify({
          database: f.databasePath,
          storeId: f.storeId,
          identity: f.identity,
          now: f.now,
          bundle: setup.receipt,
          mode,
          output: control + ".result",
        }),
        { mode: 0o600 },
      );
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/fixtures/contribution-receive-worker.ts",
          control,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(
        child.status,
        mode === "before-receipt-commit" ? 93 : 94,
        child.stdout + child.stderr,
      );
      const state = run(f, [{ action: "state" }])[0].operations[0];
      assert.equal(
        state.phase,
        mode === "before-receipt-commit" ? "queued" : "received",
      );
      db = reopen(f);
      const payload = db.transaction((tx) =>
        SitePrivateRecords.runContribution(tx, f.identity, (v) =>
          v.read("contribution:" + setup.copied.certificateId + ":stage"),
        ),
      );
      assert.equal(payload !== null, mode === "before-receipt-commit");
      db.close();
      const final = run(f, [
        { action: "receive-receipt", bundle: setup.receipt },
      ])[0];
      assert.equal(final.phase, "received");
      assert.deepEqual(final.receipt, setup.certificate);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test(
  "concurrent Go and Node receipt receivers consume one private payload and agree on the retained first fact",
  { timeout: 30000 },
  async () => {
    const f = fixture(),
      children: ReturnType<typeof spawn>[] = [];
    let db = f.store;
    const releasePath = join(f.directory, "envelope-release");
    const start = (command: string, args: string[], env: NodeJS.ProcessEnv) => {
      const child = spawn(command, args, {
        env,
        cwd: resolve("native/sites"),
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let output = "";
      child.stdout?.on("data", (data) => {
        output = (output + data).slice(-16000);
      });
      child.stderr?.on("data", (data) => {
        output = (output + data).slice(-16000);
      });
      const done = new Promise<number | null>((done, fail) => {
        child.once("error", fail);
        child.once("close", done);
      });
      void done.catch(() => {});
      return { child, done, output: () => output };
    };
    try {
      const setup = copiedReceiptFixture(f);
      db.close();
      const control = join(f.directory, "go-receive-hold.json");
      writeFileSync(
        control,
        JSON.stringify({
          database: f.databasePath,
          storeId: f.storeId,
          identity: f.identity,
          source: f.source,
          now: f.now,
          holdBeforeCommit: true,
          commands: [{ action: "receive-receipt", bundle: setup.receipt }],
        }),
        { mode: 0o600 },
      );
      const go = start(
        binary(),
        ["-test.run=^TestContributionCatalogWorker$"],
        { ...process.env, RELAYLOOM_CONTRIBUTION_CATALOG_CONTROL: control },
      );
      const untilFile = async (path: string) => {
        const deadline = Date.now() + 5000;
        while (!existsSync(path) && Date.now() < deadline) await delay(10);
        assert(existsSync(path), "owned receipt writer marker missing");
      };
      await untilFile(join(f.directory, "envelope-held"));
      const nodeControl = join(f.directory, "node-receive-hold.json"),
        resultPath = nodeControl + ".result";
      writeFileSync(
        nodeControl,
        JSON.stringify({
          database: f.databasePath,
          storeId: f.storeId,
          identity: f.identity,
          now: f.now,
          bundle: setup.receipt,
          started: nodeControl + ".started",
          output: resultPath,
        }),
        { mode: 0o600 },
      );
      const node = start(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          resolve("tests/fixtures/contribution-receive-worker.ts"),
          nodeControl,
        ],
        process.env,
      );
      await untilFile(nodeControl + ".started");
      await delay(150);
      assert.equal(existsSync(resultPath), false);
      assert.equal(node.child.exitCode, null);
      writeFileSync(releasePath, "release owned Go receipt receiver", {
        mode: 0o600,
      });
      assert.equal(await go.done, 0, go.output());
      assert.equal(await node.done, 0, node.output());
      const g = JSON.parse(readFileSync(control + ".result.json", "utf8"))[0],
        n = JSON.parse(readFileSync(resultPath, "utf8"));
      assert.deepEqual(g, n);
      assert.equal(g.phase, "received");
      db = reopen(f);
      assert.equal(
        new NodeContributionCatalog(db, f.identity, () => f.now).state()
          .operations.length,
        1,
      );
      assert.equal(
        db.transaction((tx) =>
          SitePrivateRecords.runContribution(tx, f.identity, (v) =>
            v.read("contribution:" + setup.copied.certificateId + ":stage"),
          ),
        ),
        null,
      );
    } finally {
      if (!existsSync(releasePath))
        writeFileSync(releasePath, "release owned fixture for cleanup", {
          mode: 0o600,
        });
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const done = new Promise<void>((resolve) =>
            child.once("close", () => resolve()),
          );
          child.kill("SIGTERM");
          await done;
        }
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
);
