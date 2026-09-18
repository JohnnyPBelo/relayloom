import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import {
  createIdentity,
  createBundle,
  canonical,
  hash,
} from "../packages/core/src/index";
import { describeSiteResource } from "../packages/content/src/site-resource";
import { createResourceOperations } from "../packages/sites/src/resource-operations";
test("Node and Go agree on creation fingerprints, exact outcomes, retirement and malformed records", () => {
  const owner = createIdentity("Creation owner"),
    registry = createResourceOperations({ hash }),
    id = owner.public.id;
  const content = {
    type: "site-resource" as const,
    domain: "relayloom/site-resource/1" as const,
    kind: "file" as const,
    name: "Conteúdo 🧶 \ud800.txt",
    mime: "text/plain",
    data: "Zg==",
  };
  const make = (sequence = 1) => ({
    sequence,
    operationId: randomUUID(),
    content,
    recipients: "public" as const,
    ttlMs: 3600000,
  });
  const staged = (q: ReturnType<typeof make>) => {
    const bundle = createBundle(
      owner,
      "site-resource",
      q.content,
      "public",
      q.ttlMs,
    );
    return {
      reference: describeSiteResource(q.content, {
        id: bundle.manifest.id,
        authorId: id,
        kind: bundle.manifest.kind,
      }),
      created: bundle.manifest.created,
      expires: bundle.manifest.expires,
      bundleHash: hash(canonical(bundle)),
      recipients: "public" as const,
    };
  };
  const first = make(),
    stage = staged(first),
    initial = registry.initial(id),
    prepared = registry.prepare(initial, id, first, stage),
    ready = registry.ready(
      prepared.record,
      id,
      1,
      first.operationId,
      prepared.operation.fingerprint,
      stage.bundleHash,
    ),
    expired = registry.expire(prepared.record, id, stage.expires);
  const cases: any[] = [
    { action: "initial" },
    { action: "request", input: first },
    { action: "prepare", record: initial, input: first, staged: stage },
    { action: "prepare", record: prepared.record, input: first, staged: {} },
    { action: "prepare", record: ready, input: first, staged: {} },
    { action: "prepare", record: expired, input: first, staged: {} },
    { action: "expire", record: prepared.record, now: stage.expires - 1 },
    { action: "expire", record: prepared.record, now: stage.expires },
    {
      action: "lookup",
      record: ready,
      sequence: 1,
      operationId: first.operationId,
    },
    { action: "lookup", record: ready, sequence: 2, operationId: randomUUID() },
  ];
  for (const record of [prepared.record, ready, expired])
    cases.push({
      action: "ready",
      record,
      sequence: 1,
      operationId: first.operationId,
      fingerprint: prepared.operation.fingerprint,
      bundleHash: stage.bundleHash,
    });
  for (const invalid of [
    { ...first, extra: true },
    { ...first, sequence: 0 },
    { ...first, sequence: 1.5 },
    { ...first, operationId: "x" },
    { ...first, recipients: [] },
    { ...first, recipients: ["f".repeat(64)] },
    { ...first, ttlMs: 999 },
    { ...first, ttlMs: 365 * 86400_000 + 1 },
  ])
    cases.push({ action: "request", input: invalid });
  const second = make(2);
  cases.push(
    {
      action: "prepare",
      record: prepared.record,
      input: second,
      staged: staged(second),
    },
    {
      action: "prepare",
      record: ready,
      input: { ...first, ttlMs: 1000 },
      staged: stage,
    },
    {
      action: "prepare",
      record: ready,
      input: second,
      staged: { ...staged(second), bundleHash: "wrong" },
    },
    { action: "lookup", record: ready, sequence: 1, operationId: randomUUID() },
    {
      action: "ready",
      record: prepared.record,
      sequence: 1,
      operationId: first.operationId,
      fingerprint: prepared.operation.fingerprint,
      bundleHash: "a".repeat(64),
    },
  );
  for (const mutate of [
    (r: any) => r.nextSequence++,
    (r: any) => (r.operations[0].phase = "unknown"),
    (r: any) => (r.operations[0].reference.authorId = "f".repeat(64)),
    (r: any) => r.operations[0].expires++,
    (r: any) => (r.operations[0].extra = true),
    (r: any) => (r.operations[0].fingerprint = "0".repeat(64)),
  ]) {
    const record = structuredClone(ready);
    mutate(record);
    cases.push({ action: "validate", record });
  }
  let history = ready;
  for (let sequence = 2; sequence <= 130; sequence++) {
    const q = make(sequence),
      s = staged(q),
      p = registry.prepare(history, id, q, s);
    history = registry.ready(
      p.record,
      id,
      sequence,
      q.operationId,
      p.operation.fingerprint,
      s.bundleHash,
    );
  }
  cases.push(
    { action: "validate", record: history },
    {
      action: "lookup",
      record: history,
      sequence: 1,
      operationId: first.operationId,
    },
    { action: "prepare", record: history, input: first, staged: stage },
  );
  const evaluate = (c: any): unknown => {
    try {
      let value: unknown;
      switch (c.action) {
        case "initial":
          value = registry.initial(id);
          break;
        case "request":
          value = registry.request(c.input, id);
          break;
        case "validate":
          value = registry.validate(c.record, id);
          break;
        case "prepare":
          value = registry.prepare(c.record, id, c.input, c.staged);
          break;
        case "lookup":
          value = registry.lookup(c.record, id, c.sequence, c.operationId);
          break;
        case "ready":
          value = registry.ready(
            c.record,
            id,
            c.sequence,
            c.operationId,
            c.fingerprint,
            c.bundleHash,
          );
          break;
        case "expire":
          value = registry.expire(c.record, id, c.now);
          break;
      }
      return { value };
    } catch {
      return { error: true };
    }
  };
  const expected = cases.map(evaluate);
  assert.ok(
    expected.some((v: any) => v.error) && expected.some((v: any) => !v.error),
  );
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(resolve(".cache/resource-operations-")),
    input = join(dir, "input.json");
  try {
    writeFileSync(input, JSON.stringify({ owner: id, cases }));
    const result = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestResourceOperationWorker$",
        "-count=1",
      ],
      {
        env: { ...process.env, RELAYLOOM_RESOURCE_OPERATIONS_INPUT: input },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(input + ".result", "utf8")),
      expected,
    );
    writeFileSync(
      ".cache/site-resource-operations-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: cases.length,
          accepted: expected.filter((v: any) => !v.error).length,
          rejected: expected.filter((v: any) => v.error).length,
          scope:
            "Local creation state-machine conformance; not persistent catalogs, network creation or UI.",
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
