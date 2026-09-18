import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical } from "../packages/core/src/protocol";
import {
  parseSiteTable,
  querySiteTable,
  SITE_DATA_LIMITS,
} from "../packages/content/src/site-data";
const table = {
  domain: "relayloom/site-table/1",
  columns: [
    { id: "name", label: "Lugar", type: "text" },
    { id: "water", label: "Água (litros)", type: "number" },
    { id: "open", label: "Aberto", type: "boolean" },
    { id: "date", label: "Actualização", type: "date" },
    { id: "link", label: "Mais", type: "link" },
  ],
  rows: [
    {
      id: "school",
      values: {
        name: "Escola",
        water: 200,
        open: true,
        date: "2024-02-29",
        link: "https://example.org/escola",
      },
    },
    {
      id: "library",
      values: {
        name: "Biblioteca",
        water: 20,
        open: false,
        date: "2026-09-17",
        link: null,
      },
    },
    {
      id: "park",
      values: {
        name: "Parque",
        water: null,
        open: true,
        date: null,
        link: null,
      },
    },
  ],
};
const query = { search: "", page: 0, pageSize: 10 };
test("signed table projection sorts numeric values, keeps null last, and leaves source bytes unchanged", () => {
  const bytes = canonical(table),
    ascending = querySiteTable(table, {
      ...query,
      order: { column: "water", direction: "asc" },
    }),
    descending = querySiteTable(table, {
      ...query,
      order: { column: "water", direction: "desc" },
    });
  assert.deepEqual(
    ascending.rows.map((r) => r.id),
    ["library", "school", "park"],
  );
  assert.deepEqual(
    descending.rows.map((r) => r.id),
    ["school", "library", "park"],
  );
  ascending.rows[0].values.name = "Reader view edit";
  assert.equal(canonical(table), bytes);
  assert.equal(parseSiteTable(table).rows[1].values.name, "Biblioteca");
});
test("literal search never evaluates code or patterns and pagination stays finite on empty and boundary queries", () => {
  assert.equal(
    querySiteTable(table, { ...query, search: "BIBLIO" }).rows[0].id,
    "library",
  );
  assert.equal(querySiteTable(table, { ...query, search: ".*" }).matched, 0);
  const empty = querySiteTable(table, {
    ...query,
    search: "<script>",
    page: 256,
  });
  assert.deepEqual(
    { matched: empty.matched, page: empty.page, pages: empty.pages },
    { matched: 0, page: 0, pages: 1 },
  );
  const many = {
    ...table,
    rows: Array.from({ length: 51 }, (_, i) => ({
      id: "row-" + i,
      values: { ...table.rows[0].values, water: i },
    })),
  };
  const last = querySiteTable(many, { ...query, page: 99, pageSize: 25 });
  assert.equal(last.page, 2);
  assert.equal(last.rows.length, 1);
  assert.equal(last.rows[0].values.water, 50);
  assert.equal(last.total, 51);
});
test("table shape, dates, links, column types and finite limits reject negative controls", () => {
  const withCell = (column: string, value: unknown) => {
    const next = structuredClone(table) as any;
    next.rows[0].values[column] = value;
    return next;
  };
  for (const input of [
    withCell("water", Infinity),
    withCell("water", "200"),
    withCell("water", Number.MAX_SAFE_INTEGER + 1),
    withCell("open", "true"),
    withCell("date", "2023-02-29"),
    withCell("date", "2026-04-31"),
    withCell("link", "javascript:alert(1)"),
    withCell("link", "https://user:secret@example.org"),
    withCell("link", "https://example.org/\\bad"),
    withCell("name", "x".repeat(1001)),
    { ...table, script: "alert(1)" },
    { ...table, rows: [table.rows[0], table.rows[0]] },
    {
      ...table,
      rows: Array.from({ length: 257 }, (_, i) => ({
        id: "r-" + i,
        values: table.rows[0].values,
      })),
    },
    { ...table, columns: [...table.columns, table.columns[0]] },
  ])
    assert.throws(() => parseSiteTable(input));
  for (const bad of [
    { ...query, search: "x".repeat(161) },
    { ...query, page: -1 },
    { ...query, pageSize: 100 },
    { ...query, order: { column: "absent", direction: "asc" } },
    { ...query, order: { column: "name", direction: "script" } },
    { ...query, expression: "this.constructor" },
  ])
    assert.throws(() => querySiteTable(table, bad));
  assert.doesNotThrow(() => parseSiteTable(table));
});
test("nested getters and noncanonical arrays are rejected before executing accessors", () => {
  let reads = 0;
  const getter = () => {
    reads++;
    return "malicious";
  };
  for (const path of ["table", "column", "row", "value", "array"]) {
    const source = structuredClone(table) as any;
    if (path === "table")
      Object.defineProperty(source, "domain", { get: getter });
    if (path === "column")
      Object.defineProperty(source.columns[0], "id", { get: getter });
    if (path === "row")
      Object.defineProperty(source.rows[0], "id", { get: getter });
    if (path === "value")
      Object.defineProperty(source.rows[0].values, "name", { get: getter });
    if (path === "array")
      Object.defineProperty(source.rows, "0", { get: getter });
    assert.throws(() => parseSiteTable(source));
  }
  assert.equal(reads, 0);
  const sparse = { ...table, rows: new Array(2) };
  assert.throws(() => parseSiteTable(sparse));
  const extra = structuredClone(table) as any;
  extra.rows.hidden = true;
  assert.throws(() => parseSiteTable(extra));
});
test("table byte quota counts UTF-8 bytes and canonical field names, with both sides of the boundary", () => {
  const source = {
    domain: "relayloom/site-table/1",
    columns: [{ id: "value", label: "Valor", type: "text" }],
    rows: Array.from({ length: 64 }, (_, i) => ({
      id: "row-" + i,
      values: { value: "😀".repeat(200) },
    })),
  };
  assert.ok(
    new TextEncoder().encode(canonical(source)).length < SITE_DATA_LIMITS.bytes,
  );
  parseSiteTable(source);
  source.rows.forEach((r) => (r.values.value = "😀".repeat(250)));
  assert.ok(
    new TextEncoder().encode(canonical(source)).length > SITE_DATA_LIMITS.bytes,
  );
  assert.throws(() => parseSiteTable(source));
});

