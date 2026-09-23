import { createContributionRejectionProtocol } from "../../packages/sites/src/contribution-rejection";
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
function copiedRejectionFixture(f: Fixture) {
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
      decidedAt: f.now,
      reason: "Private refusal decision",
      expires: f.now + 3600000,
    },
    certificate = createContributionRejectionProtocol(
      nodeCertificateCrypto,
    ).create(f.author, request),
    rejection = createBundleAt(
      f.author,
      "site-contribution-rejection",
      { type: "site-contribution-rejection", rejection: certificate },
      [f.identity.public],
      3600000,
      f.now,
    );
  return { catalog, copied, bundle, certificate, rejection };
}
for (const backend of ["node", "go"] as const)
  for (const phase of ["queued", "cancelled", "expired"] as const)
    test(`${backend} admits historical owner rejection from ${phase}, removes only the original payload and preserves a new preparation`, () => {
      const f = fixture();
      let db = f.store;
      try {
        const setup = copiedRejectionFixture(f);
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
            ? run(
                f,
                [{ action: "receive-rejection", bundle: setup.rejection }],
                {
                  now,
                },
              )[0]
            : (() => {
                db = reopen(f);
                try {
                  return new NodeContributionCatalog(
                    db,
                    f.identity,
                    () => now,
                  ).receiveRejection(setup.rejection, allow);
                } finally {
                  db.close();
                }
              })();
        assert.equal(after.phase, phase === "queued" ? "rejected" : phase);
        assert.deepEqual(after.rejection, setup.certificate);
        assert.equal(after.expires, setup.copied.expires);
        db = reopen(f);
        const c = new NodeContributionCatalog(db, f.identity, () => now);
        assert.deepEqual(c.operation(2, next.operationId).operation, next);
        assert.deepEqual(c.receiveRejection(setup.rejection, allow), after);
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
          run(f, [{ action: "receive-rejection", bundle: setup.rejection }], {
            now,
          })[0],
          after,
        );
      } finally {
        db.close();
        rmSync(f.directory, { recursive: true, force: true });
      }
    });
for (const mode of ["before-rejection-commit", "after-rejection"] as const)
  test(`Go ${mode} leaves rejection and payload on the same side of the transaction boundary`, () => {
    const f = fixture();
    let db = f.store;
    try {
      const setup = copiedRejectionFixture(f);
      db.close();
      const child = run(
        f,
        [{ action: "receive-rejection", bundle: setup.rejection }],
        { mode },
      );
      assert.equal(
        child.status,
        mode === "before-rejection-commit" ? 91 : 92,
        child.stdout + child.stderr,
      );
      db = reopen(f);
      const c = new NodeContributionCatalog(db, f.identity, () => f.now),
        state = c.state().operations[0];
      assert.equal(
        state.phase,
        mode === "before-rejection-commit" ? "queued" : "rejected",
      );
      const payload = db.transaction((tx) =>
        SitePrivateRecords.runContribution(tx, f.identity, (v) =>
          v.read("contribution:" + setup.copied.certificateId + ":stage"),
        ),
      );
      assert.equal(payload !== null, mode === "before-rejection-commit");
      const done = c.receiveRejection(setup.rejection, allow);
      assert.equal(done.phase, "rejected");
      assert.deepEqual(done.rejection, setup.certificate);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("uncopied or cross-reference rejections cannot release an authorised private proposal", () => {
  const f = fixture();
  let db = f.store;
  try {
    const setup = copiedRejectionFixture(f),
      rejectionProtocol = createContributionRejectionProtocol(
        nodeCertificateCrypto,
      ),
      original = setup.certificate.body;
    const { domain: _d, owner: _o, ...intent } = original;
    const wrong = rejectionProtocol.create(f.author, {
        ...intent,
        certificateId: "f".repeat(64),
      }),
      bundle = createBundleAt(
        f.author,
        "site-contribution-rejection",
        { type: "site-contribution-rejection", rejection: wrong },
        [f.identity.public],
        intent.expires - intent.decidedAt,
        intent.decidedAt,
      );
    assert.throws(() => setup.catalog.receiveRejection(bundle, allow));
    assert.equal(setup.catalog.state().operations[0].phase, "queued");
    db.close();
    assert.deepEqual(
      run(f, [{ action: "receive-rejection", bundle, expectError: true }]),
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
    assert.throws(() => c.receiveRejection(setup.rejection, allow));
    assert.equal(c.state().operations[0].phase, "queued");
    db.close();
    assert.deepEqual(
      run(f, [
        {
          action: "receive-rejection",
          bundle: setup.rejection,
          kind: "rejection",
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

for (const mode of ["before-rejection-commit", "after-rejection"] as const)
  test(`Node ${mode} preserves the rejection/payload boundary when reopened by Go`, () => {
    const f = fixture();
    let db = f.store;
    try {
      const setup = copiedRejectionFixture(f);
      db.close();
      const control = join(f.directory, "node-receive-control.json");
      writeFileSync(
        control,
        JSON.stringify({
          database: f.databasePath,
          storeId: f.storeId,
          identity: f.identity,
          now: f.now,
          bundle: setup.rejection,
          kind: "rejection",
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
        mode === "before-rejection-commit" ? 93 : 94,
        child.stdout + child.stderr,
      );
      const state = run(f, [{ action: "state" }])[0].operations[0];
      assert.equal(
        state.phase,
        mode === "before-rejection-commit" ? "queued" : "rejected",
      );
      db = reopen(f);
      const payload = db.transaction((tx) =>
        SitePrivateRecords.runContribution(tx, f.identity, (v) =>
          v.read("contribution:" + setup.copied.certificateId + ":stage"),
        ),
      );
      assert.equal(payload !== null, mode === "before-rejection-commit");
      db.close();
      const final = run(f, [
        { action: "receive-rejection", bundle: setup.rejection },
      ])[0];
      assert.equal(final.phase, "rejected");
      assert.deepEqual(final.rejection, setup.certificate);
    } finally {
      db.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test(
  "concurrent Go and Node rejection receivers consume one private payload and agree on the retained first fact",
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
      const setup = copiedRejectionFixture(f);
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
          commands: [{ action: "receive-rejection", bundle: setup.rejection }],
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
        assert(existsSync(path), "owned rejection writer marker missing");
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
          bundle: setup.rejection,
          kind: "rejection",
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
      writeFileSync(releasePath, "release owned Go rejection receiver", {
        mode: 0o600,
      });
      assert.equal(await go.done, 0, go.output());
      assert.equal(await node.done, 0, node.output());
      const g = JSON.parse(readFileSync(control + ".result.json", "utf8"))[0],
        n = JSON.parse(readFileSync(resultPath, "utf8"));
      assert.deepEqual(g, n);
      assert.equal(g.phase, "rejected");
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
