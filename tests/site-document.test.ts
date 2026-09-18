import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateContentShape } from "../packages/content/src/validation";
import { validateSite, siteFallback } from "../packages/content/src/site";
import { templateSite, validateStudio } from "../apps/web/src/site/model";
import { largeTable } from "./fixtures/site-table";
import { parseSiteTable } from "../packages/content/src/site-data";
import { canonical } from "../packages/core/src/protocol";
const cases = JSON.parse(
  readFileSync(
    new URL("./fixtures/site-documents.json", import.meta.url),
    "utf8",
  ),
);
for (const c of cases)
  test("site schema: " + c.name, () => {
    const validate = () =>
      validateContentShape({
        type: "site",
        theme: "sand",
        blocks: [],
        site: c.site,
        attachments: c.attachments,
      });
    if (c.valid) {
      assert.doesNotThrow(validate);
      assert.doesNotThrow(() =>
        validateContentShape({
          type: "site",
          theme: "sand",
          blocks: siteFallback(c.site),
        }),
      );
    } else assert.throws(validate);
  });
test("templates satisfy the same wire contract and produce unique block identities", () => {
  for (const kind of ["journal", "portfolio", "community"] as const) {
    const a = templateSite(kind, "Autora");
    validateStudio(a);
    const b = templateSite(kind, "Autora");
    assert.notEqual(a.site.pages[0].blocks[0].id, b.site.pages[0].blocks[0].id);
  }
});
test("site input rejects getters without invoking them", () => {
  let called = false;
  const s = structuredClone(cases[0].site);
  Object.defineProperty(s, "title", {
    enumerable: true,
    get() {
      called = true;
      return "unsafe";
    },
  });
  assert.throws(() => validateSite(s, cases[0].attachments));
  assert.equal(called, false);
});
test("site total image budget is enforced outside the editor", () => {
  const c = cases[0];
  assert.throws(() =>
    validateContentShape({
      type: "site",
      theme: "sand",
      blocks: [],
      site: c.site,
      attachments: [
        { name: "large.png", mime: "image/png", data: "A".repeat(2800000) },
      ],
    }),
  );
});
test("image limit counts decoded bytes, including padding at the exact boundary", () => {
  const site = structuredClone(cases[0].site);
  site.pages[0].blocks = [];
  const asset = (bytes: number) => [
    { mime: "image/png", data: Buffer.alloc(bytes).toString("base64") },
  ];
  assert.doesNotThrow(() => validateSite(site, asset(2 * 1024 * 1024)));
  assert.throws(() => validateSite(site, asset(2 * 1024 * 1024 + 1)));
});
test("individually valid tables also consume the global 128 KiB document budget", () => {
  const site = templateSite("journal", "Autora").site;
  site.version = 2;
  const data = largeTable();
  parseSiteTable(data);
  site.pages[0].blocks = [0, 1].map((i) => ({
    id: "table-" + i,
    type: "table",
    title: "Dados",
    body: "",
    data,
  }));
  assert.ok(Buffer.byteLength(canonical(site)) < 128 * 1024);
  validateSite(site);
  site.pages[0].blocks.push({
    id: "table-2",
    type: "table",
    title: "Dados",
    body: "",
    data,
  });
  assert.ok(Buffer.byteLength(canonical(site)) > 128 * 1024);
  assert.throws(() => validateSite(site), /128 KiB/);
});