import {
  tableCSV,
  tableJSON,
  tableFromCSV,
  editSiteCell,
  convertSiteCell,
} from "../packages/content/src/site-data-editor";
test("CSV handles quoted commas, quotes and newlines as literal text without guessing numeric identities", () => {
  const csv =
    'Lugar,Identificador,Notas\r\n"Centro, norte",001,"linha 1\nlinha ""2"""\r\n';
  const parsed = tableFromCSV(csv);
  assert.deepEqual(parsed.rows[0].values, {
    "column-1": "Centro, norte",
    "column-2": "001",
    "column-3": 'linha 1\nlinha "2"',
  });
  assert.equal(tableCSV(parsed), csv);
  assert.deepEqual(JSON.parse(tableJSON(parsed)), parsed);
  for (const value of [
    '"por fechar',
    "a,b\n1",
    "a\r1",
    'a,b\n"x"z,y',
    'a,b\nx"y,z',
    ",b\n1,2",
    "a\n" + "x".repeat(1001),
  ])
    assert.throws(() => tableFromCSV(value));
});
test("CSV export neutralises spreadsheet formulas without changing signed table values", () => {
  const source = {
    domain: "relayloom/site-table/1",
    columns: [
      { id: "text", label: "=HEADER", type: "text" },
      { id: "number", label: "Número", type: "number" },
    ],
    rows: [
      {
        id: "a",
        values: { text: '=HYPERLINK("https://example.org")', number: -12 },
      },
      { id: "b", values: { text: "  @IMPORT", number: 1e-15 } },
    ],
  };
  const before = canonical(source),
    csv = tableCSV(source);
  assert.ok(csv.startsWith("'=HEADER,Número"));
  assert.ok(csv.includes("'  @IMPORT"));
  assert.ok(csv.includes(",-12\r\n"));
  assert.ok(csv.includes("1e-15"));
  assert.equal(canonical(source), before);
});
test("typed editing preserves incomplete numbers for validation rather than erasing them", () => {
  assert.equal(editSiteCell("001", "text"), "001");
  assert.equal(editSiteCell("1e-", "number"), "1e-");
  assert.equal(editSiteCell("1e-15", "number"), 1e-15);
  assert.equal(editSiteCell("1e999", "number"), "1e999");
  assert.equal(editSiteCell("", "number"), null);
  assert.equal(editSiteCell("false", "boolean"), false);
  assert.equal(editSiteCell("unknown", "boolean"), "unknown");
  for (const type of ["text", "number", "boolean", "date", "link"] as const)
    assert.equal(convertSiteCell(null, type), null, type);
  for (const type of ["number", "boolean", "date", "link"] as const)
    assert.equal(editSiteCell("", type), null, type);
  assert.equal(convertSiteCell("", "text"), "");
  assert.equal(convertSiteCell("001", "text"), "001");
  assert.equal(convertSiteCell("1,25", "number"), 1.25);
  assert.equal(convertSiteCell("1e-", "number"), "1e-");
});
