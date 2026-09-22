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
