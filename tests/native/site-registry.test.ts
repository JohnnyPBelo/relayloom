import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createIdentity, canonical, hash } from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import {
  createSiteRegistry,
  type SiteRecord,
} from "../../packages/sites/src/registry";
import { siteRevisions } from "../../packages/sites/src/index";
import { projectTemp } from "../project-temp";

test("a real Go process matches Node registry transitions, malformed inputs, finite history and operation retirement", () => {
  const root = resolve(".cache/site-registry");
  mkdirSync(root, { recursive: true });
  const directory = projectTemp("registry-interop-");
  const owner = createIdentity("Registry interoperability 😀 \ud800"),
    registry = createSiteRegistry(nodeCertificateCrypto),
    cases: any[] = [];
  const initial = registry.initial(owner.public.id, "profile");
  const request = (r: SiteRecord, text: string) => {
    const state = registry.state(r);
    return {
      sequence: state.nextSequence!,
      operationId: randomUUID(),
      fingerprint: hash(text),
      expectedBase: registry.baseHash(r),
      revision: siteRevisions.createRevision(
        owner,
        "profile",
        state.nextSequence!,
        state.heads
          .map((h) => h.id)
          .sort()
          .slice(0, 16),
        siteRevisions.documentHash(text),
      ),
      bundleId: hash("bundle:" + text),
    };
  };
  function add(label: string, action: string, record: any, extra: any = {}) {
    const entry: any = {
      label,
      action,
      record: structuredClone(record),
      ...extra,
    };
    try {
      let expected: any;
      if (action === "state")
        expected = {
          state: registry.state(record),
          base: registry.baseHash(record),
          key: registry.recordKey(record.ownerId, record.name),
        };
      else if (action === "begin")
        expected = registry.begin(record, extra.request);
      else if (action === "observe")
        expected = registry.observe(record, extra.revision, extra.bundleId);
      else if (action === "lookup")
        expected =
          registry.lookup(
            record,
            extra.sequence,
            extra.id,
            extra.fingerprint,
          ) ?? null;
      else if (action === "decode")
        expected = registry.validate(record, owner.public.id, "profile");
      else
        expected = (registry as any)[action](
          record,
          extra.sequence,
          extra.id,
          extra.fingerprint,
        );
      entry.expected = structuredClone(expected);
      cases.push(entry);
      return expected;
    } catch {
      entry.error = true;
      cases.push(entry);
      return null;
    }
  }
  try {
    add("empty", "state", initial);
    const q = {
      ...request(initial, "first"),
      requestFingerprint: hash("logical request"),
    };
    const began = add("reserve", "begin", initial, { request: q });
    const handle = {
      sequence: q.sequence,
      id: q.operationId,
      fingerprint: q.fingerprint,
    };
    add("pending state", "state", began.record);
    add("lookup", "lookup", began.record, handle);
    add("same operation ignores fresh ciphertext", "begin", began.record, {
      request: { ...q, bundleId: hash("other nonce") },
    });
    add("wrong fingerprint", "lookup", began.record, {
      ...handle,
      fingerprint: hash("wrong"),
    });
    add("no ready before commit", "markReady", began.record, handle);
    add("cancel prepared", "cancel", began.record, handle);
    add("expire prepared", "expire", began.record, handle);
    const committed = add("authorize", "commit", began.record, handle);
    add("authorized state without bytes", "state", committed.record);
    add("cannot recall", "cancel", committed.record, handle);
    const ready = add("ready", "markReady", committed.record, handle);
    add("replay ready", "begin", ready.record, { request: q });
    add("ready stays ready on expiry", "expire", ready.record, handle);
    for (const n of [1, 5]) {
      const revision = siteRevisions.createRevision(
        owner,
        "profile",
        n,
        [],
        siteRevisions.documentHash("observed " + n),
      );
      const seen = add("observe sequence " + n, "observe", began.record, {
        revision,
        bundleId: hash("observed bundle " + n),
      });
      add("base changed at " + n, "commit", seen, handle);
    }
    const stranger = createIdentity("Not the site owner");
    add("foreign signer", "observe", ready.record, {
      revision: siteRevisions.createRevision(
        stranger,
        "profile",
        10,
        [],
        hash("wrong-owner"),
      ),
      bundleId: hash("foreign"),
    });
    let journal = initial;
    let oldest: any;
    for (let i = 0; i < 34; i++) {
      const q = request(journal, "retire " + i);
      if (!oldest) oldest = q;
      const b = registry.begin(journal, q);
      const stopped = add("cancel generation " + i, "cancel", b.record, {
        sequence: q.sequence,
        id: q.operationId,
        fingerprint: q.fingerprint,
      });
      journal = stopped.record;
    }
    add("retired cannot reexecute", "lookup", journal, {
      sequence: oldest.sequence,
      id: oldest.operationId,
      fingerprint: oldest.fingerprint,
    });
    const history = registry.initial(owner.public.id, "profile");
    history.counter = 128;
    history.headers = Array.from({ length: 128 }, (_, i) => ({
      revision: siteRevisions.createRevision(
        owner,
        "profile",
        i + 1,
        [],
        siteRevisions.documentHash("history " + i),
      ),
      bundles: [],
    }));
    add("full history", "state", history);
    const next = request(history, "advance full history");
    const b = add("reserve full history", "begin", history, { request: next });
    const result = add("advance full history", "commit", b.record, {
      sequence: next.sequence,
      id: next.operationId,
      fingerprint: next.fingerprint,
    });
    add("new head retained", "state", result.record);
    add("sequence exhausted", "state", {
      ...initial,
      counter: Number.MAX_SAFE_INTEGER,
    });
    for (const change of [
      (v: any) => (v.extra = true),
      (v: any) => (v.headers = null),
      (v: any) => (v.counter = -1),
      (v: any) => (v.operations[0].requestFingerprint = null),
      (v: any) => (v.operations[0].revision.signature = "A".repeat(88)),
      (v: any) => v.operations.push(structuredClone(v.operations[0])),
    ]) {
      const value = structuredClone(began.record);
      change(value);
      add("malformed " + cases.length, "decode", value);
    }
    const data = canonical({
      ownerId: owner.public.id,
      name: "profile",
      cases,
    });
    assert.ok(Buffer.byteLength(data) < 16 * 1024 * 1024);
    const input = join(directory, "vectors.json");
    writeFileSync(input, data, { mode: 0o600 });
    writeFileSync(join(root, "last-vectors.json"), data + "\n");
    const executable = join(
      root,
      process.platform === "win32" ? "registry.test.exe" : "registry.test",
    );
    const build = spawnSync(
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
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const resultRun = spawnSync(
      executable,
      ["-test.run=^TestRegistryInteropWorker$", "-test.v"],
      {
        cwd: resolve("native/sites"),
        env: { ...process.env, RELAYLOOM_SITE_REGISTRY_INPUT: input },
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    writeFileSync(join(root, "go.log"), resultRun.stdout + resultRun.stderr);
    assert.equal(resultRun.status, 0, resultRun.stdout + resultRun.stderr);
    writeFileSync(
      join(root, "report.json"),
      JSON.stringify(
        {
          status: "PASS",
          vectors: cases.length,
          negative: cases.filter((c) => c.error).length,
          vectorSHA256: hash(data),
          realGoProcess: true,
          physicalDevice: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
