import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createIdentity, canonical } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import {
  createContributionInboxProtocol,
  CONTRIBUTION_INBOX_LIMITS as limits,
} from "../packages/sites/src/contribution-inbox";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { projectTemp } from "./project-temp";

test("Node, portable and real Go inbox transitions agree on replay, finite retention, conflicts and quotas", () => {
  const owner = createIdentity("Inbox owner"),
    visitor = createIdentity("Inbox contributor"),
    t = 1700000000000,
    node = createContributionInboxProtocol(nodeCertificateCrypto),
    portable = createContributionInboxProtocol(browserCertificateCrypto),
    certificates = createSiteContributionProtocol(nodeCertificateCrypto),
    cert = certificates.create(visitor, {
      target: {
        site: "relayloom:site:" + owner.public.id + "/profile",
        snapshotId: "a".repeat(64),
        revisionId: "b".repeat(64),
        pageId: "entry",
        formId: "form",
      },
      schemaHash: "c".repeat(64),
      operationId: randomUUID(),
      created: t,
      expires: t + 60000,
      values: { name: "proposal", count: 0 },
      publicationScope: "public",
    }),
    make = (name: string, expires = t + 60000) => {
      const { domain: _domain, contributor: _contributor, ...body } = cert.body;
      return certificates.create(visitor, {
        ...body,
        values: { name, count: 0 },
        expires,
      });
    },
    proof = {
      bundleId: "d".repeat(64),
      envelopeHash: "e".repeat(64),
      digest: "f".repeat(64),
      bytes: 1024,
    },
    sourceProof = { ...proof, digest: "0".repeat(64), bytes: 2048 },
    initial = node.initial(owner.public.id),
    received = node.observe(initial, owner.public.id, cert, proof, t),
    verified = node.verified(
      received.record,
      owner.public.id,
      cert.id,
      sourceProof,
      t + 1,
    ),
    other = make("different", t + 120000),
    conflict = node.observe(
      verified.record,
      owner.public.id,
      other,
      proof,
      t + 2,
    ),
    expired = node.expire(verified.record, owner.public.id, cert.body.expires);
  type Vector = {
    revision: number;
    name: string;
    kind: string;
    valid: boolean;
    owner: string;
    record: any;
    certificate: any;
    proof: any;
    now: number;
    id: string;
    entry: any;
  };
  const vectors: Vector[] = [];
  const add = (
    name: string,
    kind: string,
    valid: boolean,
    overrides: Partial<Vector> = {},
    change?: (v: Vector) => void,
  ) => {
    const value = structuredClone({
      revision: received.record.revision,
      name,
      kind,
      valid,
      owner: owner.public.id,
      record: received.record,
      certificate: cert,
      proof,
      now: t,
      id: cert.id,
      entry: received.entry,
      ...overrides,
    });
    change?.(value);
    vectors.push(value);
  };
  add("initial", "initial", true);
  add("invalid owner", "initial", false, { owner: "bad" });
  add("initial shape", "validate", true, { record: initial });
  add("observe before source is verified", "observe", true, {
    record: initial,
  });
  add("duplicate keeps original envelope", "observe", true, {
    proof: { ...proof, bundleId: "1".repeat(64) },
  });
  add("conflicting UUID", "observe", true, {
    record: verified.record,
    certificate: other,
  });
  add("duplicate conflict is stable", "observe", true, {
    record: conflict.record,
    certificate: other,
  });
  const otherSite = (() => {
    const { domain: _d, contributor: _c, ...b } = cert.body;
    return certificates.create(visitor, {
      ...b,
      target: {
        ...b.target,
        site: "relayloom:site:" + owner.public.id + "/elsewhere",
      },
    });
  })();
  add("same operation across sites remains a conflict", "observe", true, {
    certificate: otherSite,
  });
  add("wrong recipient", "observe", false, {
    owner: visitor.public.id,
    record: node.initial(visitor.public.id),
  });
  add("forged certificate", "observe", false, {}, (v) => {
    v.certificate.body.values.name = "forged";
  });
  add("expired arrival", "observe", false, { now: cert.body.expires });
  add("clock skew boundary", "observe", true, {
    record: initial,
    now: t - 300000,
  });
  add("clock skew excess", "observe", false, {
    record: initial,
    now: t - 300001,
  });
  add("negative observation clock", "observe", false, {
    record: initial,
    now: -1,
  });
  add("unsafe observation clock", "observe", false, {
    now: Number.MAX_SAFE_INTEGER + 1,
  });
  add("source verified separately", "verified", true, {
    proof: sourceProof,
    now: t + 1,
  });
  add("source before observation", "verified", false, {
    proof: sourceProof,
    now: t - 1,
  });
  add("source after expiry", "verified", false, {
    proof: sourceProof,
    now: cert.body.expires,
  });
  add("source just before expiry", "verified", true, {
    proof: sourceProof,
    now: cert.body.expires - 1,
  });
  add("source cannot substitute envelope", "verified", false, {
    proof: { ...sourceProof, bundleId: "1".repeat(64) },
  });
  add("source cannot substitute envelope bytes", "verified", false, {
    proof: { ...sourceProof, envelopeHash: "1".repeat(64) },
  });
  add("verified proof idempotent", "verified", true, {
    record: verified.record,
    proof: sourceProof,
    now: t + 2,
  });
  add("verified proof immutable", "verified", false, {
    record: verified.record,
    proof: { ...sourceProof, digest: "1".repeat(64) },
    now: t + 2,
  });
  add("unknown entry", "verified", false, { id: "1".repeat(64) });
  add("expire active proof", "expire", true, {
    record: verified.record,
    now: cert.body.expires,
  });
  add("expire is idempotent", "expire", true, {
    record: expired,
    now: cert.body.expires,
  });
  add("retention final millisecond", "expire", true, {
    record: expired,
    now: expired.entries[0].retainUntil - 1,
  });
  add("retire after finite window", "expire", true, {
    record: expired,
    now: expired.entries[0].retainUntil,
  });
  add("conflict extends retention without replacing original", "expire", true, {
    record: conflict.record,
    now: cert.body.expires + limits.retentionMs,
  });
  add("negative expiry clock", "expire", false, { now: -1 });
  add("historical certificate binding", "checkCertificate", true);
  add("changed entry target", "checkCertificate", false, {}, (v) => {
    v.entry.target.formId = "changed";
  });
  add(
    "duplicate metadata must match certificate",
    "observe",
    false,
    {},
    (v) => {
      v.record.entries[0].target.formId = "changed";
    },
  );
  const invalid: [string, (v: Vector) => void][] = [
    [
      "extra record field",
      (v) => {
        v.record.extra = true;
      },
    ],
    [
      "unsafe revision",
      (v) => {
        v.record.revision = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "negative revision",
      (v) => {
        v.record.revision = -1;
      },
    ],
    [
      "unknown phase",
      (v) => {
        v.record.entries[0].phase = "approved";
      },
    ],
    [
      "missing verification",
      (v) => {
        v.record.entries[0].phase = "verified-candidate";
      },
    ],
    [
      "unverified source with timestamp",
      (v) => {
        v.record.entries[0].verifiedAt = t;
      },
    ],
    [
      "active proof absent",
      (v) => {
        v.record.entries[0].proof = null;
      },
    ],
    [
      "observation expired",
      (v) => {
        v.record.entries[0].observedAt = t + 60000;
      },
    ],
    [
      "unbounded retention",
      (v) => {
        v.record.entries[0].retainUntil++;
      },
    ],
    [
      "overflow before descriptor limit",
      (v) => {
        v.record.entries[0].conflictOverflow = true;
      },
    ],
    [
      "conflict repeats primary",
      (v) => {
        v.record.entries[0].conflicts = [
          { id: cert.id, expires: cert.body.expires },
        ];
      },
    ],
    [
      "duplicate operation entry",
      (v) => {
        v.record.entries.push({ ...v.record.entries[0], id: "1".repeat(64) });
      },
    ],
  ];
  for (const [name, change] of invalid)
    add(name, "validate", false, {}, change);
  add(
    "expired payload cannot remain",
    "validate",
    false,
    { record: expired },
    (v) => {
      v.record.entries[0].proof = proof;
    },
  );
  add(
    "expiry cannot precede deadline",
    "validate",
    false,
    { record: expired },
    (v) => {
      v.record.entries[0].expiredAt = t;
    },
  );
  const synthetic = (count: number, bytes = 1024, terminal = false) => ({
    ...initial,
    revision: 1,
    entries: Array.from({ length: count }, (_, i) => ({
      ...structuredClone(terminal ? expired.entries[0] : received.entry),
      id: (i + 1).toString(16).padStart(64, "0"),
      operationId: randomUUID(),
      contributorId: Math.floor(i / 32)
        .toString(16)
        .padStart(64, "0"),
      proof: terminal ? null : { ...proof, bytes },
    })),
  });
  add("64 pending", "validate", true, { record: synthetic(64) });
  add("65 pending rejected", "validate", false, { record: synthetic(65) });
  add("32 per contributor", "validate", true, { record: synthetic(32) });
  add(
    "33 per contributor rejected",
    "validate",
    false,
    { record: synthetic(33) },
    (v) => {
      v.record.entries.forEach((e: any) => {
        e.contributorId = visitor.public.id;
      });
    },
  );
  add("256 retained entries", "validate", true, {
    record: synthetic(256, 1024, true),
  });
  add("257 retained entries rejected", "validate", false, {
    record: synthetic(257, 1024, true),
  });
  add("32 MiB proof boundary", "validate", true, {
    record: synthetic(8, 4 * 1024 * 1024),
  });
  add(
    "aggregate proof excess",
    "validate",
    false,
    { record: synthetic(8, 4 * 1024 * 1024) },
    (v) => {
      v.record.entries[0].proof.bytes++;
    },
  );
  add("individual proof boundary", "validate", true, {
    record: synthetic(1, limits.proofBytes),
  });
  add("individual proof excess", "validate", false, {
    record: synthetic(1, limits.proofBytes + 1),
  });
  let overflow = received.record;
  for (let i = 0; i <= limits.conflicts; i++)
    overflow = node.observe(
      overflow,
      owner.public.id,
      make("conflict-" + i),
      proof,
      t,
    ).record;
  add("bounded overflow descriptors", "validate", true, { record: overflow });
  add("overflow repeat is stable", "observe", true, {
    record: overflow,
    certificate: make("further"),
  });
  add("overflow can extend retention", "observe", true, {
    record: overflow,
    certificate: other,
  });
  add(
    "five conflict descriptors rejected",
    "validate",
    false,
    { record: overflow },
    (v) => {
      v.record.entries[0].conflicts.push({
        id: "9".repeat(64),
        expires: cert.body.expires,
      });
    },
  );
  const dismissed = node.dismiss(
    verified.record,
    owner.public.id,
    cert.id,
    verified.record.revision,
    t + 2,
  );
  add("dismiss missing source", "dismiss", true);
  add("dismiss verified retains fact", "dismiss", true, {
    record: verified.record,
    revision: verified.record.revision,
    now: t + 2,
  });
  add("stale revision cannot discard changed candidate", "dismiss", false, {
    record: verified.record,
    now: t + 2,
  });
  add("future revision refused", "dismiss", false, { revision: 2 });
  add("negative revision refused", "dismiss", false, { revision: -1 });
  add("fractional revision refused", "dismiss", false, { revision: 1.5 });
  add("missing candidate refused", "dismiss", false, { id: "9".repeat(64) });
  add("cannot dismiss at expiry", "dismiss", false, { now: cert.body.expires });
  add("cannot dismiss before observation", "dismiss", false, { now: t - 1 });
  add("cannot dismiss before verification", "dismiss", false, {
    record: verified.record,
    revision: verified.record.revision,
  });
  add("expired proof not dismissible", "dismiss", false, {
    record: expired,
    revision: expired.revision,
    now: cert.body.expires,
  });
  add("dismissed valid", "validate", true, { record: dismissed.record });
  add("dismissed not reclassified by expiry", "expire", true, {
    record: dismissed.record,
    now: cert.body.expires,
  });
  add("dismissed retained window ends", "expire", true, {
    record: dismissed.record,
    now: dismissed.entry.retainUntil,
  });
  add("dismiss repeated with original revision", "dismiss", true, {
    record: dismissed.record,
    revision: verified.record.revision,
    now: t + 5,
  });
  add("dismiss repeated after expiry remains fact", "dismiss", true, {
    record: dismissed.record,
    revision: verified.record.revision,
    now: cert.body.expires,
  });
  add("dismiss future revision still refused on repeat", "dismiss", false, {
    record: dismissed.record,
    revision: dismissed.record.revision + 1,
  });
  add("discard suppresses rewrapped replay", "observe", true, {
    record: dismissed.record,
    proof: { ...proof, bundleId: "1".repeat(64) },
  });
  add("discard retains conflict protection", "observe", true, {
    record: dismissed.record,
    certificate: other,
  });
  add("discard cannot reattach source", "verified", false, {
    record: dismissed.record,
    proof: sourceProof,
  });
  for (const [name, change] of [
    [
      "discard timestamp missing",
      (e: any) => {
        delete e.dismissedAt;
      },
    ],
    [
      "discard proof remains",
      (e: any) => {
        e.proof = sourceProof;
      },
    ],
    [
      "discard before verification",
      (e: any) => {
        e.dismissedAt = t;
      },
    ],
    [
      "discard at expiry",
      (e: any) => {
        e.dismissedAt = cert.body.expires;
      },
    ],
    [
      "discard cannot also expire",
      (e: any) => {
        e.expiredAt = cert.body.expires;
      },
    ],
  ] as const)
    add(name, "validate", false, { record: dismissed.record }, (v) =>
      change(v.record.entries[0]),
    );
  add("active timestamp refused", "validate", false, {}, (v) => {
    v.record.entries[0].dismissedAt = t;
  });
  add("terminal future time refused", "dismiss", false, {
    record: dismissed.record,
    now: Number.MAX_SAFE_INTEGER + 1,
  });
  const run = (p: typeof node, v: Vector): any => {
    switch (v.kind) {
      case "initial":
        return p.initial(v.owner);
      case "validate":
        return p.validate(v.record, v.owner);
      case "observe":
        return p.observe(v.record, v.owner, v.certificate, v.proof, v.now);
      case "verified":
        return p.verified(v.record, v.owner, v.id, v.proof, v.now);
      case "dismiss":
        return p.dismiss(v.record, v.owner, v.id, v.revision, v.now);
      case "expire":
        return p.expire(v.record, v.owner, v.now);
      case "checkCertificate":
        return p.checkCertificate(v.entry, v.certificate, v.owner);
      default:
        throw Error("unknown vector");
    }
  };
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
  const directory = projectTemp("contribution-inbox-vectors-"),
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
        "^TestContributionInboxWorker$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_CONTRIBUTION_INBOX_VECTORS: path },
      },
    );
    assert.equal(go.status, 0, go.stdout + go.stderr);
    const actual = JSON.parse(readFileSync(path + ".result.json", "utf8"));
    assert.equal(actual.length, results.length);
    for (let i = 0; i < results.length; i++)
      assert.deepEqual(actual[i], results[i], vectors[i].name);
    writeFileSync(
      ".cache/contribution-inbox-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: vectors.length,
          accepted: vectors.filter((v) => v.valid).length,
          rejected: vectors.filter((v) => !v.valid).length,
          canonicalResultsAgree: true,
          scope:
            "Pure local journal Node/portable/Go transitions, not catalogue/runtime/approval evidence.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
