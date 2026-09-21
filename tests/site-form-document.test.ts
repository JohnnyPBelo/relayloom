import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  validateSite,
  siteFormBlocks,
  siteResourceBlocks,
  type SiteDocument,
  type SiteNode,
} from "../packages/content/src/site";
import {
  templateSite,
  duplicatePage,
  cloneNode,
} from "../apps/web/src/site/model";
import { authoredTable } from "./fixtures/site-table";
import { projectTemp } from "./project-temp";
import { createIdentity, createBundle } from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { inspectSite } from "../apps/node/src/site-runtime";
import { verifySiteContent } from "../packages/browser/src/site-content";

function document(): SiteDocument {
  const site = templateSite("journal", "Autora").site;
  site.version = 4;
  site.pages = [
    { id: "home", slug: "inicio", title: "Comunidade", blocks: [] },
  ];
  site.home = "home";
  const data = authoredTable();
  site.pages[0].blocks = [
    {
      id: "composition",
      type: "columns",
      title: "",
      body: "",
      children: [
        {
          id: "form",
          type: "form",
          title: "Contribui",
          body: "Partilha dados para revisão.",
          form: {
            domain: "relayloom/site-form/1",
            table: { pageId: "home", blockId: "table" },
            fields: data.columns.map((c) => ({
              column: c.id,
              required: false,
            })),
            contributors: "readers",
          },
        },
        { id: "table", type: "table", title: "Lugares", body: "", data },
      ],
    },
  ];
  return site;
}
const form = (site: SiteDocument) => site.pages[0].blocks[0].children![0];
const table = (site: SiteDocument) => site.pages[0].blocks[0].children![1];

