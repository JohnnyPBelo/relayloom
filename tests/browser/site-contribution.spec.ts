import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContributionProtocol } from "../../packages/sites/src/contribution-protocol";
import { projectTemp } from "../project-temp";
let server: ReturnType<typeof createServer>, url: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import * as crypto from './packages/browser/src/crypto';
import {browserCertificateCrypto} from './packages/browser/src/certificate-crypto';
import {createSiteContributionProtocol} from './packages/sites/src/contribution-protocol';
window.contributionFixture={...crypto,protocol:createSiteContributionProtocol(browserCertificateCrypto)};`,
      resolveDir: resolve("."),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "browser",
    target: "es2022",
    format: "iife",
  });
  server = createServer((req, res) => {
    if (req.url === "/engine.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
    } else if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="pt-PT"><title>Contrato de contribuições</title><script src="/engine.js"></script><body>Fixture de criptografia real, sem API de aprovação.</body></html>',
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done, fail) =>
    server.close((e) => (e ? fail(e) : done())),
  );
});

test("browser visitor certificates interoperate with Node and Go while encrypted proposals and publication consent remain separate", async ({
  page,
}, info) => {
  await page.goto(url);
  const result: any = await page.evaluate(async () => {
    const r = (window as any).contributionFixture,
      protocol = r.protocol;
    const owner = await r.createIdentity("Dona do site"),
      visitor = await r.createIdentity("Visitante browser"),
      stranger = await r.createIdentity("Sem leitura");
    const now = Date.now(),
      form = {
        domain: "relayloom/site-form/1",
        table: { pageId: "home", blockId: "table" },
        fields: [
          { column: "name", required: true },
          { column: "count", required: true },
          { column: "enabled", required: true },
        ],
        contributors: "readers",
      };
    const table = {
      domain: "relayloom/site-table/1",
      columns: [
        { id: "name", label: "Nome", type: "text" },
        { id: "count", label: "Número", type: "number" },
        { id: "enabled", label: "Activo", type: "boolean" },
      ],
      rows: [],
    };
    const context = {
      target: {
        site: "relayloom:site:" + owner.public.id + "/profile",
        snapshotId: "a".repeat(64),
        revisionId: "b".repeat(64),
        pageId: "home",
        formId: "visitor-form",
      },
      form,
      table,
      siteScope: "public",
      snapshotExpires: now + 60000,
    };
    const request = {
      target: context.target,
      schemaHash: protocol.schemaHash(form, table),
      operationId: crypto.randomUUID(),
      created: now,
      expires: now + 30000,
      values: { name: "Partilhar 🧶", count: 0, enabled: false },
      publicationScope: "public",
    };
    const certificate = protocol.create(visitor, request);
    const clockBoundaryAccepted =
      protocol.verifyForForm(certificate, context, now - 300000).id ===
      certificate.id;
    let clockBeyondRejected = false;
    try {
      protocol.verifyForForm(certificate, context, now - 300001);
    } catch {
      clockBeyondRejected = true;
    }
    const bundle = await r.createBundle(
      visitor,
      "site-contribution",
      certificate,
      [owner.public],
    );
    const decrypted = protocol.verifyForForm(
      await r.decryptBundle(bundle, owner),
      context,
      now,
    );
    let unauthorized = false,
      forged = false,
      wrongKey = false,
      privateNotPromoted = false;
    try {
      await r.decryptBundle(bundle, stranger);
    } catch {
      unauthorized = true;
    }
    const bad = structuredClone(certificate);
    bad.body.values.name = "Adulterado";
    try {
      protocol.verify(bad);
    } catch {
      forged = true;
    }
    try {
      protocol.create({ ...visitor, signSecret: owner.signSecret }, request);
    } catch {
      wrongKey = true;
    }
    const privateCertificate = protocol.create(visitor, {
      ...request,
      publicationScope: [owner.public.id, visitor.public.id].sort(),
    });
    try {
      protocol.verifyForForm(privateCertificate, context, now);
    } catch {
      privateNotPromoted = true;
    }
    const privateSubmission =
      protocol.verifyForSubmission(privateCertificate, context, now).id ===
      privateCertificate.id;
    const privatePublication =
      protocol.verifyPublicationScope(
        privateCertificate,
        [owner.public.id, visitor.public.id].sort(),
      ).id === privateCertificate.id;
    let broaderPublicationRejected = false;
    try {
      protocol.verifyPublicationScope(privateCertificate, "public");
    } catch {
      broaderPublicationRejected = true;
    }
    return {
      privateSubmission,
      privatePublication,
      broaderPublicationRejected,
      context,
      request,
      now,
      certificate,
      decrypted,
      unauthorized,
      forged,
      wrongKey,
      privateNotPromoted,
      clockBoundaryAccepted,
      clockBeyondRejected,
      privateEnvelope: bundle.manifest.publicKey === null,
      readerCount: bundle.manifest.keys.length,
    };
  });
  expect(result.unauthorized).toBe(true);
  expect(result.forged).toBe(true);
  expect(result.wrongKey).toBe(true);
  expect(result.privateNotPromoted).toBe(true);
  expect(result.privateSubmission).toBe(true);
  expect(result.privatePublication).toBe(true);
  expect(result.broaderPublicationRejected).toBe(true);
  expect(result.privateEnvelope).toBe(true);
  expect(result.clockBoundaryAccepted).toBe(true);
  expect(result.clockBeyondRejected).toBe(true);
  expect(result.readerCount).toBe(2);
  const protocol = createSiteContributionProtocol(nodeCertificateCrypto);
  expect(
    protocol.verifyForForm(result.certificate, result.context, result.now),
  ).toEqual(result.decrypted);
  const directory = projectTemp("contribution-browser-"),
    path = join(directory, "public-vectors.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        vectors: [
          {
            name: "actual browser signature",
            kind: "proposal",
            candidate: result.certificate,
            valid: true,
          },
          {
            name: "actual browser admission",
            kind: "admission",
            candidate: result.certificate,
            context: result.context,
            valid: true,
          },
        ],
        form: result.context.form,
        table: result.context.table,
        request: result.request,
        now: result.now,
      }),
      { mode: 0o600 },
    );
    const run = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestContributionInteroperability$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_CONTRIBUTION_INPUT: path },
      },
    );
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const go = JSON.parse(readFileSync(path + ".out.json", "utf8"));
    const returned = await page.evaluate(
      ({ certificate, context, now }) =>
        (window as any).contributionFixture.protocol.verifyForForm(
          certificate,
          context,
          now,
        ),
      { certificate: go.certificate, context: result.context, now: result.now },
    );
    expect(returned).toEqual(protocol.verify(go.certificate));
    await info.attach("contract-scope", {
      body: JSON.stringify(
        {
          status: "PASS",
          browser: info.project.name,
          nodeAndGoSignaturesVerified: true,
          encryptedProposal: true,
          ownerApprovalImplemented: false,
          scope:
            "Actual browser crypto and public certificate Go fixture; not application runtime, contributor inbox, persistence/replay or user interface.",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
