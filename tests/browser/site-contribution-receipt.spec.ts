import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  createBundleAt,
  verifyStoredBundle,
  canonical,
} from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContributionProtocol } from "../../packages/sites/src/contribution-protocol";
import { createContributionReceiptProtocol } from "../../packages/sites/src/contribution-receipt";
let host: ReturnType<typeof createServer>, url: string;
test.beforeAll(async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
 import { createContributionReceiptProtocol } from './packages/sites/src/contribution-receipt';
 import { createSiteContributionProtocol } from './packages/sites/src/contribution-protocol';
 import { browserCertificateCrypto } from './packages/browser/src/certificate-crypto';
 import * as crypto from './packages/browser/src/crypto';
 Object.assign(window, { receiptFixture: { ...crypto, protocol: createContributionReceiptProtocol(browserCertificateCrypto), proposals: createSiteContributionProtocol(browserCertificateCrypto) } });
 `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    target: "es2022",
    format: "iife",
  });
  host = createServer((req, res) => {
    if (req.url === "/engine.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(compiled.outputFiles[0].contents);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="pt-PT"><title>Recibos: motor real</title><script src="/engine.js"></script><body>Fixture de protocolo</body></html>',
      );
    }
  });
  await new Promise<void>((done) => host.listen(0, "127.0.0.1", done));
  url = "http://127.0.0.1:" + (host.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done, fail) =>
    host.close((e) => (e ? fail(e) : done())),
  );
});

test("actual browser and Node authenticate owner receipts with exact private readers, original references and corruption controls", async ({
  page,
}) => {
  const owner = createIdentity("Node owner"),
    visitor = createIdentity("Node visitor"),
    t = Date.now(),
    proposals = createSiteContributionProtocol(nodeCertificateCrypto),
    protocol = createContributionReceiptProtocol(nodeCertificateCrypto),
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
      values: { name: "RECEIPT_BROWSER_SENTINEL" },
      publicationScope: "public",
    }),
    request = {
      contributorId: visitor.public.id,
      certificateId: proposal.id,
      operationId: proposal.body.operationId,
      target: proposal.body.target,
      proposalCreated: t,
      proposalExpires: t + 60000,
      verifiedAt: t + 1,
      created: t + 1,
      expires: t + 120000,
    },
    receipt = protocol.create(owner, request),
    content = { type: "site-contribution-receipt", receipt },
    bundle = createBundleAt(
      owner,
      "site-contribution-receipt",
      content,
      [visitor.public],
      request.expires - request.created,
      request.created,
    );
  await page.goto(url);
  const result = await page.evaluate(
    async ({ proposal, receipt, bundle }) => {
      const r = (window as any).receiptFixture,
        p = r.protocol;
      const native = p.matchProposal(receipt, proposal);
      const verified = await r.verifiedStoredBundle(bundle);
      p.matchEnvelope(verified, { type: "site-contribution-receipt", receipt });
      const owner = await r.createIdentity("Browser owner"),
        visitor = await r.createIdentity("Browser visitor"),
        outsider = await r.createIdentity("Relay without keys"),
        now = Date.now(),
        { domain: _d, contributor: _c, ...body } = proposal.body,
        authored = r.proposals.create(visitor, {
          ...body,
          target: {
            ...body.target,
            site: "relayloom:site:" + owner.public.id + "/profile",
          },
          operationId: crypto.randomUUID(),
          created: now,
          expires: now + 60000,
        }),
        intent = {
          contributorId: visitor.public.id,
          certificateId: authored.id,
          operationId: authored.body.operationId,
          target: authored.body.target,
          proposalCreated: now,
          proposalExpires: now + 60000,
          verifiedAt: now,
          created: now,
          expires: now + 120000,
        },
        signed = p.create(owner, intent),
        plaintext = { type: "site-contribution-receipt", receipt: signed },
        encrypted = await r.createBundleAt(
          owner,
          "site-contribution-receipt",
          plaintext,
          [visitor.public],
          120000,
          now,
        );
      const ownerRead = await r.decryptStoredBundle(encrypted, owner),
        visitorRead = await r.decryptStoredBundle(encrypted, visitor);
      let outsiderRejected = false,
        tamperedRejected = false,
        substitutionRejected = false,
        publicRejected = false;
      try {
        await r.decryptStoredBundle(encrypted, outsider);
      } catch {
        outsiderRejected = true;
      }
      const forged = structuredClone(signed);
      forged.body.verifiedAt++;
      try {
        p.verify(forged);
      } catch {
        tamperedRejected = true;
      }
      const unrelated = p.create(owner, {
        ...intent,
        certificateId: "f".repeat(64),
      });
      try {
        p.matchProposal(unrelated, authored);
      } catch {
        substitutionRejected = true;
      }
      const publicEnvelope = await r.createBundleAt(
        owner,
        "site-contribution-receipt",
        plaintext,
        "public",
        120000,
        now,
      );
      try {
        p.matchEnvelope(publicEnvelope, plaintext);
      } catch {
        publicRejected = true;
      }
      return {
        nativeId: native.id,
        proposal: authored,
        receipt: signed,
        bundle: encrypted,
        plaintext,
        ownerMatches: r.canonical(ownerRead) === r.canonical(plaintext),
        visitorMatches: r.canonical(visitorRead) === r.canonical(plaintext),
        outsiderRejected,
        tamperedRejected,
        substitutionRejected,
        publicRejected,
      };
    },
    { proposal, receipt, bundle },
  );
  expect(result.nativeId).toBe(receipt.id);
  for (const k of [
    "ownerMatches",
    "visitorMatches",
    "outsiderRejected",
    "tamperedRejected",
    "substitutionRejected",
    "publicRejected",
  ] as const)
    expect(result[k]).toBe(true);
  verifyStoredBundle(result.bundle);
  expect(protocol.matchProposal(result.receipt, result.proposal)).toEqual(
    result.receipt,
  );
  expect(protocol.matchEnvelope(result.bundle, result.plaintext)).toEqual(
    result.plaintext,
  );
  expect(canonical(result.receipt)).not.toContain("RECEIPT_BROWSER_SENTINEL");
});