test("v4 binds nested and cross-page forms to typed local tables; Node and Go agree on positive/negative document vectors", () => {
  const cases: { name: string; site: any; valid: boolean }[] = [];
  const add = (
    name: string,
    valid: boolean,
    change: (s: any) => void = () => {},
  ) => {
    const site = document();
    change(site);
    cases.push({ name, valid, site });
  };
  add("nested forward table reference", true);
  add("cross-page local table", true, (s) => {
    const node = table(s);
    s.pages[0].blocks[0].children.pop();
    s.pages.push({
      id: "directory",
      slug: "lugares",
      title: "Lugares",
      blocks: [node],
    });
    form(s).form!.table.pageId = "directory";
  });
  for (const version of [1, 2, 3, 5])
    add("form version " + version, false, (s) => (s.version = version));
  for (const version of [1, 2, 3, 4])
    add("legacy content in " + version, true, (s) => {
      s.version = version;
      s.pages[0].blocks = [];
    });
  add("missing schema", false, (s) => delete form(s).form);
  add("schema on ordinary text", false, (s) => (form(s).type = "text"));
  add("missing table", false, (s) => (form(s).form!.table.blockId = "absent"));
  add(
    "wrong page even though global table id exists",
    false,
    (s) => (form(s).form!.table.pageId = "other"),
  );
  add(
    "form cannot target itself",
    false,
    (s) => (form(s).form!.table.blockId = "form"),
  );
  add(
    "columns composition is not a table",
    false,
    (s) => (form(s).form!.table.blockId = "composition"),
  );
  add("mismatched fields", false, (s) => form(s).form!.fields.pop());
  add("column order part of schema", false, (s) =>
    form(s).form!.fields.reverse(),
  );
  add(
    "external submit url forbidden",
    false,
    (s) => (form(s).url = "https://example.org/send"),
  );
  add(
    "remote table reference forbidden",
    false,
    (s) => ((form(s).form!.table as any).url = "https://example.org/data"),
  );
  add(
    "script forbidden",
    false,
    (s) => ((form(s).form as any).script = "run()"),
  );
  add(
    "explicit contributors",
    true,
    (s) => (form(s).form!.contributors = ["a".repeat(64)]),
  );
  add(
    "public is not a contributor policy",
    false,
    (s) => ((form(s).form as any).contributors = "public"),
  );
  add("two forms same table", true, (s) =>
    s.pages[0].blocks[0].children!.push({
      ...structuredClone(form(s)),
      id: "second-form",
    }),
  );
  for (const c of cases) {
    if (c.valid) assert.doesNotThrow(() => validateSite(c.site), c.name);
    else assert.throws(() => validateSite(c.site), c.name);
  }
  const folder = projectTemp("form-document-vectors-"),
    path = join(folder, "input.json");
  try {
    writeFileSync(path, JSON.stringify(cases));
    const go = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestResourceDocumentVectors$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, RELAYLOOM_RESOURCE_DOCUMENT_INPUT: path },
      },
    );
    assert.equal(go.status, 0, go.stdout + go.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(path + ".result", "utf8")),
      cases.map((c) => ({
        accepted: c.valid,
        resources: c.valid ? siteResourceBlocks(c.site) : null,
      })),
    );
    writeFileSync(
      ".cache/site-form-document-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: cases.length,
          accepted: cases.filter((c) => c.valid).length,
          rejected: cases.filter((c) => !c.valid).length,
          scope:
            "Document v4 shape and local schema binding only, not contribution submission or approval.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("copying a page or a composition rebinds local tables while foreign-page references remain independent", () => {
  const site = document();
  const external: SiteNode = {
    ...structuredClone(table(site)),
    id: "external-table",
  };
  site.pages.push({
    id: "outside",
    slug: "outra",
    title: "Outra",
    blocks: [external],
  });
  site.pages[0].blocks.push({
    ...structuredClone(form(site)),
    id: "outside-form",
    form: {
      ...form(site).form!,
      table: { pageId: "outside", blockId: "external-table" },
    },
  });
  validateSite(site);
  const source = structuredClone(site);
  const copied = duplicatePage(
    { site, theme: "sand", attachments: [] },
    "home",
  );
  const local = siteFormBlocks(copied.value.site).find(
    (x) => x.pageId === copied.pageId && x.form.table.pageId === copied.pageId,
  )!;
  assert.ok(local);
  assert.notEqual(local.form.table.blockId, "table");
  assert.equal(
    siteFormBlocks(copied.value.site).filter(
      (x) => x.form.table.blockId === "external-table",
    ).length,
    2,
  );
  const cloned = cloneNode(site.pages[0].blocks[0]);
  site.pages[0].blocks.push(cloned);
  validateSite(site);
  const binding = siteFormBlocks(site).find(
    (x) => x.blockId === cloned.children![0].id,
  )!;
  assert.equal(binding.form.table.blockId, cloned.children![1].id);
  binding.table.rows[0].values.place = "caller changes its own copy";
  assert.deepEqual(copied.value.site.pages[0], source.pages[0]);
  assert.deepEqual(table(site).data, table(source).data);
});

test("v4 schemas remain covered by owner snapshots; unversioned or counterfeit envelopes cannot supply form authority", () => {
  const owner = createIdentity("Owner"),
    other = createIdentity("Other signer"),
    sites = createSiteContentProtocol(nodeCertificateCrypto);
  const payload = {
    type: "site" as const,
    blocks: [],
    theme: "sand" as const,
    site: document(),
  };
  const unsigned = createBundle(owner, "site", payload, "public");
  assert.throws(() => inspectSite(unsigned), /snapshot assinado/);
  assert.throws(
    () => verifySiteContent(payload, owner.public),
    /snapshot assinado/,
  );
  const signed = sites.create(owner, "profile", 1, [], payload);
  assert.ok(inspectSite(createBundle(owner, "site", signed, "public")));
  assert.ok(verifySiteContent({ ...signed }, owner.public));
  assert.throws(() =>
    inspectSite(createBundle(other, "site", signed, "public")),
  );
  const changed = structuredClone(signed);
  form(changed.site).form!.fields[0].required = true;
  assert.throws(() =>
    inspectSite(createBundle(owner, "site", changed, "public")),
  );
});
