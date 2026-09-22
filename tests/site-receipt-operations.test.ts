import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createIdentity, canonical } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import {
  createReceiptOperations,
  RECEIPT_STORAGE_LIMITS,
} from "../packages/sites/src/contribution-receipt-operations";
import { createContributionReceiptProtocol } from "../packages/sites/src/contribution-receipt";
import { createContributionInboxProtocol } from "../packages/sites/src/contribution-inbox";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { projectTemp } from "./project-temp";

test("receipt journals agree across Node/portable/Go on immutable intent, phases, expiry and source binding", () => {
  const owner = createIdentity("Receipt owner"),
    visitor = createIdentity("Receipt visitor"),
    other = createIdentity("Wrong identity"),
    now = 1700000000000,
    node = createReceiptOperations(nodeCertificateCrypto),
    portable = createReceiptOperations(browserCertificateCrypto),
    inbox = createContributionInboxProtocol(nodeCertificateCrypto),
    portableInbox = createContributionInboxProtocol(browserCertificateCrypto),
    receipts = createContributionReceiptProtocol(nodeCertificateCrypto),
    proposal = createSiteContributionProtocol(nodeCertificateCrypto).create(
      visitor,
      {
        target: {
          site: "relayloom:site:" + owner.public.id + "/profile",
          snapshotId: "a".repeat(64),
          revisionId: "b".repeat(64),
          pageId: "entry",
          formId: "form",
        },
        schemaHash: "c".repeat(64),
        operationId: randomUUID(),
        created: now,
        expires: now + 60000,
        values: { name: "private" },
        publicationScope: "public",
      },
    ),
    proof = {
      bundleId: "d".repeat(64),
      envelopeHash: "e".repeat(64),
      digest: "f".repeat(64),
      bytes: 1024,
    },
    observed = inbox.observe(
      inbox.initial(owner.public.id),
      owner.public.id,
      proposal,
      proof,
      now,
    ),
    verified = inbox.verified(
      observed.record,
      owner.public.id,
      proposal.id,
      proof,
      now,
    ),
    preparedInbox = inbox.prepareReceipt(
      verified.record,
      owner.public,
      proposal,
    ),
    entry = preparedInbox.entry,
    prepared = entry.receipt!,
    certificate = receipts.create(owner, prepared.request),
    stage = { hash: "1".repeat(64), bytes: 2000 },
    signed = node.signed(
      prepared,
      owner.public.id,
      entry,
      certificate,
      stage,
      now,
    ),
    bundle = { id: "2".repeat(64), hash: "3".repeat(64) },
    queued = node.queued(signed, owner.public.id, entry, bundle, stage, now),
    copied = node.copied(
      queued,
      owner.public.id,
      entry,
      bundle.id,
      bundle.hash,
      now,
    ),
    expired = node.expire(
      copied,
      owner.public.id,
      entry,
      prepared.request.expires,
    );
  type V = { name: string; kind: string; valid: boolean; [key: string]: any };
  const vectors: V[] = [];
  const add = (
    name: string,
    kind: string,
    valid: boolean,
    changes: Record<string, any> = {},
    mutate?: (v: V) => void,
  ) => {
    const v = structuredClone({
      name,
      kind,
      valid,
      owner: owner.public,
      entry,
      proposal,
      operation: prepared,
      certificate,
      stage,
      bundle,
      now,
      record: preparedInbox.record,
      ...changes,
    });
    mutate?.(v);
    vectors.push(v);
  };
  add("prepare exact intent", "prepare", true);
  add("prepared valid", "validate", true);
  add("signed valid", "validate", true, { operation: signed });
  add("queued valid", "validate", true, { operation: queued });
  add("copied valid", "validate", true, { operation: copied });
  add("expired valid", "validate", true, { operation: expired });
  add("signature transition", "signed", true);
  add("queue transition", "queued", true, { operation: signed });
  add("copy transition", "copied", true, { operation: queued });
  add("copy idempotent", "copied", true, { operation: copied });
  add("before deadline", "expire", true, {
    operation: queued,
    now: prepared.request.expires - 1,
  });
  add("at deadline", "expire", true, {
    operation: queued,
    now: prepared.request.expires,
  });
  add(
    "cannot prepare without verification",
    "prepare",
    false,
    {},
    (v) => (v.entry.verifiedAt = null),
  );
  add("cannot prepare for another owner", "prepare", false, {
    owner: other.public,
  });
  add(
    "different entry certificate",
    "validate",
    false,
    {},
    (v) => (v.entry.id = "f".repeat(64)),
  );
  add(
    "unknown fields",
    "validate",
    false,
    {},
    (v) => (v.operation.approved = true),
  );
  add(
    "owner substitution",
    "validate",
    false,
    {},
    (v) => (v.operation.owner = other.public),
  );
  add(
    "recipient substitution",
    "validate",
    false,
    {},
    (v) => (v.operation.recipient = other.public),
  );
  add(
    "recipient card mutation",
    "validate",
    false,
    {},
    (v) => (v.operation.recipient.name = "tampered"),
  );
  add(
    "changed deadline",
    "validate",
    false,
    {},
    (v) => v.operation.request.expires--,
  );
  add(
    "fingerprint changed",
    "validate",
    false,
    {},
    (v) => (v.operation.fingerprint = "a".repeat(64)),
  );
  add(
    "signature before commit",
    "validate",
    false,
    {},
    (v) => (v.operation.certificateId = certificate.id),
  );
  add(
    "stage before signature",
    "validate",
    false,
    {},
    (v) => (v.operation.stage = stage),
  );
  add(
    "signed missing proof",
    "validate",
    false,
    { operation: signed },
    (v) => (v.operation.stage = null),
  );
  add(
    "queued missing transport",
    "validate",
    false,
    { operation: queued },
    (v) => delete v.operation.transport,
  );
  add(
    "expired retains stage",
    "validate",
    false,
    { operation: expired },
    (v) => (v.operation.stage = stage),
  );
  add(
    "signed receipt changed",
    "signed",
    false,
    {},
    (v) => (v.certificate.body.operationId = randomUUID()),
  );
  add(
    "wrong receipt for same owner",
    "signed",
    false,
    {},
    (v) =>
      (v.certificate = receipts.create(owner, {
        ...prepared.request,
        certificateId: "f".repeat(64),
      })),
  );
  add("expired signing", "signed", false, { now: prepared.request.expires });
  add("repeat sign phase rejected", "signed", false, { operation: signed });
  add("stage budget boundary", "signed", true, {
    stage: { ...stage, bytes: RECEIPT_STORAGE_LIMITS.stageBytes },
  });
  add("stage budget exceeded", "signed", false, {
    stage: { ...stage, bytes: RECEIPT_STORAGE_LIMITS.stageBytes + 1 },
  });
  add("queue before signature", "queued", false);
  add("queue after expiry", "queued", false, {
    operation: signed,
    now: prepared.request.expires,
  });
  add("copy wrong bundle", "copied", false, {
    operation: queued,
    bundle: { ...bundle, id: "9".repeat(64) },
  });
  add("copy wrong hash", "copied", false, {
    operation: queued,
    bundle: { ...bundle, hash: "9".repeat(64) },
  });
  add("copy after expiry", "copied", false, {
    operation: queued,
    now: prepared.request.expires,
  });
  add("inbox receipt prepare idempotent", "prepare-inbox", true);
  add("inbox signature update", "update-inbox", true, { operation: signed });
  add("inbox jumps to queued", "update-inbox", false, { operation: queued });
  const signedInbox = inbox.updateReceipt(
      preparedInbox.record,
      owner.public.id,
      entry.id,
      signed,
    ).record,
    queuedInbox = inbox.updateReceipt(
      signedInbox,
      owner.public.id,
      entry.id,
      queued,
    ).record;
  add("inbox queue update", "update-inbox", true, {
    record: signedInbox,
    operation: queued,
  });
  add("inbox copy update", "update-inbox", true, {
    record: queuedInbox,
    operation: copied,
  });
  add("inbox cannot go back to prepared", "update-inbox", false, {
    record: signedInbox,
  });
  add("inbox cannot replace queued proof", "update-inbox", false, {
    record: queuedInbox,
    operation: { ...queued, stage: { ...stage, hash: "f".repeat(64) } },
  });
  add(
    "receipt without source verification",
    "validate-inbox",
    false,
    {},
    (v) => {
      v.record.entries[0].verifiedAt = null;
      v.record.entries[0].phase = "missing-source";
    },
  );
  const receiptQuota = (count: number) => {
    const entries = Array.from({ length: count }, (_, i) => {
      const e = structuredClone(entry),
        id = (i + 1).toString(16).padStart(64, "0"),
        operationId = randomUUID();
      e.id = id;
      e.operationId = operationId;
      e.phase = "dismissed";
      e.dismissedAt = now;
      e.proof = null;
      const op = structuredClone(signed);
      op.request.certificateId = id;
      op.request.operationId = operationId;
      op.stage!.bytes = RECEIPT_STORAGE_LIMITS.stageBytes;
      op.fingerprint = nodeCertificateCrypto.hash(
        canonical({
          domain: "relayloom/contribution-receipt-intent/1",
          owner: op.owner,
          recipient: op.recipient,
          request: op.request,
        }),
      );
      e.receipt = op;
      return e;
    });
    return { ...preparedInbox.record, entries };
  };
  add("receipt aggregate byte boundary", "validate-inbox", true, {
    record: receiptQuota(64),
  });
  add("receipt aggregate byte excess", "validate-inbox", false, {
    record: receiptQuota(65),
  });
  add("signed proof minimum", "validate", false, { operation: signed }, (v) => {
    v.operation.stage.bytes = 0;
  });
  add(
    "copied must be boolean",
    "validate",
    false,
    { operation: queued },
    (v) => {
      v.operation.transport.copied = 1;
    },
  );
  add("unknown phase rejected", "validate", false, {}, (v) => {
    v.operation.phase = "approved";
  });
  const run = (p: typeof node, v: V) => {
    switch (v.kind) {
      case "prepare":
        return p.prepare(v.owner, v.entry, v.proposal);
      case "validate":
        return p.validate(v.operation, v.owner.id, v.entry);
      case "signed":
        return p.signed(
          v.operation,
          v.owner.id,
          v.entry,
          v.certificate,
          v.stage,
          v.now,
        );
      case "queued":
        return p.queued(
          v.operation,
          v.owner.id,
          v.entry,
          v.bundle,
          v.stage,
          v.now,
        );
      case "copied":
        return p.copied(
          v.operation,
          v.owner.id,
          v.entry,
          v.bundle.id,
          v.bundle.hash,
          v.now,
        );
      case "expire":
        return p.expire(v.operation, v.owner.id, v.entry, v.now);
      case "prepare-inbox":
        return (p === node ? inbox : portableInbox).prepareReceipt(
          v.record,
          v.owner,
          v.proposal,
        );
      case "update-inbox":
        return (p === node ? inbox : portableInbox).updateReceipt(
          v.record,
          v.owner.id,
          v.entry.id,
          v.operation,
        );
      case "validate-inbox":
        return (p === node ? inbox : portableInbox).validate(
          v.record,
          v.owner.id,
        );
      default:
        throw Error("unknown vector");
    }
  };
  for (const adapter of [node, portable]) {
    adapter.validate(prepared, owner.public.id, entry);
    const withSymbol = structuredClone(prepared);
    Object.defineProperty(withSymbol.owner, Symbol("extra"), { value: true });
    assert.throws(
      () => adapter.validate(withSymbol, owner.public.id, entry),
      "cached identity cannot bypass closed shape",
    );
    const accessor = structuredClone(prepared);
    let invoked = false;
    Object.defineProperty(accessor.owner, "name", {
      get() {
        invoked = true;
        return owner.public.name;
      },
      enumerable: true,
    });
    assert.throws(() => adapter.validate(accessor, owner.public.id, entry));
    assert.equal(invoked, false, "identity cache never reads a caller getter");
  }
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
  const directory = projectTemp("receipt-operations-"),
    path = join(directory, "vectors.json");
  try {
    writeFileSync(path, JSON.stringify(vectors), { mode: 0o600 });
    const g = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestReceiptOperationsWorker$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_RECEIPT_OPERATIONS: path },
      },
    );
    assert.equal(g.status, 0, g.stdout + g.stderr);
    const actual = JSON.parse(readFileSync(path + ".result.json", "utf8"));
    assert.deepEqual(actual, results);
    writeFileSync(
      ".cache/receipt-operations-vectors.json",
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
});
