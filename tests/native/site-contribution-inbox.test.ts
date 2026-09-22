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
for (const first of ["node", "go"] as const)
  test(`${first} inbox persists an original proposal that the other process verifies and reopens with the same encrypted source`, () => {
    const f = fixture();
    try {
      const admitted =
        first === "node"
          ? node(f, (c) => c.admit(f.envelope, allow))
          : go(f, "admit").value;
      assert.equal(admitted.entry.phase, "missing-source");
      const verified =
        first === "node"
          ? go(f, "source").value
          : node(f, (c) => c.attachSource(f.cert.id, f.source, allow));
      assert.equal(verified.phase, "verified-candidate");
      const n = node(f, (c) => c.read(f.cert.id, allow)),
        g = go(f, "read").value;
      assert.equal(canonical(n), canonical(g));
      assert.equal(canonical(n?.source), canonical(f.source));
      assert.deepEqual(n?.proposal, f.cert);
      assert.deepEqual(
        go(f, "admit").value.record,
        node(f, (c) => c.state()),
      );
      const repacked = createBundleAt(
          f.visitor,
          "site-contribution",
          { type: "site-contribution", proposal: f.cert },
          [f.owner.public],
          60000,
          f.now,
        ),
        prior = node(f, (c) => c.state());
      assert.notEqual(repacked.manifest.id, f.envelope.manifest.id);
      assert.equal(
        go(f, "admit", { envelope: repacked }).value.outcome,
        "duplicate",
      );
      assert.deepEqual(
        node(f, (c) => c.state()),
        prior,
      );
      const {
          domain: _domain,
          contributor: _contributor,
          ...body
        } = f.cert.body,
        conflicting = createSiteContributionProtocol(
          nodeCertificateCrypto,
        ).create(f.visitor, {
          ...body,
          values: { ...body.values, name: "CONFLICT_CANNOT_REPLACE" },
        }),
        other = createBundleAt(
          f.visitor,
          "site-contribution",
          { type: "site-contribution", proposal: conflicting },
          [f.owner.public],
          60000,
          f.now,
        );
      assert.equal(
        go(f, "admit", { envelope: other }).value.outcome,
        "conflict",
      );
      const retained = node(f, (c) => c.read(f.cert.id, allow))!;
      assert.deepEqual(retained.proposal, f.cert);
      assert.deepEqual(retained.entry.conflicts, [
        { id: conflicting.id, expires: conflicting.body.expires },
      ]);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const action of ["admit", "source"] as const)
  for (const crash of ["before-commit", "after-command"] as const)
    test(`Go inbox process exit ${crash} during ${action} preserves the exact committed boundary`, () => {
      const f = fixture();
      try {
        if (action === "source") node(f, (c) => c.admit(f.envelope, allow));
        go(f, action, { crash });
        const state = node(f, (c) => c.state());
        if (action === "admit" && crash === "before-commit")
          assert.equal(state.entries.length, 0);
        else
          assert.equal(
            state.entries[0].phase,
            action === "source" && crash === "after-command"
              ? "verified-candidate"
              : "missing-source",
          );
        const admitted = go(f, "admit").value;
        assert.equal(admitted.entry.proof.bundleId, f.envelope.manifest.id);
        assert.equal(go(f, "source").value.phase, "verified-candidate");
        assert.deepEqual(
          node(f, (c) => c.read(f.cert.id, allow))?.proposal,
          f.cert,
        );
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    });
test("native inbox refuses block/corruption and collects expired proof without erasing replay metadata", () => {
  const f = fixture();
  try {
    node(f, (c) => {
      c.admit(f.envelope, allow);
      c.attachSource(f.cert.id, f.source, allow);
    });
    assert.match(go(f, "read", { blocked: true }).error, /policy block/);
    assert.deepEqual(go(f, "read").value.proposal, f.cert);
    const original = node(f, (_c, db) =>
      db.transaction((tx) =>
        SitePrivateRecords.runContributionInbox(tx, f.owner, (records) => {
          const key = "contribution-inbox:" + f.cert.id + ":stage",
            original = records.read(key) as any,
            changed = structuredClone(original);
          changed.source.manifest.signature = "A".repeat(88);
          records.write(key, changed);
          return original;
        }),
      ),
    );
    assert.equal(go(f, "read").integrity, true);
    node(f, (_c, db) =>
      db.transaction((tx) =>
        SitePrivateRecords.runContributionInbox(tx, f.owner, (records) =>
          records.write("contribution-inbox:" + f.cert.id + ":stage", original),
        ),
      ),
    );
    assert.equal(
      go(f, "state", { now: f.cert.body.expires }).value.entries[0].phase,
      "expired",
    );
    const expired = node(
      f,
      (c) => c.read(f.cert.id, allow),
      f.cert.body.expires,
    )!;
    assert.equal(expired.entry.proof, null);
    assert.equal(expired.proposal, undefined);
    assert.equal(
      go(f, "state", { now: f.cert.body.expires + 30 * 86400000 }).value.entries
        .length,
      0,
    );
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const first of ["node", "go"] as const)
  for (const verified of [false, true])
    test(`${first} discards ${verified ? "verified" : "missing-source"} proposal durably across encrypted Node/Go reopen`, () => {
      const f = fixture();
      try {
        node(f, (c) => {
          c.admit(f.envelope, allow);
          if (verified) c.attachSource(f.cert.id, f.source, allow);
        });
        const prior = node(f, (c) => c.state()),
          revision = prior.revision;
        assert.match(go(f, "read", { blocked: true }).error, /policy block/);
        assert.match(
          go(f, "dismiss", { revision: revision + 1 }).error,
          /inválida/,
        );
        const removed =
          first === "node"
            ? node(f, (c) => c.dismiss(f.cert.id, revision))
            : go(f, "dismiss", { revision, blocked: true }).value;
        assert.equal(removed.entry.phase, "dismissed");
        assert.equal(removed.entry.proof, null);
        assert.equal(removed.entry.verifiedAt, verified ? f.now : null);
        const reread = node(f, (c) => c.state());
        assert.deepEqual(go(f, "state").value, reread);
        assert.deepEqual(go(f, "dismiss", { revision }).value, removed);
        assert.deepEqual(
          node(f, (c) => c.dismiss(f.cert.id, revision)),
          removed,
        );
        const replay = go(f, "admit").value;
        assert.equal(replay.outcome, "duplicate");
        assert.deepEqual(replay.record, reread);
        assert(go(f, "source").error);
        assert.equal(go(f, "read").value.proposal, undefined);
        assert.deepEqual(
          node(f, (_c, db) =>
            db.transaction((tx) => tx.keys("contribution-inbox:")),
          ).filter((k) => k.includes(f.cert.id)),
          [],
        );
        assert.equal(
          go(f, "state", { now: f.cert.body.expires }).value.entries[0].phase,
          "dismissed",
        );
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    });
for (const crash of ["before-commit", "after-command"] as const)
  test(`Go discard process exit ${crash} cannot separate proof disposal from replay tombstone`, () => {
    const f = fixture();
    try {
      node(f, (c) => {
        c.admit(f.envelope, allow);
        c.attachSource(f.cert.id, f.source, allow);
      });
      const revision = node(f, (c) => c.state().revision);
      go(f, "dismiss", { revision, crash });
      const current = node(f, (c) => c.read(f.cert.id, allow))!;
      assert.equal(
        current.entry.phase,
        crash === "before-commit" ? "verified-candidate" : "dismissed",
      );
      assert.deepEqual(
        current.proposal,
        crash === "before-commit" ? f.cert : undefined,
      );
      const result = node(f, (c) => c.dismiss(f.cert.id, revision));
      assert.equal(result.revision, revision + 1);
      assert.deepEqual(go(f, "dismiss", { revision }).value, result);
      assert.equal(go(f, "admit").value.outcome, "duplicate");
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

test("Go dismissal detects corrupt evidence instead of laundering it through cleanup", () => {
  const f = fixture();
  try {
    node(f, (c, db) => {
      c.admit(f.envelope, allow);
      db.transaction((tx) =>
        SitePrivateRecords.runContributionInbox(tx, f.owner, (records) => {
          const key = "contribution-inbox:" + f.cert.id + ":stage",
            proof = records.read(key) as any;
          proof.envelope.manifest.signature = "A".repeat(88);
          records.write(key, proof);
        }),
      );
    });
    assert.equal(go(f, "dismiss", { revision: 1 }).integrity, true);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const crash of ["before-commit", "after-command"] as const)
  test(`Node discard process exit ${crash} is recovered by Go without splitting proof and tombstone`, () => {
    const f = fixture();
    try {
      node(f, (c) => {
        c.admit(f.envelope, allow);
        c.attachSource(f.cert.id, f.source, allow);
      });
      const revision = node(f, (c) => c.state().revision),
        control = join(f.directory, "node-crash-control.json");
      writeFileSync(
        control,
        JSON.stringify({
          database: f.path,
          storeId: f.storeId,
          identity: f.owner,
          now: f.now,
          id: f.cert.id,
          revision,
          crash,
          output: control + ".result",
        }),
        { mode: 0o600 },
      );
      const stopped = spawnSync(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/contribution-inbox-worker.ts"],
        {
          encoding: "utf8",
          timeout: 15000,
          env: { ...process.env, RELAYLOOM_NODE_INBOX_CONTROL: control },
        },
      );
      assert.equal(stopped.status, 83, stopped.stdout + stopped.stderr);
      const saved = go(f, "read").value;
      assert.equal(
        saved.entry.phase,
        crash === "before-commit" ? "verified-candidate" : "dismissed",
      );
      assert.deepEqual(
        saved.proposal,
        crash === "before-commit" ? f.cert : undefined,
      );
      const result = go(f, "dismiss", { revision }).value;
      assert.equal(result.revision, revision + 1);
      assert.deepEqual(
        node(f, (c) => c.dismiss(f.cert.id, revision)),
        result,
      );
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

for (const first of ["node", "go"] as const)
  test(`${first} receipt intent, signature, exact envelope and copy survive cross-runtime reopen after proposal disposal`, () => {
    const f = fixture();
    try {
      node(f, (c) => c.admit(f.envelope, allow));
      const verified =
        first === "node"
          ? node(f, (c) => c.attachSource(f.cert.id, f.source, allow))
          : go(f, "source").value;
      assert.equal(verified.receipt.phase, "prepared");
      assert.deepEqual(
        go(f, "state").value,
        node(f, (c) => c.state()),
      );
      node(f, (c) => c.dismiss(f.cert.id, c.state().revision));
      assert.match(
        go(f, "sign-receipt", { blocked: true }).error,
        /policy block/,
      );
      const signed =
        first === "node"
          ? go(f, "sign-receipt").value
          : node(f, (c) => c.signReceipt(f.cert.id, allow));
      assert.equal(signed.receipt.phase, "signed");
      assert.equal(go(f, "receipt-bundle").value, null);
      const queued =
        first === "node"
          ? node(f, (c) => c.sealReceipt(f.cert.id, allow))
          : go(f, "seal-receipt").value;
      assert.equal(queued.receipt.phase, "queued");
      const bundle = node(f, (c) => c.receiptBundle(f.cert.id, allow))!;
      assert.deepEqual(go(f, "receipt-bundle").value, bundle);
      assert.deepEqual(
        node(f, (c) => c.sealReceipt(f.cert.id, allow)),
        queued,
      );
      assert.deepEqual(go(f, "seal-receipt").value, queued);
      const plain = decryptStoredBundle(bundle, f.visitor) as any;
      assert.equal(plain.receipt.body.certificateId, f.cert.id);
      assert.equal(plain.receipt.body.verifiedAt, f.now);
      assert(!canonical(plain).includes("DURABLE_INBOX_NODE_GO"));
      const copied = go(f, "copy-receipt", { envelope: bundle }).value;
      assert.equal(copied.receipt.transport.copied, true);
      assert.deepEqual(
        node(f, (c) => c.copyReceipt(f.cert.id, bundle, allow)),
        copied,
      );
      const future = f.cert.body.expires;
      assert.deepEqual(go(f, "receipt-bundle", { now: future }).value, bundle);
      assert.deepEqual(
        node(f, (c) => c.receiptBundle(f.cert.id, allow), future),
        bundle,
      );
      const expired = go(f, "state", {
        now: verified.receipt.request.expires,
      }).value;
      assert.equal(expired.entries[0].receipt.phase, "expired");
      assert.equal(expired.entries[0].receipt.stage, null);
      assert.deepEqual(
        node(f, (_c, db) =>
          db.transaction((tx) => tx.keys("contribution-receipt:")),
        ),
        [],
      );
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
for (const action of [
  "source",
  "sign-receipt",
  "seal-receipt",
  "copy-receipt",
] as const)
  for (const crash of ["before-commit", "after-command"] as const)
    test(`Go receipt ${action} exit ${crash} preserves exactly the committed signing boundary`, () => {
      const f = fixture();
      try {
        node(f, (c) => c.admit(f.envelope, allow));
        if (action !== "source")
          node(f, (c) => c.attachSource(f.cert.id, f.source, allow));
        if (["seal-receipt", "copy-receipt"].includes(action))
          node(f, (c) => c.signReceipt(f.cert.id, allow));
        if (action === "copy-receipt")
          node(f, (c) => c.sealReceipt(f.cert.id, allow));
        const before = node(f, (c) => c.state()),
          envelope =
            action === "copy-receipt"
              ? node(f, (c) => c.receiptBundle(f.cert.id, allow))
              : f.envelope;
        go(f, action, { crash, envelope });
        const after = node(f, (c) => c.state());
        if (crash === "before-commit") assert.deepEqual(after, before);
        else if (action === "copy-receipt")
          assert.equal(after.entries[0].receipt?.transport?.copied, true);
        else
          assert.equal(
            after.entries[0].receipt?.phase,
            action === "source"
              ? "prepared"
              : action === "sign-receipt"
                ? "signed"
                : "queued",
          );
        const replay = go(f, action, { envelope }).value;
        assert(replay.receipt);
        if (action === "seal-receipt")
          assert.deepEqual(
            go(f, "receipt-bundle").value,
            node(f, (c) => c.receiptBundle(f.cert.id, allow)),
          );
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    });

for (const action of [
  "source",
  "sign-receipt",
  "seal-receipt",
  "copy-receipt",
] as const)
  for (const crash of ["before-commit", "after-command"] as const)
    test(`Node receipt ${action} exit ${crash} is recoverable in the Go catalogue`, () => {
      const f = fixture();
      try {
        node(f, (c) => c.admit(f.envelope, allow));
        if (action !== "source")
          node(f, (c) => c.attachSource(f.cert.id, f.source, allow));
        if (["seal-receipt", "copy-receipt"].includes(action))
          node(f, (c) => c.signReceipt(f.cert.id, allow));
        if (action === "copy-receipt")
          node(f, (c) => c.sealReceipt(f.cert.id, allow));
        const before = node(f, (c) => c.state()),
          envelope =
            action === "copy-receipt"
              ? node(f, (c) => c.receiptBundle(f.cert.id, allow))
              : f.envelope,
          control = join(f.directory, "receipt-node-crash.json");
        writeFileSync(
          control,
          JSON.stringify({
            database: f.path,
            storeId: f.storeId,
            identity: f.owner,
            now: f.now,
            id: f.cert.id,
            source: f.source,
            envelope,
            action,
            crash,
            output: control + ".result",
          }),
          { mode: 0o600 },
        );
        const stopped = spawnSync(
          process.execPath,
          ["--import", "tsx", "tests/fixtures/contribution-inbox-worker.ts"],
          {
            encoding: "utf8",
            timeout: 15000,
            env: { ...process.env, RELAYLOOM_NODE_INBOX_CONTROL: control },
          },
        );
        assert.equal(stopped.status, 83, stopped.stdout + stopped.stderr);
        const after = go(f, "state").value;
        if (crash === "before-commit") assert.deepEqual(after, before);
        else if (action === "copy-receipt")
          assert.equal(after.entries[0].receipt.transport.copied, true);
        else
          assert.equal(
            after.entries[0].receipt.phase,
            action === "source"
              ? "prepared"
              : action === "sign-receipt"
                ? "signed"
                : "queued",
          );
        const replay = go(f, action, { envelope }).value;
        assert(replay.receipt);
        if (action === "seal-receipt")
          assert.deepEqual(
            go(f, "receipt-bundle").value,
            node(f, (c) => c.receiptBundle(f.cert.id, allow)),
          );
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    });

test("tampered owner receipt preparation is rejected across both storage engines", () => {
  const f = fixture();
  try {
    node(f, (c, db) => {
      c.admit(f.envelope, allow);
      c.attachSource(f.cert.id, f.source, allow);
      c.signReceipt(f.cert.id, allow);
      db.transaction((tx) =>
        SitePrivateRecords.runContributionReceipt(tx, f.owner, (v) => {
          const key = "contribution-receipt:" + f.cert.id + ":stage",
            stage = v.read(key) as any;
          stage.receipt.signature = "A".repeat(88);
          v.write(key, stage);
        }),
      );
    });
    assert.equal(go(f, "seal-receipt").integrity, true);
    assert.throws(
      () => node(f, (c) => c.sealReceipt(f.cert.id, allow)),
      /recibo/i,
    );
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test(
  "concurrent Go and Node receipt writers commit one envelope while the losing writer observes the committed bytes",
  { timeout: 30000 },
  async () => {
    const f = fixture(),
      children: ReturnType<typeof spawn>[] = [],
      held = join(f.directory, "held-receipt"),
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
        c.attachSource(f.cert.id, f.source, allow);
        c.signReceipt(f.cert.id, allow);
      });
      const base = {
          database: f.path,
          storeId: f.storeId,
          identity: f.owner,
          now: f.now,
          id: f.cert.id,
          action: "seal-receipt",
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
      assert.equal(g.receipt.phase, "queued");
      assert.deepEqual(
        go(f, "receipt-bundle").value,
        node(f, (c) => c.receiptBundle(f.cert.id, allow)),
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
