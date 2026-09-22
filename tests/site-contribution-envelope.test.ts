import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  createBundleAt,
  decryptStoredBundle,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { createContributionEnvelopeProtocol } from "../packages/sites/src/contribution-envelope";

test("private proposal envelope binds actual author, exactly two logical readers and the original certificate deadline", () => {
  const visitor = createIdentity("Visitor"),
    owner = createIdentity("Owner"),
    extra = createIdentity("Extra"),
    now = Date.now(),
    protocol = createSiteContributionProtocol(nodeCertificateCrypto);
  const certificate = protocol.create(visitor, {
    target: {
      site: "relayloom:site:" + owner.public.id + "/profile",
      snapshotId: "a".repeat(64),
      revisionId: "b".repeat(64),
      pageId: "home",
      formId: "form",
    },
    schemaHash: "c".repeat(64),
    operationId: randomUUID(),
    created: now,
    expires: now + 60000,
    values: { text: "Public grant but private submission" },
    publicationScope: "public",
  });
  const content = { type: "site-contribution", proposal: certificate },
    envelopes = [
      createContributionEnvelopeProtocol(nodeCertificateCrypto),
      createContributionEnvelopeProtocol(browserCertificateCrypto),
    ];
  const good = createBundleAt(
    visitor,
    "site-contribution",
    content,
    [owner.public],
    60000,
    now,
  );
  for (const envelope of envelopes) {
    assert.equal(
      canonical(envelope.match(good, decryptStoredBundle(good, owner))),
      canonical(content),
    );
    assert.throws(() => envelope.content({ ...content, approved: true }));
  }
  for (const bad of [
    createBundleAt(visitor, "site-contribution", content, "public", 60000, now),
    createBundleAt(
      visitor,
      "site-contribution",
      content,
      [owner.public, extra.public],
      60000,
      now,
    ),
    createBundleAt(visitor, "site-contribution", content, [], 60000, now),
    createBundleAt(visitor, "post", content, [owner.public], 60000, now),
    createBundleAt(
      extra,
      "site-contribution",
      content,
      [owner.public],
      60000,
      now,
    ),
    createBundleAt(
      visitor,
      "site-contribution",
      content,
      [owner.public],
      60000,
      now + 1,
    ),
    createBundleAt(
      visitor,
      "site-contribution",
      content,
      [owner.public],
      60001,
      now,
    ),
  ]) {
    const plain = decryptStoredBundle(
      bad,
      bad.manifest.author.id === extra.public.id ? extra : visitor,
    );
    for (const envelope of envelopes)
      assert.throws(() => envelope.match(bad, plain));
  }
  const own = protocol.create(owner, {
    target: { ...certificate.body.target },
    schemaHash: certificate.body.schemaHash,
    operationId: randomUUID(),
    created: now,
    expires: now + 60000,
    values: { text: "Owner also contributes" },
    publicationScope: [owner.public.id],
  });
  const single = createBundleAt(
    owner,
    "site-contribution",
    { type: "site-contribution", proposal: own },
    [owner.public],
    60000,
    now,
  );
  for (const envelope of envelopes)
    assert.equal(
      envelope.match(single, decryptStoredBundle(single, owner)).proposal.id,
      own.id,
    );
});
