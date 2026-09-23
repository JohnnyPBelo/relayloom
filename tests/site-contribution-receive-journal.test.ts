import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { projectTemp } from "./project-temp";
import { createIdentity, canonical } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import {
  createContributionOperations,
  UnmatchedContributionReceipt,
} from "../packages/sites/src/contribution-operations";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { createContributionReceiptProtocol } from "../packages/sites/src/contribution-receipt";
import { formSite } from "./fixtures/site-form";
import { siteFormBlocks } from "../packages/content/src/site";

test("receipt admission requires exact copied intent, retains cancellation/expiry and never revives a retired operation", () => {
  const visitor = createIdentity("Visitor"),
    owner = createIdentity("Owner"),
    other = createIdentity("Other owner"),
    now = 1700000000000,
    node = createContributionOperations(nodeCertificateCrypto),
    portable = createContributionOperations(browserCertificateCrypto),
    certificates = createSiteContributionProtocol(nodeCertificateCrypto),
    receipts = createContributionReceiptProtocol(nodeCertificateCrypto),
    binding = siteFormBlocks(formSite([visitor.public.id]))[0],
    context = {
      target: {
        site: "relayloom:site:" + owner.public.id + "/profile",
        snapshotId: "a".repeat(64),
        revisionId: "b".repeat(64),
        pageId: "entry",
        formId: "form",
      },
      form: binding.form,
      table: binding.table,
      siteScope: "public" as const,
      snapshotExpires: now + 60000,
    },
    request = {
      sequence: 1,
      operationId: randomUUID(),
      snapshotId: context.target.snapshotId,
      pageId: "entry",
      formId: "form",
      values: { name: "private values", count: 0, open: false },
      publicationScope: "public" as const,
      ttlMs: 30000,
    },
    prepared = node.prepare(
      node.initial(visitor.public.id),
      visitor.public.id,
      request,
      context,
      now,
    ),
    proposal = certificates.create(visitor, {
      target: context.target,
      schemaHash: prepared.operation.schemaHash,
      operationId: request.operationId,
      created: now,
      expires: prepared.operation.expires,
      values: request.values,
      publicationScope: request.publicationScope,
    }),
    signed = node.signed(
      prepared.record,
      visitor.public.id,
      prepared.operation,
      request,
      proposal,
    ),
    queued = node.queue(signed.record, visitor.public.id, signed.operation, {
      bundleId: "c".repeat(64),
      bundleHash: "d".repeat(64),
      bytes: 1000,
    }),
    copied = node.copied(
      queued.record,
      visitor.public.id,
      queued.operation,
      "d".repeat(64),
    ),
    intent = {
      contributorId: visitor.public.id,
      certificateId: proposal.id,
      operationId: request.operationId,
      target: context.target,
      proposalCreated: now,
      proposalExpires: prepared.operation.expires,
      verifiedAt: now + 1,
      created: now + 1,
      expires: now + 3600000,
    },
    receipt = receipts.create(owner, intent);
  const first = node.receive(
      copied.record,
      visitor.public.id,
      receipt,
      now + 2,
    ),
    cancelled = node.cancel(copied.record, visitor.public.id, copied.operation),
    expired = node.expire(
      copied.record,
      visitor.public.id,
      prepared.operation.expires,
    );
  type Vector = {
    name: string;
    kind: string;
    valid: boolean;
    owner: string;
    record: any;
    receipt: any;
    now: number;
  };
  const vectors: Vector[] = [];
  function add(
    name: string,
    kind: string,
    valid: boolean,
    extra: Partial<Vector> = {},
    mutate?: (v: Vector) => void,
  ) {
    const v = structuredClone({
      name,
      kind,
      valid,
      owner: visitor.public.id,
      record: copied.record,
      receipt,
      now: now + 2,
      ...extra,
    });
    mutate?.(v);
    vectors.push(v);
  }
  add("exact copied intent", "receiveReceipt", true);
  add("identical replay", "receiveReceipt", true, { record: first.record });
  add("cancelled remains cancelled", "receiveReceipt", true, {
    record: cancelled,
  });
  add("expired remains expired on late receipt", "receiveReceipt", true, {
    record: expired,
    now: prepared.operation.expires + 1000,
  });
  add(
    "another valid attestation cannot replace original",
    "receiveReceipt",
    true,
    {
      record: first.record,
      receipt: receipts.create(owner, {
        ...intent,
        verifiedAt: now + 2,
        created: now + 2,
      }),
    },
  );
  for (const [name, record] of [
    ["prepared", prepared.record],
    ["signed", signed.record],
    ["queued but not copied", queued.record],
  ] as const)
    add(name, "receiveReceipt", false, { record });
  add("wrong local contributor", "receiveReceipt", false, {
    owner: other.public.id,
  });
  add("unknown intent", "receiveReceipt", false, {
    record: node.initial(visitor.public.id),
  });
  add("exact receipt expiry", "receiveReceipt", false, { now: intent.expires });
  add("receipt just before expiry", "receiveReceipt", true, {
    record: expired,
    now: intent.expires - 1,
  });
  add("future tolerance boundary", "receiveReceipt", true, {
    now: intent.created - 300000,
  });
  add("future beyond tolerance", "receiveReceipt", false, {
    now: intent.created - 300001,
  });
  add("negative clock", "receiveReceipt", false, { now: -1 });
  add("fractional clock", "receiveReceipt", false, { now: now + 0.5 });
  add("unsafe clock", "receiveReceipt", false, {
    now: Number.MAX_SAFE_INTEGER + 1,
  });
  for (const [name, change] of [
    ["other certificate", { certificateId: "e".repeat(64) }],
    ["other UUID", { operationId: randomUUID() }],
    ["other contributor", { contributorId: other.public.id }],
    [
      "other snapshot",
      { target: { ...context.target, snapshotId: "e".repeat(64) } },
    ],
    [
      "other revision",
      { target: { ...context.target, revisionId: "e".repeat(64) } },
    ],
    ["other page", { target: { ...context.target, pageId: "another" } }],
    ["other form", { target: { ...context.target, formId: "another" } }],
    ["other creation", { proposalCreated: now - 1 }],
    ["other expiry", { proposalExpires: intent.proposalExpires + 1 }],
  ] as const)
    add(name, "receiveReceipt", false, {
      receipt: receipts.create(owner, { ...intent, ...change }),
    });
  add("other signing owner", "receiveReceipt", false, {
    receipt: receipts.create(other, {
      ...intent,
      target: {
        ...context.target,
        site: "relayloom:site:" + other.public.id + "/profile",
      },
    }),
  });
  add("forged owner signature", "receiveReceipt", false, {}, (v) => {
    v.receipt.signature = "A".repeat(88);
  });
  add("extra receipt authority", "receiveReceipt", false, {}, (v) => {
    v.receipt.approved = true;
  });
  add("received journal authentic", "validate", true, { record: first.record });
  add(
    "received without attestation",
    "validate",
    false,
    { record: first.record },
    (v) => {
      delete v.record.operations[0].receipt;
    },
  );
  add(
    "received without copied fact",
    "validate",
    false,
    { record: first.record },
    (v) => {
      v.record.operations[0].transport.copied = false;
    },
  );
  add(
    "received with mutated reference",
    "validate",
    false,
    { record: first.record },
    (v) => {
      v.record.operations[0].target.formId = "other";
    },
  );
  add(
    "received signature corruption",
    "validate",
    false,
    { record: first.record },
    (v) => {
      v.record.operations[0].receipt.signature = "A".repeat(88);
    },
  );
  add(
    "receipt cannot remain queued",
    "validate",
    false,
    { record: first.record },
    (v) => {
      v.record.operations[0].phase = "queued";
    },
  );
  const cancellationFact = node.receive(
    cancelled,
    visitor.public.id,
    receipt,
    now + 2,
  ).record;
  add("cancelled with historical receipt", "validate", true, {
    record: cancellationFact,
  });
  add("historical authenticity after receipt lifetime", "validate", true, {
    record: first.record,
    now: intent.expires + 1,
  });
  let retired = first.record;
  for (let sequence = 2; sequence <= 129; sequence++) {
    const next = node.prepare(
      retired,
      visitor.public.id,
      { ...request, sequence, operationId: randomUUID() },
      context,
      now + 2,
    );
    retired = node.cancel(next.record, visitor.public.id, next.operation);
  }
  assert.equal(
    node.lookup(retired, visitor.public.id, 1, request.operationId).retired,
    true,
  );
  add("retired original cannot reappear", "receiveReceipt", false, {
    record: retired,
  });
  add("retired window remains valid", "validate", true, { record: retired });
  const run = (p: typeof node, v: Vector) =>
    v.kind === "validate"
      ? p.validate(v.record, v.owner)
      : p.receive(v.record, v.owner, v.receipt, v.now);
  assert.throws(
    () =>
      node.receive(
        node.initial(visitor.public.id),
        visitor.public.id,
        receipt,
        now + 2,
      ),
    UnmatchedContributionReceipt,
  );
  const damaged = structuredClone(first.record);
  damaged.operations[0].target.formId = "corrupt-local-record";
  assert.throws(
    () => node.receive(damaged, visitor.public.id, receipt, now + 2),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UnmatchedContributionReceipt),
    "stored corruption is not a benign unmatched wire fact",
  );
  const forged = structuredClone(receipt);
  forged.signature = "A".repeat(88);
  assert.throws(
    () => node.receive(copied.record, visitor.public.id, forged, now + 2),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UnmatchedContributionReceipt),
    "signature failure is not benign history retirement",
  );
  const results = vectors.map((v) => {
    if (!v.valid) {
      assert.throws(() => run(node, v), v.name);
      assert.throws(() => run(portable, v), v.name);
      return { name: v.name, accepted: false };
    }
    const result = run(node, v);
    assert.equal(canonical(run(portable, v)), canonical(result), v.name);
    return { name: v.name, accepted: true, result };
  });
  const directory = projectTemp("receipt-admission-vectors-"),
    path = join(directory, "vectors.json");
  try {
    writeFileSync(path, JSON.stringify(vectors), { mode: 0o600 });
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
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_CONTRIBUTION_OPERATIONS: path },
      },
    );
    assert.equal(go.status, 0, go.stdout + go.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(path + ".result.json", "utf8")),
      results,
    );
    writeFileSync(
      ".cache/receipt-admission-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: vectors.length,
          accepted: vectors.filter((v) => v.valid).length,
          rejected: vectors.filter((v) => !v.valid).length,
          canonicalResultsAgree: true,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const p of [node, portable]) {
    for (const record of [prepared.record, signed.record, queued.record])
      assert.throws(() =>
        p.receive(record, visitor.public.id, receipt, now + 2),
      );
    const first = p.receive(copied.record, visitor.public.id, receipt, now + 2);
    assert.equal(first.operation.phase, "received");
    assert.deepEqual(first.operation.receipt, receipt);
    assert.equal(first.changed, true);
    assert.deepEqual(
      p.receive(first.record, visitor.public.id, receipt, now + 3),
      { ...first, changed: false },
    );
    assert.equal(
      p.expire(first.record, visitor.public.id, intent.expires).operations[0]
        .phase,
      "received",
    );
    assert.throws(() =>
      p.cancel(first.record, visitor.public.id, first.operation),
    );
    const cancelled = p.cancel(
        copied.record,
        visitor.public.id,
        copied.operation,
      ),
      expired = p.expire(
        copied.record,
        visitor.public.id,
        prepared.operation.expires,
      );
    for (const record of [cancelled, expired]) {
      const late = p.receive(
        record,
        visitor.public.id,
        receipt,
        prepared.operation.expires + 1000,
      );
      assert.equal(late.operation.phase, record.operations[0].phase);
      assert.deepEqual(late.operation.receipt, receipt);
      assert.equal(late.operation.expires, prepared.operation.expires);
    }
    const secondReceipt = receipts.create(owner, {
      ...intent,
      created: now + 2,
      verifiedAt: now + 2,
    });
    assert.deepEqual(
      p.receive(first.record, visitor.public.id, secondReceipt, now + 3),
      { ...first, changed: false },
    );
    for (const change of [
      { certificateId: "e".repeat(64) },
      { operationId: randomUUID() },
      { contributorId: other.public.id },
      { target: { ...context.target, revisionId: "e".repeat(64) } },
      { target: { ...context.target, formId: "another" } },
      { proposalCreated: now - 1 },
      { proposalExpires: intent.proposalExpires + 1 },
    ])
      assert.throws(() =>
        p.receive(
          copied.record,
          visitor.public.id,
          receipts.create(owner, { ...intent, ...change }),
          now + 2,
        ),
      );
    const foreign = receipts.create(other, {
      ...intent,
      target: {
        ...context.target,
        site: "relayloom:site:" + other.public.id + "/profile",
      },
    });
    assert.throws(() =>
      p.receive(copied.record, visitor.public.id, foreign, now + 2),
    );
    assert.throws(() =>
      p.receive(copied.record, visitor.public.id, receipt, intent.expires),
    );
    assert.throws(() =>
      p.receive(
        copied.record,
        visitor.public.id,
        receipt,
        intent.created - 300001,
      ),
    );
    assert.throws(() =>
      p.receive(
        p.initial(visitor.public.id),
        visitor.public.id,
        receipt,
        now + 2,
      ),
    );
    assert.equal(
      canonical(p.validate(first.record, visitor.public.id)),
      canonical(first.record),
    );
  }
  assert.equal(
    canonical(node.receive(copied.record, visitor.public.id, receipt, now + 2)),
    canonical(
      portable.receive(copied.record, visitor.public.id, receipt, now + 2),
    ),
  );
});
