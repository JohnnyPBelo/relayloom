import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  validateSite,
  siteResourceBlocks,
  type SiteDocument,
} from "../packages/content/src/site";
import { describeSiteResource } from "../packages/content/src/site-resource";
import {
  templateSite,
  duplicatePage,
  newBlock,
} from "../apps/web/src/site/model";
import { authoredTable } from "./fixtures/site-table";
import { projectTemp } from "./project-temp";

const reference = describeSiteResource(
  {
    type: "site-resource",
    domain: "relayloom/site-resource/1",
    kind: "file",
    name: "Guia.txt",
    mime: "text/plain",
    data: "Zg==",
  },
  { id: "a".repeat(64), authorId: "b".repeat(64), kind: "site-resource" },
);
function document(): SiteDocument {
  const site = templateSite("journal", "Autora").site;
  site.version = 3;
  site.pages[0].blocks = [
    {
      id: "file",
      type: "resource",
      title: "Guia",
      body: "Só obter quando escolheres.",
      reference: structuredClone(reference),
    },
  ];
  return site;
}
function countResources(count: number) {
  const s = document();
  s.pages[0].blocks = [0, 1].map((group) => ({
    id: "group-" + group,
    type: "columns",
    title: "",
    body: "",
    children: Array.from(
      { length: Math.min(24, Math.max(0, count - group * 24)) },
      (_, i) => ({
        id: "resource-" + (group * 24 + i),
        type: "resource",
        title: "Recurso",
        body: "",
        reference: {
          ...reference,
          bundleId: (group * 24 + i).toString(16).padStart(64, "0"),
        },
      }),
    ),
  }));
  return s;
}
test("v3 accepts bounded optional references and duplicates a page without transferring resource authorship", () => {
  const site = document();
  site.pages[0].blocks.push({
    id: "inline",
    type: "table",
    title: "Tabela embutida",
    body: "",
    data: authoredTable(),
  });
  validateSite(site);
  const copy = duplicatePage(
    { site, theme: "sand", attachments: [] },
    site.home,
  );
  validateSite(copy.value.site);
  const blocks = siteResourceBlocks(copy.value.site);
  assert.equal(blocks.length, 2);
  assert.notEqual(blocks[0].blockId, blocks[1].blockId);
  assert.deepEqual(blocks[0].reference, blocks[1].reference);
  assert.equal(blocks[1].reference.authorId, reference.authorId);
  validateSite(countResources(32));
  assert.throws(() => validateSite(countResources(33)));
});
test("Node and Go agree on v3 reference vectors, legacy compatibility and exact resource limits", () => {
  const cases: { name: string; site: any; valid: boolean }[] = [];
  const add = (
    name: string,
    valid: boolean,
    edit: (s: any) => void = () => {},
  ) => {
    const site = document();
    edit(site);
    cases.push({ name, site, valid });
  };
  add("v3 file", true);
  add("v4 file", true, (s) => {
    s.version = 4;
  });
  add("v3 optional table", true, (s) => {
    s.pages[0].blocks[0].reference = describeSiteResource(
      {
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "table",
        name: "Lugares",
        table: authoredTable(),
      },
      { id: "c".repeat(64), authorId: "d".repeat(64), kind: "site-resource" },
    );
  });
  add("v3 inline table", true, (s) => {
    s.pages[0].blocks.push({
      id: "table",
      type: "table",
      title: "",
      body: "",
      data: authoredTable(),
    });
  });
  for (const version of [1, 2, 5])
    add("reference forbidden in version " + version, false, (s) => {
      s.version = version;
    });
  for (const version of [1, 2, 3, 4])
    add("empty document version " + version, true, (s) => {
      s.version = version;
      s.pages[0].blocks = [];
    });
  for (const [field, value] of [
    ["domain", "wrong"],
    ["bundleId", "bad"],
    ["authorId", "bad"],
    ["payloadHash", "bad"],
    ["mime", "text/html"],
    ["bytes", -1],
    ["bytes", 2 * 1024 * 1024 + 1],
    ["kind", "script"],
    ["name", "../x"],
    ["script", "run()"],
  ])
    add("invalid reference " + field + String(value), false, (s) => {
      s.pages[0].blocks[0].reference[field] = value;
    });
  add("missing reference", false, (s) => {
    delete s.pages[0].blocks[0].reference;
  });
  add("reference on ordinary text", false, (s) => {
    s.pages[0].blocks[0].type = "text";
  });
  add("external URL on reference", false, (s) => {
    s.pages[0].blocks[0].url = "https://example.org";
  });
  add("resource with embedded table", false, (s) => {
    s.pages[0].blocks[0].data = authoredTable();
  });
  add("same resource on two blocks", true, (s) => {
    s.pages[0].blocks.push({
      ...structuredClone(s.pages[0].blocks[0]),
      id: "copy",
    });
  });
  add("same resource with conflicting metadata", false, (s) => {
    s.pages[0].blocks.push({
      ...s.pages[0].blocks[0],
      id: "copy",
      reference: { ...reference, name: "Another.txt" },
    });
  });
  add("unicode name", true, (s) => {
    s.pages[0].blocks[0].reference.name = "Guia 🧶 \ud800.txt";
  });
  cases.push(
    { name: "32 references", site: countResources(32), valid: true },
    { name: "33 references", site: countResources(33), valid: false },
  );
  const oversized = countResources(32);
  for (const group of oversized.pages[0].blocks)
    for (const child of group.children!) child.body = "x".repeat(4000);
  cases.push({ name: "global document budget", site: oversized, valid: false });
  for (const c of cases) {
    if (c.valid) assert.doesNotThrow(() => validateSite(c.site), c.name);
    else assert.throws(() => validateSite(c.site), c.name);
  }
  const directory = projectTemp("resource-document-vectors-"),
    path = join(directory, "input.json");
  try {
    writeFileSync(path, JSON.stringify(cases));
    const result = spawnSync(
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
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const go = JSON.parse(readFileSync(path + ".result", "utf8"));
    assert.deepEqual(
      go,
      cases.map((c) => ({
        accepted: c.valid,
        resources: c.valid ? siteResourceBlocks(c.site) : null,
      })),
    );
    writeFileSync(
      ".cache/site-resource-document-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: cases.length,
          accepted: cases.filter((c) => c.valid).length,
          rejected: cases.filter((c) => !c.valid).length,
          scope:
            "Document/reference syntax and extraction only; runtime authorization and editor UI need separate gates.",
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("reference descriptors reject getters without executing them", () => {
  const site = document();
  let called = false;
  Object.defineProperty(site.pages[0].blocks[0].reference, "bundleId", {
    enumerable: true,
    get() {
      called = true;
      return reference.bundleId;
    },
  });
  assert.throws(() => validateSite(site));
  assert.equal(called, false);
});

test("resource insertion preserves the original filename while bounding a Unicode heading", () => {
  const site = document(),
    name = "🧶".repeat(73) + ".txt";
  site.pages[0].blocks = [newBlock("resource", { ...reference, name })];
  validateSite(site);
  assert.equal(site.pages[0].blocks[0].title.length, 120);
  assert.equal(site.pages[0].blocks[0].reference?.name, name);
  assert.equal(Array.from(site.pages[0].blocks[0].title).length, 60);
});
