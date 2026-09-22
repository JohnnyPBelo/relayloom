import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createIdentity, canonical } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import { createContributionOperations } from "../packages/sites/src/contribution-operations";
import {
  createSiteContributionProtocol,
  type ContributionFormContext,
} from "../packages/sites/src/contribution-protocol";
import { formSite } from "./fixtures/site-form";
import { siteFormBlocks } from "../packages/content/src/site";
import { projectTemp } from "./project-temp";

test("Node, portable and Go contribution journals agree on canonical requests, retained transitions and rejected corruption", () => {
  const owner = createIdentity("Visitante"),
    author = createIdentity("Dona"),
    node = createContributionOperations(nodeCertificateCrypto),
    portable = createContributionOperations(browserCertificateCrypto),
    protocol = createSiteContributionProtocol(nodeCertificateCrypto),
    now = Date.now();
  const binding = siteFormBlocks(formSite([owner.public.id]))[0];
  const context: ContributionFormContext = {
    target: {
      site: "relayloom:site:" + author.public.id + "/profile",
      snapshotId: "a".repeat(64),
      revisionId: "b".repeat(64),
      pageId: "entry",
      formId: "form",
    },
    form: binding.form,
    table: binding.table,
    siteScope: "public",
    snapshotExpires: now + 60000,
  };
  const input = {
    sequence: 1,
    operationId: randomUUID(),
    snapshotId: context.target.snapshotId,
    pageId: "entry",
    formId: "form",
    values: { name: "Pedido 🧶 \ud800", count: 1e-15, open: false },
    publicationScope: [owner.public.id, author.public.id].sort(),
    ttlMs: 30000,
  };
  const initial = node.initial(owner.public.id),
    prepared = node.prepare(initial, owner.public.id, input, context, now),
    certificate = protocol.create(owner, {
      target: context.target,
      schemaHash: prepared.operation.schemaHash,
      operationId: input.operationId,
      created: now,
      expires: prepared.operation.expires,
      values: input.values,
      publicationScope: input.publicationScope,
    }),
    signed = node.signed(
      prepared.record,
      owner.public.id,
      prepared.operation,
      input,
      certificate,
    ),
    cancelled = node.cancel(signed.record, owner.public.id, signed.operation),
    expired = node.expire(
      signed.record,
      owner.public.id,
      prepared.operation.expires,
    );
  type Vector = {
    name: string;
    kind: string;
    valid: boolean;
    owner: string;
    input?: any;
    record?: any;
    context?: any;
    now?: number;
    handle?: any;
    certificate?: any;
    sequence?: number;
    operationId?: string;
  };
  const vectors: Vector[] = [];
  const add = (
    name: string,
    kind: string,
    valid: boolean,
    extra: Partial<Vector> = {},
    edit: (v: Vector) => void = () => {},
  ) => {
    const v = structuredClone({
      name,
      kind,
      valid,
      owner: owner.public.id,
      input,
      record: initial,
      context,
      now,
      handle: prepared.operation,
      certificate,
      ...extra,
    });
    edit(v);
    vectors.push(v);
  };
  add("empty journal", "initial", true);
  add("canonical request with Unicode and number", "request", true);
  for (const [name, change] of [
    [
      "wrong UUID version",
      (q: any) => (q.operationId = "00000000-0000-1000-8000-000000000001"),
    ],
    ["zero sequence", (q: any) => (q.sequence = 0)],
    ["unsafe sequence", (q: any) => (q.sequence = Number.MAX_SAFE_INTEGER + 1)],
    ["extra context", (q: any) => (q.context = {})],
    ["TTL too short", (q: any) => (q.ttlMs = 999)],
    ["TTL too long", (q: any) => (q.ttlMs = 30 * 86400000 + 1)],
    [
      "missing contributor grant",
      (q: any) => (q.publicationScope = [author.public.id]),
    ],
    ["unsorted grant", (q: any) => q.publicationScope.reverse()],
    ["invalid locator", (q: any) => (q.formId = "../x")],
  ] as const)
    add(name, "request", false, {}, (v) => change(v.input));
  add("new private grant for public site", "prepare", true);
  add(
    "snapshot expiry bounds deadline",
    "prepare",
    true,
    {},
    (v) => (v.context.snapshotExpires = now + 15000),
  );
  add(
    "less than one second left",
    "prepare",
    false,
    {},
    (v) => (v.context.snapshotExpires = now + 999),
  );
  add(
    "no visitor permission",
    "prepare",
    false,
    {},
    (v) => (v.context.form.contributors = [author.public.id]),
  );
  add(
    "private proposal omits site owner",
    "prepare",
    false,
    {},
    (v) => (v.input.publicationScope = [owner.public.id]),
  );
  add(
    "wrong value type",
    "prepare",
    false,
    {},
    (v) => (v.input.values.open = "false"),
  );
  add(
    "changed snapshot",
    "prepare",
    false,
    {},
    (v) => (v.context.target.snapshotId = "c".repeat(64)),
  );
  add("prepared record", "validate", true, { record: prepared.record });
  add("signed record", "validate", true, { record: signed.record });
  add("cancelled record", "validate", true, { record: cancelled });
  add("expired record", "validate", true, { record: expired });
  for (const [name, change] of [
    ["wrong owner", (r: any) => (r.ownerId = author.public.id)],
    ["lost operation", (r: any) => (r.operations = [])],
    ["advanced counter", (r: any) => (r.nextSequence = 3)],
    ["missing certificate", (r: any) => (r.operations[0].certificateId = null)],
    [
      "zero lifetime",
      (r: any) => (r.operations[0].expires = r.operations[0].created),
    ],
    ["future phase", (r: any) => (r.operations[0].phase = "approved")],
    ["extra row", (r: any) => (r.operations[0].values = {})],
    [
      "unsafe created",
      (r: any) => (r.operations[0].created = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["invalid target", (r: any) => (r.operations[0].target.site = "bad")],
  ] as const)
    add(name, "validate", false, { record: signed.record }, (v) =>
      change(v.record),
    );
  add("sign prepared intent", "sign", true, { record: prepared.record });
  add("repeat signature", "sign", true, { record: signed.record });
  add("sign after cancellation", "sign", false, { record: cancelled });
  add("sign after expiry", "sign", false, { record: expired });
  add(
    "wrong handle",
    "sign",
    false,
    { record: prepared.record },
    (v) => (v.handle.fingerprint = "f".repeat(64)),
  );
  add("valid signature for other values", "sign", false, {
    record: prepared.record,
    certificate: protocol.create(owner, {
      target: context.target,
      schemaHash: prepared.operation.schemaHash,
      operationId: input.operationId,
      created: now,
      expires: prepared.operation.expires,
      values: { ...input.values, name: "changed" },
      publicationScope: input.publicationScope,
    }),
  });
  add("idempotent preparation", "prepare", true, { record: prepared.record });
  add(
    "preparation retry with changed data",
    "prepare",
    false,
    { record: prepared.record },
    (v) => (v.input.values.name = "changed"),
  );
  add(
    "second pending request",
    "prepare",
    false,
    { record: prepared.record },
    (v) => {
      v.input.sequence = 2;
      v.input.operationId = randomUUID();
    },
  );
  add("cancel signed", "cancel", true, { record: signed.record });
  add("cancel repeated", "cancel", true, { record: cancelled });
  add("cannot cancel expiry", "cancel", false, { record: expired });
  add("expire exact deadline", "expire", true, {
    record: signed.record,
    now: prepared.operation.expires,
  });
  add("valid just before deadline", "expire", true, {
    record: signed.record,
    now: prepared.operation.expires - 1,
  });
  add("negative clock", "expire", false, { record: signed.record, now: -1 });
  add("retained lookup", "lookup", true, {
    record: signed.record,
    sequence: 1,
    operationId: input.operationId,
  });
  add("wrong UUID for sequence", "lookup", false, {
    record: signed.record,
    sequence: 1,
    operationId: randomUUID(),
  });
  let retained = initial;
  for (let sequence = 1; sequence <= 130; sequence++) {
    const p = node.prepare(
      retained,
      owner.public.id,
      {
        ...input,
        sequence,
        operationId: sequence === 1 ? input.operationId : randomUUID(),
      },
      context,
      now,
    );
    retained = node.cancel(p.record, owner.public.id, p.operation);
  }
  add("full retained window", "validate", true, { record: retained });
  add(
    "middle gap at full window",
    "validate",
    false,
    { record: retained },
    (v) => v.record.operations.splice(45, 1),
  );
  add("retired old sequence", "lookup", true, {
    record: retained,
    sequence: 1,
    operationId: input.operationId,
  });
  add("retired prepare refused", "prepare", false, { record: retained });
  add("old UUID cannot be reused while retained", "lookup", false, {
    record: retained,
    sequence: 131,
    operationId: retained.operations[0].operationId,
  });
  const run = (
    registry: ReturnType<typeof createContributionOperations>,
    v: Vector,
  ): any => {
    switch (v.kind) {
      case "initial":
        return registry.initial(v.owner);
      case "request":
        return registry.request(v.input, v.owner);
      case "validate":
        return registry.validate(v.record, v.owner);
      case "prepare":
        return registry.prepare(v.record, v.owner, v.input, v.context, v.now!);
      case "sign":
        return registry.signed(
          v.record,
          v.owner,
          v.handle,
          v.input,
          v.certificate,
        );
      case "expire":
        return registry.expire(v.record, v.owner, v.now!);
      case "cancel":
        return registry.cancel(v.record, v.owner, v.handle);
      case "lookup":
        return registry.lookup(v.record, v.owner, v.sequence!, v.operationId!);
      default:
        throw Error("unknown kind");
    }
  };
  const results = vectors.map((v) => {
    if (!v.valid) {
      assert.throws(() => run(node, v), v.name);
      assert.throws(() => run(portable, v), v.name);
      return { name: v.name, accepted: false };
    }
    const actual = run(node, v);
    assert.equal(canonical(run(portable, v)), canonical(actual), v.name);
    return { name: v.name, accepted: true, result: actual };
  });
  const directory = projectTemp("contribution-journal-vectors-"),
    path = join(directory, "input.json");
  try {
    writeFileSync(path, JSON.stringify(vectors));
    const go = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestContributionOperationsWorker$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, RELAYLOOM_CONTRIBUTION_OPERATIONS: path },
      },
    );
    assert.equal(go.status, 0, go.stdout + go.stderr);
    const actual = JSON.parse(readFileSync(path + ".result.json", "utf8"));
    assert.equal(actual.length, results.length);
    for (let i = 0; i < results.length; i++)
      assert.deepEqual(actual[i], results[i], vectors[i].name);
    writeFileSync(
      ".cache/contribution-journal-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: vectors.length,
          accepted: vectors.filter((v) => v.valid).length,
          rejected: vectors.filter((v) => !v.valid).length,
          canonicalResultsAgree: true,
          scope:
            "Pure journal transitions Node/portable/Go, not catalogue persistence or transport.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
