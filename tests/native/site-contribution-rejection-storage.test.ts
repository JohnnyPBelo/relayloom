import { setTimeout as delay } from "node:timers/promises";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import {
  createIdentity,
  createBundleAt,
  decryptStoredBundle,
  canonical,
} from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../../packages/sites/src/content";
import { createContributionContextResolver } from "../../packages/sites/src/contribution-context";
import { createSiteContributionProtocol } from "../../packages/sites/src/contribution-protocol";
import { NodeContributionInbox } from "../../packages/sites/src/contribution-inbox-catalog";
import { SitePrivateRecords } from "../../packages/sites/src/private-storage";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { projectTemp } from "../project-temp";
import { formPayload } from "../fixtures/site-form";
const allow = () => {};
let workerDirectory: string, worker: string;
before(() => {
  workerDirectory = projectTemp("inbox-native-worker-");
  worker = join(
    workerDirectory,
    process.platform === "win32" ? "sites.test.exe" : "sites.test",
  );
  const built = spawnSync(
    process.execPath,
    ["scripts/go.mjs", "test", "-c", "-race", "-p=1", "./sites", "-o", worker],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
});
after(() => {
  if (workerDirectory)
    rmSync(workerDirectory, { recursive: true, force: true });
});
function fixture() {
  const directory = projectTemp("inbox-native-profile-"),
    path = join(directory, "profile.sqlite"),
    now = Date.now(),
    owner = createIdentity("Owner"),
    visitor = createIdentity("Visitor"),
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
    cert = createSiteContributionProtocol(nodeCertificateCrypto).create(
      visitor,
      {
        target: context.target,
        schemaHash: createSiteContributionProtocol(
          nodeCertificateCrypto,
        ).schemaHash(context.form, context.table),
        operationId: randomUUID(),
        created: now,
        expires: now + 60000,
        values: { name: "DURABLE_INBOX_NODE_GO", count: 0, open: false },
        publicationScope: "public",
      },
    ),
    envelope = createBundleAt(
      visitor,
      "site-contribution",
      { type: "site-contribution", proposal: cert },
      [owner.public],
      60000,
      now,
    ),
    initial = new ProtectedGroupStore(path, owner, { create: true }),
    storeId = initial.storeId();
  initial.close();
  return {
    directory,
    path,
    now,
    owner,
    visitor,
    source,
    cert,
    envelope,
    storeId,
  };
}
function node<T>(
  f: ReturnType<typeof fixture>,
  fn: (c: NodeContributionInbox, db: ProtectedGroupStore) => T,
  now = f.now,
) {
  const db = new ProtectedGroupStore(f.path, f.owner, {
    expectedStoreId: f.storeId,
  });
  try {
    return fn(new NodeContributionInbox(db, f.owner, () => now), db);
  } finally {
    db.close();
  }
}
function go(
  f: ReturnType<typeof fixture>,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const path = join(f.directory, randomUUID() + ".json"),
    output = path + ".result";
  writeFileSync(
    path,
    JSON.stringify({
      database: f.path,
      storeId: f.storeId,
      identity: f.owner,
      now: f.now,
      action,
      envelope: f.envelope,
      source: f.source,
      id: f.cert.id,
      output,
      ...extra,
    }),
    { mode: 0o600 },
  );
  const run = spawnSync(
    worker,
    ["-test.run=^TestContributionInboxCatalogWorker$"],
    {
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, RELAYLOOM_INBOX_CATALOG_CONTROL: path },
    },
  );
  assert.equal(run.status, extra.crash ? 83 : 0, run.stdout + run.stderr);
  return extra.crash ? null : JSON.parse(readFileSync(output, "utf8"));
}

