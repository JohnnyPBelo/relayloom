import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  duplicatePage,
  flatten,
  initialSite,
  movePage,
  newBlock,
  templateSite,
  validateStudio,
} from "../apps/web/src/site/model";
import { getLanguage, setLanguage } from "../apps/web/src/i18n/core";

test("page duplication preserves the source, shared assets and external links while remapping nested self-links", () => {
  const value = templateSite("portfolio", "Autora original");
  const home = value.site.pages[0],
    about = value.site.pages[1];
  const columns = home.blocks.find((node) => node.type === "columns")!;
  columns.children!.push({ ...newBlock("button"), url: "page:" + home.id });
  value.attachments = [
    {
      name: "fixture.png",
      mime: "image/png",
      data: readFileSync(
        "apps/ios/Tests/Fixtures/synthetic-photo.png",
      ).toString("base64"),
    },
  ];
  home.blocks.find((node) => node.type === "gallery")!.media = [
    { attachment: 0, alt: "Legenda da autora" },
  ];
  validateStudio(value);
  const before = JSON.stringify(value);
  const result = duplicatePage(value, home.id),
    copy = result.value.site.pages[1];
  assert.equal(JSON.stringify(value), before);
  assert.equal(result.value.site.home, home.id);
  assert.equal(copy.id, result.pageId);
  assert.notEqual(copy.id, home.id);
  assert.deepEqual(result.value.attachments, value.attachments);
  const nodes = flatten(copy.blocks).map(({ node }) => node);
  const originalIds = new Set(flatten(home.blocks).map(({ node }) => node.id));
  assert.ok(nodes.every((node) => !originalIds.has(node.id)));
  assert.equal(
    new Set(
      result.value.site.pages.flatMap((page) =>
        flatten(page.blocks).map(({ node }) => node.id),
      ),
    ).size,
    result.value.site.pages.reduce(
      (sum, page) => sum + flatten(page.blocks).length,
      0,
    ),
  );
  assert.ok(nodes.some((node) => node.url === "page:" + copy.id));
  assert.ok(nodes.some((node) => node.url === "page:" + about.id));
  assert.ok(!nodes.some((node) => node.url === "page:" + home.id));
  nodes.find((node) => node.type === "gallery")!.media![0].alt =
    "Legenda independente";
  nodes[0].title = "Alteração apenas na cópia";
  assert.equal(JSON.stringify(value), before);
  validateStudio(result.value);
});

test("duplicate names/slugs remain bounded and unique with Unicode and the exact page cap", () => {
  let value = initialSite("Limites");
  const source = value.site.pages[0];
  source.slug = "a".repeat(40);
  source.title = "🌿".repeat(40);
  for (let index = 1; index < 12; index++) {
    const next = duplicatePage(value, source.id);
    value = next.value;
    const page = value.site.pages.find((page) => page.id === next.pageId)!;
    assert.ok(page.title.length <= 80);
    for (const character of page.title)
      assert.ok(
        character.length === 2 ||
          character.charCodeAt(0) < 0xd800 ||
          character.charCodeAt(0) > 0xdfff,
      );
    assert.ok(page.slug.length <= 40);
    assert.equal(
      new Set(value.site.pages.map((page) => page.slug)).size,
      value.site.pages.length,
    );
    validateStudio(value);
  }
  const before = JSON.stringify(value);
  assert.throws(() => duplicatePage(value, source.id), /12 páginas/);
  assert.equal(JSON.stringify(value), before);
});

test("page copying accepts exactly 128 nodes and refuses the next node without changing the draft", () => {
  const value = initialSite("Orçamento");
  value.site.pages = [24, 24, 24, 24, 24, 6, 1].map((count, index) => ({
    id: "page-" + index,
    slug: "page-" + index,
    title: "Página " + index,
    blocks: Array.from({ length: count }, () => newBlock("text")),
  }));
  value.site.home = value.site.pages[0].id;
  validateStudio(value);
  const exact = duplicatePage(value, "page-6").value;
  assert.equal(
    exact.site.pages.reduce(
      (sum, page) => sum + flatten(page.blocks).length,
      0,
    ),
    128,
  );
  validateStudio(exact);
  const before = JSON.stringify(exact);
  assert.throws(() => duplicatePage(exact, "page-6"), /128 blocos/);
  assert.equal(JSON.stringify(exact), before);
});

test("reordering preserves page identities, home and links and has no history-changing boundary step", () => {
  const value = templateSite("portfolio", "Ordem");
  const before = JSON.stringify(value),
    [home, about] = value.site.pages;
  const moved = movePage(value.site, home.id, 1);
  assert.deepEqual(
    moved.pages.map((page) => page.id),
    [about.id, home.id],
  );
  assert.equal(moved.home, home.id);
  assert.deepEqual(moved.pages[1], home);
  assert.equal(JSON.stringify(value), before);
  assert.equal(movePage(moved, home.id, 1), moved);
  assert.equal(movePage(moved, about.id, -1), moved);
  assert.deepEqual(movePage(moved, home.id, -1), value.site);
  assert.throws(() => movePage(moved, "missing", 1));
  assert.throws(() => movePage(moved, home.id, 0 as 1));
  validateStudio({ ...value, site: moved });
});

test("copying is explicit authored content creation in the selected language and never mutates an invalid source", () => {
  const previous = getLanguage();
  try {
    const value = initialSite("Nomes"),
      page = value.site.pages[0];
    page.title = "Guardar";
    for (const [language, title] of [
      ["pt-PT", "Guardar (cópia)"],
      ["en-GB", "Guardar (copy)"],
      ["es-ES", "Guardar (copia)"],
    ]) {
      setLanguage(language);
      const copy = duplicatePage(value, page.id).value.site.pages[1];
      assert.equal(copy.title, title);
      assert.equal(page.title, "Guardar");
    }
    page.slug = "invalid slug";
    const before = JSON.stringify(value);
    assert.throws(() => duplicatePage(value, page.id));
    assert.throws(() => duplicatePage(value, "missing"));
    assert.equal(JSON.stringify(value), before);
  } finally {
    setLanguage(previous);
  }
});
