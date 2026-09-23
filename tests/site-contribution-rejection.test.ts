import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  createBundleAt,
  canonical,
  verifyStoredBundle,
  decryptStoredBundle,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import {
  createContributionRejectionProtocol,
  CONTRIBUTION_REJECTION_LIMITS,
} from "../packages/sites/src/contribution-rejection";
import { projectTemp } from "./project-temp";

test("owner refusals bind the original proposal and exact private envelope across Node, portable crypto and Go", () => {
  const owner = createIdentity("Dona da página · 山"),
    visitor = createIdentity("Visitor"),
    outsider = createIdentity("Wrong party"),
    t = 1700000000000,
    node = createContributionRejectionProtocol(nodeCertificateCrypto),
    portable = createContributionRejectionProtocol(browserCertificateCrypto),
    proposals = createSiteContributionProtocol(nodeCertificateCrypto),
    proposal = proposals.create(visitor, {
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
      values: { name: "PRIVATE_NOT_IN_REJECTION" },
      publicationScope: "public",
    }),
    request = {
      contributorId: visitor.public.id,
      certificateId: proposal.id,
      operationId: proposal.body.operationId,
      target: proposal.body.target,
      proposalCreated: t,
      proposalExpires: t + 60000,
      decidedAt: t + 1,
      reason: "Não incorporar nesta página. 山",
      expires: t + 1 + CONTRIBUTION_REJECTION_LIMITS.lifetimeMs,
    },
    rejection = node.create(owner, request),
    plaintext = { type: "site-contribution-rejection", rejection },
    bundle = createBundleAt(
      owner,
      "site-contribution-rejection",
      plaintext,
      [visitor.public],
      request.expires - request.decidedAt,
      request.decidedAt,
    );
  assert(!canonical(rejection).includes("PRIVATE_NOT_IN_REJECTION"));
  assert.deepEqual(node.matchProposal(rejection, proposal), rejection);
  assert.deepEqual(portable.create(owner, request), rejection);
  assert.throws(() => decryptStoredBundle(bundle, outsider));
  assert.equal(bundle.manifest.publicKey, null);
  for (const p of [node, portable]) {
    let touched = false;
    const accessor = { ...request };
    Object.defineProperty(accessor, "reason", {
      get: () => {
        touched = true;
        return "no";
      },
      enumerable: true,
    });
    assert.throws(() => p.create(owner, accessor));
    assert.equal(touched, false);
    const symbolic = { ...request, [Symbol("authority")]: true };
    assert.throws(() => p.create(owner, symbolic));
    const input = structuredClone(request),
      checked = p.request(input, owner.public);
    checked.reason = "changed";
    checked.target.pageId = "different";
    assert.deepEqual(input, request);
  }
  const detached = node.verify(rejection);
  detached.body.target.pageId = "mutated";
  assert.equal(rejection.body.target.pageId, "entry");
  type Vector = {
    name: string;
    kind: string;
    valid: boolean;
    request: any;
    identity: any;
    rejection: any;
    proposal: any;
    bundle: any;
    plaintext: any;
  };
  const vectors: Vector[] = [];
  function add(
    name: string,
    kind: string,
    valid: boolean,
    change?: (v: Vector) => void,
  ) {
    const v = structuredClone({
      name,
      kind,
      valid,
      request,
      identity: owner,
      rejection,
      proposal,
      bundle,
      plaintext,
    });
    change?.(v);
    vectors.push(v);
  }
  add("owner creates deterministic explicit refusal", "create", true);
  add(
    "historical refusal is not source verification or a publication grant",
    "verify",
    true,
  );
  add("matches original proposal", "match", true);
  add("exact private envelope", "envelope", true);
  add("wrong signing owner", "create", false, (v) => {
    v.identity = outsider;
  });
  add("reading secret cannot sign for owner", "create", false, (v) => {
    v.identity.signSecret = visitor.signSecret;
  });
  const requestFailures: [string, (v: any) => void][] = [
    [
      "reason too long",
      (v) => {
        v.reason = "x".repeat(513);
      },
    ],
    [
      "reason too many UTF16 units",
      (v) => {
        v.reason = "🧭".repeat(257);
      },
    ],
    [
      "non-string reason",
      (v) => {
        v.reason = { text: "no" };
      },
    ],
    [
      "missing reason",
      (v) => {
        delete v.reason;
      },
    ],
    [
      "negative decision",
      (v) => {
        v.decidedAt = -1;
      },
    ],
    [
      "unknown intent field",
      (v) => {
        v.approved = true;
      },
    ],
    [
      "invalid contributor",
      (v) => {
        v.contributorId = "wrong";
      },
    ],
    [
      "invalid certificate",
      (v) => {
        v.certificateId = "A".repeat(64);
      },
    ],
    [
      "invalid operation",
      (v) => {
        v.operationId = "reused";
      },
    ],
    [
      "unknown target field",
      (v) => {
        v.target.extra = true;
      },
    ],
    [
      "wrong target owner",
      (v) => {
        v.target.site = "relayloom:site:" + outsider.public.id + "/profile";
      },
    ],
    [
      "invalid page",
      (v) => {
        v.target.pageId = "<script>";
      },
    ],
    [
      "invalid snapshot",
      (v) => {
        v.target.snapshotId = "z".repeat(64);
      },
    ],
    [
      "decision beyond clock skew",
      (v) => {
        v.decidedAt = t - 300001;
        v.expires = v.decidedAt + 1000;
      },
    ],
    [
      "rejection lifetime exceeded",
      (v) => {
        v.expires++;
      },
    ],
    [
      "rejection zero lifetime",
      (v) => {
        v.expires = v.decidedAt;
      },
    ],
    [
      "fractional decision",
      (v) => {
        v.decidedAt += 0.5;
      },
    ],
    [
      "unsafe timestamp",
      (v) => {
        v.expires = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "proposal lifetime exceeded",
      (v) => {
        v.proposalExpires = t + 30 * 86400000 + 1;
      },
    ],
    [
      "proposal zero lifetime",
      (v) => {
        v.proposalExpires = t;
      },
    ],
  ];
  for (const [name, change] of requestFailures)
    add(name, "create", false, (v) => change(v.request));
  add("clock skew boundary", "create", true, (v) => {
    v.request.decidedAt = t - 300000;
    v.request.expires = v.request.decidedAt + 1000;
  });
  add("refusal immediately before grant expiry", "create", true, (v) => {
    v.request.decidedAt = t + 59999;
    v.request.expires = t + 60000;
  });
  add(
    "refusal at proposal expiry conveys no new grant",
    "create",
    true,
    (v) => {
      v.request.decidedAt = t + 60000;
      v.request.expires = t + 61000;
    },
  );
  add(
    "refusal after proposal expiry is a historical decision",
    "create",
    true,
    (v) => {
      v.request.decidedAt = t + 86400000;
      v.request.expires = v.request.decidedAt + 1000;
    },
  );
  for (const reason of [
    "",
    "x".repeat(512),
    "🧭".repeat(256),
    "\ud800",
    "<script>no execution</script>\nRecusa · 山",
  ]) {
    add(
      "bounded reason " + JSON.stringify(reason).slice(0, 32),
      "create",
      true,
      (v) => {
        v.request.reason = reason;
      },
    );
  }
  add("validated detached request", "request", true);
  add("unknown request field", "request", false, (v) => {
    v.request.approved = true;
  });
  for (const [name, change] of [
    [
      "certificate extra field",
      (v: any) => {
        v.approved = true;
      },
    ],
    [
      "wrong hash",
      (v: any) => {
        v.id = "1".repeat(64);
      },
    ],
    [
      "changed body",
      (v: any) => {
        v.body.target.formId = "changed";
      },
    ],
    [
      "wrong domain",
      (v: any) => {
        v.body.domain = "relayloom/site-contribution/1";
      },
    ],
    [
      "malformed signature",
      (v: any) => {
        v.signature = "A".repeat(88);
      },
    ],
    [
      "short signature",
      (v: any) => {
        v.signature = "AA==";
      },
    ],
    [
      "unknown body field",
      (v: any) => {
        v.body.decision = "accept";
      },
    ],
  ] as const)
    add(name, "verify", false, (v) => change(v.rejection));
  for (const [name, change] of [
    [
      "other certificate",
      (v: any) => {
        v.certificateId = "e".repeat(64);
      },
    ],
    [
      "other UUID",
      (v: any) => {
        v.operationId = randomUUID();
      },
    ],
    [
      "other contributor",
      (v: any) => {
        v.contributorId = outsider.public.id;
      },
    ],
    [
      "other form",
      (v: any) => {
        v.target.formId = "other";
      },
    ],
    [
      "other snapshot",
      (v: any) => {
        v.target.snapshotId = "e".repeat(64);
      },
    ],
    [
      "other source revision",
      (v: any) => {
        v.target.revisionId = "e".repeat(64);
      },
    ],
    [
      "other creation",
      (v: any) => {
        v.proposalCreated--;
      },
    ],
    [
      "other expiry",
      (v: any) => {
        v.proposalExpires++;
      },
    ],
  ] as const)
    add(name, "match", false, (v) => {
      change(v.request);
      v.rejection = node.create(owner, v.request);
    });
  add("forged original proposal", "match", false, (v) => {
    v.proposal.body.values.name = "forged";
  });
  add("content discriminator", "envelope", false, (v) => {
    v.plaintext.type = "rejection";
  });
  add("extra plaintext authority", "envelope", false, (v) => {
    v.plaintext.approved = true;
  });
  add("public envelope rejected", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      owner,
      "site-contribution-rejection",
      plaintext,
      "public",
      request.expires - request.decidedAt,
      request.decidedAt,
    );
  });
  add("extra reader rejected", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      owner,
      "site-contribution-rejection",
      plaintext,
      [visitor.public, outsider.public],
      request.expires - request.decidedAt,
      request.decidedAt,
    );
  });
  add("missing contributor rejected", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      owner,
      "site-contribution-rejection",
      plaintext,
      [],
      request.expires - request.decidedAt,
      request.decidedAt,
    );
  });
  add("outer author substituted", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      outsider,
      "site-contribution-rejection",
      plaintext,
      [owner.public, visitor.public],
      request.expires - request.decidedAt,
      request.decidedAt,
    );
  });
  add("outer kind changed", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      owner,
      "rejection",
      plaintext,
      [visitor.public],
      request.expires - request.decidedAt,
      request.decidedAt,
    );
  });
  add("outer timestamp renewed", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      owner,
      "site-contribution-rejection",
      plaintext,
      [visitor.public],
      request.expires - request.decidedAt,
      request.decidedAt + 1,
    );
  });
  add("outer expiry changed", "envelope", false, (v) => {
    v.bundle = createBundleAt(
      owner,
      "site-contribution-rejection",
      plaintext,
      [visitor.public],
      request.expires - request.decidedAt - 1,
      request.decidedAt,
    );
  });
  add(
    "tampered ciphertext refused before rejection binding",
    "envelope",
    false,
    (v) => {
      const key = Object.keys(v.bundle.chunks)[0];
      const bytes = Buffer.from(v.bundle.chunks[key], "base64");
      bytes[0] ^= 1;
      v.bundle.chunks[key] = bytes.toString("base64");
    },
  );
  add(
    "self-contribution retains a single private reader",
    "envelope",
    true,
    (v) => {
      const { domain: _d, contributor: _c, ...body } = proposal.body;
      const self = proposals.create(owner, body),
        intent = {
          ...request,
          contributorId: owner.public.id,
          certificateId: self.id,
        },
        signed = node.create(owner, intent);
      v.plaintext = { type: "site-contribution-rejection", rejection: signed };
      v.bundle = createBundleAt(
        owner,
        "site-contribution-rejection",
        v.plaintext,
        [],
        intent.expires - intent.decidedAt,
        intent.decidedAt,
      );
    },
  );
  const run = (p: typeof node, v: Vector) => {
    if (v.kind === "create") return p.create(v.identity, v.request);
    if (v.kind === "request") return p.request(v.request, v.identity.public);
    if (v.kind === "verify") return p.verify(v.rejection);
    if (v.kind === "match") return p.matchProposal(v.rejection, v.proposal);
    verifyStoredBundle(v.bundle);
    decryptStoredBundle(v.bundle, owner);
    return p.matchEnvelope(v.bundle, v.plaintext);
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
  const directory = projectTemp("contribution-rejection-vectors-"),
    path = join(directory, "input.json");
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
        "^TestContributionRejectionWorker$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_CONTRIBUTION_REJECTION_VECTORS: path },
      },
    );
    assert.equal(go.status, 0, go.stdout + go.stderr);
    const actual = JSON.parse(readFileSync(path + ".result.json", "utf8"));
    assert.deepEqual(actual, results);
    writeFileSync(
      ".cache/contribution-rejection-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: vectors.length,
          accepted: vectors.filter((v) => v.valid).length,
          rejected: vectors.filter((v) => !v.valid).length,
          canonicalResultsAgree: true,
          scope:
            "Explicit refusal certificate/envelope protocol only; no durable decision journal, transport admission, delivery or UI claim.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
