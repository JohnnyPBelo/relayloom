import { createContributionReceiptProtocol } from "../packages/sites/src/contribution-receipt";
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
  UnmatchedContributionRejection,
} from "../packages/sites/src/contribution-operations";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { createContributionRejectionProtocol } from "../packages/sites/src/contribution-rejection";
import { formSite } from "./fixtures/site-form";
import { siteFormBlocks } from "../packages/content/src/site";

test("rejection admission requires exact copied intent, retains cancellation/expiry and never revives a retired operation", () => {
  const visitor = createIdentity("Visitor"),
    owner = createIdentity("Owner"),
    other = createIdentity("Other owner"),
    now = 1700000000000,
    node = createContributionOperations(nodeCertificateCrypto),
    portable = createContributionOperations(browserCertificateCrypto),
    certificates = createSiteContributionProtocol(nodeCertificateCrypto),
    rejections = createContributionRejectionProtocol(nodeCertificateCrypto),
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
      decidedAt: now + 1,
      reason: "Não incorporar",
      expires: now + 3600000,
    },
    rejection = rejections.create(owner, intent);
  const first = node.receiveRejection(
      copied.record,
      visitor.public.id,
      rejection,
      now + 2,
    ),
    cancelled = node.cancel(copied.record, visitor.public.id, copied.operation),
    expired = node.expire(
      copied.record,
      visitor.public.id,
      prepared.operation.expires,
    );
  type Vector = {
    receipt?: any;
    name: string;
    kind: string;
    valid: boolean;
    owner: string;
    record: any;
    rejection: any;
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
      rejection,
      now: now + 2,
      ...extra,
    });
    mutate?.(v);
    vectors.push(v);
  }
  add("exact copied intent", "receiveRejection", true);
  add("identical replay", "receiveRejection", true, { record: first.record });
  add("cancelled remains cancelled", "receiveRejection", true, {
    record: cancelled,
  });
  add("expired remains expired on late rejection", "receiveRejection", true, {
    record: expired,
    now: prepared.operation.expires + 1000,
  });
  add(
    "another valid attestation cannot replace original",
    "receiveRejection",
    true,
    {
      record: first.record,
      rejection: rejections.create(owner, {
        ...intent,
        decidedAt: now + 2,
        reason: "Different signed reason",
      }),
    },
  );
  for (const [name, record] of [
    ["prepared", prepared.record],
    ["signed", signed.record],
    ["queued but not copied", queued.record],
  ] as const)
    add(name, "receiveRejection", false, { record });
  add("wrong local contributor", "receiveRejection", false, {
    owner: other.public.id,
  });
  add("unknown intent", "receiveRejection", false, {
    record: node.initial(visitor.public.id),
  });
  add("exact rejection expiry", "receiveRejection", false, {
    now: intent.expires,
  });
  add("rejection just before expiry", "receiveRejection", true, {
    record: expired,
    now: intent.expires - 1,
  });
  add("future tolerance boundary", "receiveRejection", true, {
    now: intent.decidedAt - 300000,
  });
  add("future beyond tolerance", "receiveRejection", false, {
    now: intent.decidedAt - 300001,
  });
  add("negative clock", "receiveRejection", false, { now: -1 });
  add("fractional clock", "receiveRejection", false, { now: now + 0.5 });
  add("unsafe clock", "receiveRejection", false, {
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
    add(name, "receiveRejection", false, {
      rejection: rejections.create(owner, { ...intent, ...change }),
    });
  add("other signing owner", "receiveRejection", false, {
    rejection: rejections.create(other, {
      ...intent,
      target: {
        ...context.target,
        site: "relayloom:site:" + other.public.id + "/profile",
      },
    }),
  });
  add("forged owner signature", "receiveRejection", false, {}, (v) => {
    v.rejection.signature = "A".repeat(88);
  });
  add("extra rejection authority", "receiveRejection", false, {}, (v) => {
    v.rejection.approved = true;
  });
  add("received journal authentic", "validate", true, { record: first.record });
  add(
    "received without attestation",
    "validate",
    false,
    { record: first.record },
    (v) => {
      delete v.record.operations[0].rejection;
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
      v.record.operations[0].rejection.signature = "A".repeat(88);
    },
  );
  add(
    "rejection cannot remain queued",
    "validate",
    false,
    { record: first.record },
    (v) => {
      v.record.operations[0].phase = "queued";
    },
  );
  const cancellationFact = node.receiveRejection(
    cancelled,
    visitor.public.id,
    rejection,
    now + 2,
  ).record;
  add("cancelled with historical rejection", "validate", true, {
    record: cancellationFact,
  });
  add("historical authenticity after rejection lifetime", "validate", true, {
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
  add("retired original cannot reappear", "receiveRejection", false, {
    record: retired,
  });
  add("retired window remains valid", "validate", true, { record: retired });
  const receipt = createContributionReceiptProtocol(
    nodeCertificateCrypto,
  ).create(owner, {
    contributorId: visitor.public.id,
    certificateId: proposal.id,
    operationId: request.operationId,
    target: context.target,
    proposalCreated: now,
    proposalExpires: prepared.operation.expires,
    verifiedAt: now + 1,
    created: now + 1,
    expires: now + 3600000,
  });
  const received = node.receive(
    copied.record,
    visitor.public.id,
    receipt,
    now + 2,
  );
  add(
    "owner refusal after reception preserves the reception certificate",
    "receiveRejection",
    true,
    { record: received.record },
  );
  add(
    "late reception after refusal never reopens or downgrades the decision",
    "receiveReceipt",
    true,
    { record: first.record, receipt },
  );
  const both = node.receiveRejection(
    received.record,
    visitor.public.id,
    rejection,
    now + 2,
  );
  assert.deepEqual(
    node.receive(first.record, visitor.public.id, receipt, now + 2).record,
    both.record,
  );
  assert.equal(both.operation.phase, "rejected");
  assert.deepEqual(both.operation.receipt, receipt);
  add("both historical proofs remain authentic", "validate", true, {
    record: both.record,
  });
  for (const record of [cancelled, expired]) {
    const r = node.receiveRejection(
      record,
      visitor.public.id,
      rejection,
      now + 2,
    );
    add(
      "reception preserves historical refusal and local " +
        record.operations[0].phase,
      "receiveReceipt",
      true,
      { record: r.record, receipt },
    );
  }
  add(
    "refusal without previous handoff cannot fabricate a copied fact",
    "validate",
    false,
    { record: both.record },
    (v) => {
      v.record.operations[0].transport.copied = false;
    },
  );
  add(
    "a received phase cannot hide a stored refusal",
    "validate",
    false,
    { record: both.record },
    (v) => {
      v.record.operations[0].phase = "received";
    },
  );
  const run = (p: typeof node, v: Vector) =>
    v.kind === "validate"
      ? p.validate(v.record, v.owner)
      : v.kind === "receiveReceipt"
        ? p.receive(v.record, v.owner, v.receipt, v.now)
        : p.receiveRejection(v.record, v.owner, v.rejection, v.now);
  assert.throws(
    () =>
      node.receiveRejection(
        node.initial(visitor.public.id),
        visitor.public.id,
        rejection,
        now + 2,
      ),
    UnmatchedContributionRejection,
  );
  const damaged = structuredClone(first.record);
  damaged.operations[0].target.formId = "corrupt-local-record";
  assert.throws(
    () => node.receiveRejection(damaged, visitor.public.id, rejection, now + 2),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UnmatchedContributionRejection),
    "stored corruption is not a benign unmatched wire fact",
  );
  const forged = structuredClone(rejection);
  forged.signature = "A".repeat(88);
  assert.throws(
    () =>
      node.receiveRejection(copied.record, visitor.public.id, forged, now + 2),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UnmatchedContributionRejection),
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
  const directory = projectTemp("rejection-admission-vectors-"),
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
      ".cache/rejection-admission-vectors.json",
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
        p.receiveRejection(record, visitor.public.id, rejection, now + 2),
      );
    const first = p.receiveRejection(
      copied.record,
      visitor.public.id,
      rejection,
      now + 2,
    );
    assert.equal(first.operation.phase, "rejected");
    assert.deepEqual(first.operation.rejection, rejection);
    assert.equal(first.changed, true);
    assert.deepEqual(
      p.receiveRejection(first.record, visitor.public.id, rejection, now + 3),
      { ...first, changed: false },
    );
    assert.equal(
      p.expire(first.record, visitor.public.id, intent.expires).operations[0]
        .phase,
      "rejected",
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
      const late = p.receiveRejection(
        record,
        visitor.public.id,
        rejection,
        prepared.operation.expires + 1000,
      );
      assert.equal(late.operation.phase, record.operations[0].phase);
      assert.deepEqual(late.operation.rejection, rejection);
      assert.equal(late.operation.expires, prepared.operation.expires);
    }
    const secondRejection = rejections.create(owner, {
      ...intent,
      decidedAt: now + 2,
      reason: "Different signed reason",
    });
    assert.deepEqual(
      p.receiveRejection(
        first.record,
        visitor.public.id,
        secondRejection,
        now + 3,
      ),
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
        p.receiveRejection(
          copied.record,
          visitor.public.id,
          rejections.create(owner, { ...intent, ...change }),
          now + 2,
        ),
      );
    const foreign = rejections.create(other, {
      ...intent,
      target: {
        ...context.target,
        site: "relayloom:site:" + other.public.id + "/profile",
      },
    });
    assert.throws(() =>
      p.receiveRejection(copied.record, visitor.public.id, foreign, now + 2),
    );
    assert.throws(() =>
      p.receiveRejection(
        copied.record,
        visitor.public.id,
        rejection,
        intent.expires,
      ),
    );
    assert.throws(() =>
      p.receiveRejection(
        copied.record,
        visitor.public.id,
        rejection,
        intent.decidedAt - 300001,
      ),
    );
    assert.throws(() =>
      p.receiveRejection(
        p.initial(visitor.public.id),
        visitor.public.id,
        rejection,
        now + 2,
      ),
    );
    assert.equal(
      canonical(p.validate(first.record, visitor.public.id)),
      canonical(first.record),
    );
  }
  assert.equal(
    canonical(
      node.receiveRejection(
        copied.record,
        visitor.public.id,
        rejection,
        now + 2,
      ),
    ),
    canonical(
      portable.receiveRejection(
        copied.record,
        visitor.public.id,
        rejection,
        now + 2,
      ),
    ),
  );
});
