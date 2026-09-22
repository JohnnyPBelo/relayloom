import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createIdentity, canonical } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import {
  createSiteContributionProtocol,
  type ContributionFormContext,
} from "../packages/sites/src/contribution-protocol";
import { siteAddress } from "../packages/sites/src/protocol";
import {
  parseSiteForm,
  matchContributionValues,
  type SiteForm,
} from "../packages/content/src/site-form";
import type { SiteTable } from "../packages/content/src/site-data";
import { projectTemp } from "./project-temp";

test("Node, portable crypto and Go agree on visitor proposals, schemas and negative authorization vectors", () => {
  const protocol = createSiteContributionProtocol(nodeCertificateCrypto),
    portable = createSiteContributionProtocol(browserCertificateCrypto);
  const owner = createIdentity("Owner"),
    visitor = createIdentity("Visitante 🌿");
  const now = Date.now();
  const form: SiteForm = {
    domain: "relayloom/site-form/1",
    table: { pageId: "directory-page", blockId: "table" },
    fields: [
      { column: "name", required: true },
      { column: "number", required: true },
      { column: "enabled", required: true },
      { column: "date", required: false },
      { column: "url", required: false },
    ],
    contributors: "readers",
  };
  const table: SiteTable = {
    domain: "relayloom/site-table/1",
    columns: [
      { id: "name", label: "Nome", type: "text" },
      { id: "number", label: "Número", type: "number" },
      { id: "enabled", label: "Activo", type: "boolean" },
      { id: "date", label: "Dia", type: "date" },
      { id: "url", label: "Endereço", type: "link" },
    ],
    rows: [],
  };
  const values = {
    name: "Contribuição 🧶",
    number: 0,
    enabled: false,
    date: "2024-02-29",
    url: "https://example.org/a",
  };
  const context: ContributionFormContext = {
    target: {
      site: siteAddress(owner.public.id, "profile"),
      snapshotId: "a".repeat(64),
      revisionId: "b".repeat(64),
      pageId: "home",
      formId: "form",
    },
    form,
    table,
    siteScope: "public",
    snapshotExpires: now + 60000,
  };
  const request = {
    target: context.target,
    schemaHash: protocol.schemaHash(form, table),
    operationId: randomUUID(),
    created: now - 1000,
    expires: now + 30000,
    values,
    publicationScope: "public" as const,
  };
  const certificate = protocol.create(visitor, request);
  type Vector = {
    name: string;
    kind:
      | "form"
      | "values"
      | "proposal"
      | "admission"
      | "submission"
      | "publication";
    candidate: any;
    valid: boolean;
    context?: ContributionFormContext;
    audience?: unknown;
  };
  const vectors: Vector[] = [];
  const add = (
    name: string,
    kind: Vector["kind"],
    valid: boolean,
    source: unknown,
    edit: (value: any) => void = () => {},
  ) => {
    const candidate = structuredClone(source);
    edit(candidate);
    vectors.push({
      name,
      kind,
      candidate,
      valid,
      ...(["admission", "submission"].includes(kind)
        ? { context: structuredClone(context) }
        : {}),
    });
  };
  add("form accepts readers", "form", true, form);
  add(
    "form accepts selected contributors",
    "form",
    true,
    form,
    (f) => (f.contributors = [owner.public.id, visitor.public.id].sort()),
  );
  for (const [name, edit] of [
    ["no fields", (f: any) => (f.fields = [])],
    ["duplicate field", (f: any) => f.fields.push(f.fields[0])],
    ["unknown script", (f: any) => (f.script = "run()")],
    ["wrong domain", (f: any) => (f.domain = "other")],
    [
      "unbounded fields",
      (f: any) =>
        (f.fields = Array.from({ length: 13 }, (_, i) => ({
          column: "col-" + i,
          required: false,
        }))),
    ],
    [
      "rule duplicate",
      (f: any) => (f.contributors = [owner.public.id, owner.public.id]),
    ],
    [
      "rule reversed",
      (f: any) =>
        (f.contributors = [owner.public.id, visitor.public.id]
          .sort()
          .reverse()),
    ],
    ["rule malformed", (f: any) => (f.contributors = ["bad"])],
    ["rule empty", (f: any) => (f.contributors = [])],
    ["wrong required", (f: any) => (f.fields[0].required = "true")],
    ["target path", (f: any) => (f.table.pageId = "../x")],
    ["remote target", (f: any) => (f.table.url = "https://example.org")],
  ] as const)
    add(name, "form", false, form, edit);
  add("typed values", "values", true, values);
  add("optional nulls", "values", true, values, (v) => {
    v.date = null;
    v.url = null;
  });
  add(
    "literal markup",
    "values",
    true,
    values,
    (v) => (v.name = "<script>literal only</script>"),
  );
  for (const [name, edit] of [
    ["blank required", (v: any) => (v.name = " \n")],
    ["null required", (v: any) => (v.number = null)],
    ["string number", (v: any) => (v.number = "0")],
    ["unsafe number", (v: any) => (v.number = 9007199254740992)],
    ["bad boolean", (v: any) => (v.enabled = 0)],
    ["bad leap day", (v: any) => (v.date = "2025-02-29")],
    ["javascript link", (v: any) => (v.url = "javascript:run()")],
    ["unknown column", (v: any) => (v.secret = "x")],
    ["missing column", (v: any) => delete v.date],
    ["oversized text", (v: any) => (v.name = "x".repeat(1001))],
  ] as const)
    add(name, "values", false, values, edit);
  add("Node visitor signature", "proposal", true, certificate);
  add(
    "portable visitor signature",
    "proposal",
    true,
    portable.create(visitor, request),
  );
  for (const [name, edit] of [
    ["forged data", (p: any) => (p.body.values.name = "tampered")],
    ["forged author", (p: any) => (p.body.contributor = owner.public)],
    [
      "forged permission",
      (p: any) =>
        (p.body.publicationScope = [owner.public.id, visitor.public.id].sort()),
    ],
    ["wrong domain", (p: any) => (p.body.domain = "relayloom/site-snapshot/1")],
    ["certificate extra", (p: any) => (p.approved = true)],
    ["signature malformed", (p: any) => (p.signature = "bad")],
  ] as const)
    add(name, "proposal", false, certificate, edit);
  add("admitted with public consent", "admission", true, certificate);
  add(
    "private consent cannot be promoted",
    "admission",
    false,
    protocol.create(visitor, {
      ...request,
      publicationScope: [owner.public.id, visitor.public.id].sort(),
    }),
  );
  add(
    "expired authenticity retained",
    "proposal",
    true,
    protocol.create(visitor, { ...request, created: now - 2000, expires: now }),
  );
  add(
    "expired admission refused",
    "admission",
    false,
    protocol.create(visitor, { ...request, created: now - 2000, expires: now }),
  );
  for (const skew of [1000, 300000, 300001]) {
    add(
      `clock skew ${skew}ms`,
      "admission",
      skew <= 300000,
      protocol.create(visitor, {
        ...request,
        created: now + skew,
        expires: now + skew + 30000,
      }),
    );
    // Keep expiry out of this control so only the creation-time boundary differs.
    vectors.at(-1)!.context!.snapshotExpires = now + 600000;
  }
  for (const [name, edit] of [
    ["different snapshot", (c: any) => (c.target.snapshotId = "c".repeat(64))],
    ["different revision", (c: any) => (c.target.revisionId = "c".repeat(64))],
    ["different field", (c: any) => (c.form.fields[0].required = false)],
    ["shorter snapshot lifetime", (c: any) => (c.snapshotExpires = now + 1)],
    ["non-reader", (c: any) => (c.siteScope = [owner.public.id])],
    ["different field type", (c: any) => (c.table.columns[0].type = "number")],
  ] as const) {
    add(name, "admission", false, certificate);
    edit(vectors.at(-1)!.context!);
  }
  const privateConsent = protocol.create(visitor, {
    ...request,
    publicationScope: [owner.public.id, visitor.public.id].sort(),
  });
  add(
    "private grant can be submitted to a public site owner",
    "submission",
    true,
    privateConsent,
  );
  add(
    "submission still rejects expiration",
    "submission",
    false,
    protocol.create(visitor, { ...request, created: now - 2000, expires: now }),
  );
  add(
    "submission still requires original contributors",
    "submission",
    false,
    privateConsent,
  );
  vectors.at(-1)!.context!.form.contributors = [owner.public.id];
  add(
    "submission cannot accept another snapshot",
    "submission",
    false,
    privateConsent,
  );
  vectors.at(-1)!.context!.target.snapshotId = "e".repeat(64);
  for (const [name, audience, valid] of [
    [
      "private publication permitted by grant",
      [owner.public.id, visitor.public.id].sort(),
      true,
    ],
    ["owner-only narrower publication permitted", [owner.public.id], true],
    ["private grant cannot be published publicly", "public", false],
    [
      "private grant cannot add readers",
      [owner.public.id, visitor.public.id, "e".repeat(64)].sort(),
      false,
    ],
    ["publication cannot omit owner", [visitor.public.id], false],
  ] as const) {
    add(name, "publication", valid, privateConsent);
    vectors.at(-1)!.audience = audience;
  }
  for (const v of vectors) {
    const run = () =>
      v.kind === "form"
        ? parseSiteForm(v.candidate)
        : v.kind === "values"
          ? matchContributionValues(form, table, v.candidate)
          : v.kind === "proposal"
            ? portable.verify(v.candidate)
            : v.kind === "submission"
              ? portable.verifyForSubmission(v.candidate, v.context!, now)
              : v.kind === "publication"
                ? portable.verifyPublicationScope(v.candidate, v.audience)
                : portable.verifyForForm(v.candidate, v.context!, now);
    if (v.valid) assert.doesNotThrow(run, v.name);
    else assert.throws(run, v.name);
  }
  const folder = projectTemp("site-contribution-vectors-"),
    input = join(folder, "input.json");
  try {
    writeFileSync(
      input,
      JSON.stringify({ vectors, form, table, request, now }),
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
        "^TestContribution(Interoperability|ValueRuntimeTypes)$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_CONTRIBUTION_INPUT: input },
      },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = JSON.parse(readFileSync(input + ".out.json", "utf8"));
    assert.deepEqual(
      result.vectors,
      vectors.map((v) => ({ name: v.name, accepted: v.valid })),
    );
    assert.equal(result.schemaHash, request.schemaHash);
    assert.notEqual(result.certificate.body.contributor.id, visitor.public.id);
    assert.deepEqual(
      protocol.verifyForForm(result.certificate, context, now),
      portable.verifyForForm(result.certificate, context, now),
    );
    assert.equal(result.goTamperRejected, true);
    assert.equal(result.goForeignSigningKeyRejected, true);
    assert.equal(result.goUnsafeRuntimeTimestampRejected, true);
    writeFileSync(
      ".cache/site-contribution-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: vectors.length,
          accepted: vectors.filter((v) => v.valid).length,
          rejected: vectors.filter((v) => !v.valid).length,
          nodePortableGoAgree: true,
          goSignatureVerifiedByBothAdapters: true,
          scope:
            "Proposal/schema contract and actual crypto only. Not runtime admission, replay persistence, owner approval, transport or UI integration.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