const reason = "PRIVATE_REFUSAL_MOTIVE_96432";
for (const first of ["node", "go"] as const)
  test(`${first} owner decision releases the proposal in the same commit and other engine resumes its exact encrypted refusal`, () => {
    const f = fixture();
    try {
      node(f, (c) => {
        c.admit(f.envelope, allow);
        c.attachSource(f.cert.id, f.source, allow);
      });
      const before = node(f, (c) => c.state()),
        revision = before.revision;
      const decision =
        first === "node"
          ? node(f, (c) => c.reject(f.cert.id, revision, reason, allow))
          : go(f, "reject", { revision, reason }).value;
      assert.equal(decision.entry.phase, "rejected");
      assert.equal(decision.entry.proof, null);
      assert.deepEqual(decision.entry.receipt, before.entries[0].receipt);
      assert.deepEqual(
        go(f, "state").value,
        node(f, (c) => c.state()),
      );
      assert(go(f, "reject", { revision, reason, blocked: true }).error);
      assert(go(f, "reject", { revision, reason: "changed" }).error);
      assert(go(f, "sign-rejection", { blocked: true }).error);
      assert.equal(go(f, "sign-rejection").value.rejection.phase, "signed");
      node(f, (c) => c.sealRejection(f.cert.id, allow));
      const bundle = go(f, "rejection-bundle").value;
      assert.deepEqual(
        bundle,
        node(f, (c) => c.rejectionBundle(f.cert.id, allow)),
      );
      assert(bundle);
      assert.equal(
        (decryptStoredBundle(bundle, f.visitor) as any).rejection.body.reason,
        reason,
      );
      assert(!canonical(bundle).includes(reason));
      assert.equal(
        go(f, "copy-rejection", { envelope: bundle }).value.rejection.transport
          .copied,
        true,
      );
      assert.deepEqual(
        go(f, "state").value,
        node(f, (c) => c.state()),
      );
      assert.deepEqual(
        go(f, "seal-rejection").value,
        node(f, (c) => c.sealRejection(f.cert.id, allow)),
      );
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const engine of ["node", "go"] as const)
  for (const action of [
    "reject",
    "sign-rejection",
    "seal-rejection",
    "copy-rejection",
  ] as const)
    for (const crash of ["before-commit", "after-command"] as const)
      test(`${engine} refusal ${action} crash ${crash} preserves the exact atomic boundary in the other engine`, () => {
        const f = fixture();
        try {
          node(f, (c) => c.admit(f.envelope, allow));
          let revision = node(f, (c) => c.state()).revision;
          if (action !== "reject")
            node(f, (c) => c.reject(f.cert.id, revision, reason, allow));
          if (["seal-rejection", "copy-rejection"].includes(action))
            node(f, (c) => c.signRejection(f.cert.id, allow));
          if (action === "copy-rejection")
            node(f, (c) => c.sealRejection(f.cert.id, allow));
          const before = node(f, (c) => c.state()),
            envelope =
              action === "copy-rejection"
                ? node(f, (c) => c.rejectionBundle(f.cert.id, allow))
                : f.envelope;
          if (engine === "go")
            go(f, action, { revision, reason, envelope, crash });
          else {
            const control = join(f.directory, "rejection-node-crash.json");
            writeFileSync(
              control,
              JSON.stringify({
                database: f.path,
                storeId: f.storeId,
                identity: f.owner,
                now: f.now,
                id: f.cert.id,
                revision,
                reason,
                envelope,
                action,
                crash,
                output: control + ".result",
              }),
              { mode: 0o600 },
            );
            const stopped = spawnSync(
              process.execPath,
              [
                "--import",
                "tsx",
                "tests/fixtures/contribution-inbox-worker.ts",
              ],
              {
                encoding: "utf8",
                timeout: 15000,
                env: { ...process.env, RELAYLOOM_NODE_INBOX_CONTROL: control },
              },
            );
            assert.equal(stopped.status, 83, stopped.stdout + stopped.stderr);
          }
          const after =
            engine === "node"
              ? go(f, "state").value
              : node(f, (c) => c.state());
          if (crash === "before-commit") assert.deepEqual(after, before);
          else if (action === "copy-rejection")
            assert.equal(after.entries[0].rejection.transport.copied, true);
          else {
            assert.equal(after.entries[0].phase, "rejected");
            assert.equal(after.entries[0].proof, null);
            assert.equal(
              after.entries[0].rejection.phase,
              action === "reject"
                ? "prepared"
                : action === "sign-rejection"
                  ? "signed"
                  : "queued",
            );
          }
          const retry = go(f, action, { revision, reason, envelope });
          assert.equal(retry.error, undefined);
          assert.deepEqual(
            go(f, "state").value,
            node(f, (c) => c.state()),
          );
        } finally {
          rmSync(f.directory, { recursive: true, force: true });
        }
      });

test("refusal stage corruption is refused by both engines and cannot be hidden by expiry", () => {
  const f = fixture();
  try {
    node(f, (c, db) => {
      c.admit(f.envelope, allow);
      c.reject(f.cert.id, c.state().revision, reason, allow);
      c.signRejection(f.cert.id, allow);
      db.transaction((tx) =>
        SitePrivateRecords.runContributionRejection(tx, f.owner, (values) => {
          const key = "contribution-rejection:" + f.cert.id + ":stage",
            value = values.read(key) as any;
          value.rejection.body.reason = "forged";
          values.write(key, value);
        }),
      );
    });
    assert.equal(go(f, "seal-rejection").integrity, true);
    assert.throws(() => node(f, (c) => c.sealRejection(f.cert.id, allow)));
    assert.equal(
      go(f, "state", { now: f.now + 30 * 86400000 }).integrity,
      true,
    );
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test(
  "concurrent Go and Node rejection writers commit one envelope while the losing writer observes the committed bytes",
  { timeout: 30000 },
  async () => {
    const f = fixture(),
      children: ReturnType<typeof spawn>[] = [],
      held = join(f.directory, "held-rejection"),
      resultGo = held + ".go-result",
      resultNode = held + ".node-result";
    const start = (command: string, args: string[], env: NodeJS.ProcessEnv) => {
      const child = spawn(command, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let output = "";
      child.stdout?.on("data", (d) => {
        output = (output + d).slice(-16000);
      });
      child.stderr?.on("data", (d) => {
        output = (output + d).slice(-16000);
      });
      const done = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      void done.catch(() => {});
      return { child, done, output: () => output };
    };
    try {
      node(f, (c) => {
        c.admit(f.envelope, allow);
        c.reject(f.cert.id, c.state().revision, reason, allow);
        c.signRejection(f.cert.id, allow);
      });
      const base = {
          database: f.path,
          storeId: f.storeId,
          identity: f.owner,
          now: f.now,
          id: f.cert.id,
          action: "seal-rejection",
        },
        goPath = held + ".go.json",
        nodePath = held + ".node.json";
      writeFileSync(
        goPath,
        JSON.stringify({ ...base, hold: held, output: resultGo }),
        { mode: 0o600 },
      );
      const goWriter = start(
        worker,
        ["-test.run=^TestContributionInboxCatalogWorker$"],
        { ...process.env, RELAYLOOM_INBOX_CATALOG_CONTROL: goPath },
      );
      const untilFile = async (path: string) => {
        const until = Date.now() + 5000;
        while (!existsSync(path) && Date.now() < until) await delay(10);
        assert(existsSync(path), "owned writer marker missing: " + path);
      };
      await untilFile(held + ".ready");
      writeFileSync(
        nodePath,
        JSON.stringify({
          ...base,
          started: held + ".node-started",
          output: resultNode,
        }),
        { mode: 0o600 },
      );
      const nodeWriter = start(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/contribution-inbox-worker.ts"],
        { ...process.env, RELAYLOOM_NODE_INBOX_CONTROL: nodePath },
      );
      await untilFile(held + ".node-started");
      await delay(150);
      assert.equal(
        existsSync(resultNode),
        false,
        "Node cannot return a second envelope while Go owns the commit",
      );
      assert.equal(nodeWriter.child.exitCode, null);
      writeFileSync(held + ".release", "release owned writer", { mode: 0o600 });
      assert.equal(await goWriter.done, 0, goWriter.output());
      assert.equal(await nodeWriter.done, 0, nodeWriter.output());
      const g = JSON.parse(readFileSync(resultGo, "utf8")).value,
        n = JSON.parse(readFileSync(resultNode, "utf8"));
      assert.deepEqual(g, n);
      assert.equal(g.rejection.phase, "queued");
      assert.deepEqual(
        go(f, "rejection-bundle").value,
        node(f, (c) => c.rejectionBundle(f.cert.id, allow)),
      );
    } finally {
      if (!existsSync(held + ".release"))
        writeFileSync(held + ".release", "cleanup owned writer", {
          mode: 0o600,
        });
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const closed = new Promise<void>((resolve) =>
            child.once("close", () => resolve()),
          );
          child.kill("SIGTERM");
          await closed;
        }
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
);
