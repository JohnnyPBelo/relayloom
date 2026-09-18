import { safeSiteUrl } from "./site-url";
import { canonical, exactShape } from "../../core/src/protocol";

/** Bounded authored data for declarative sites. These bytes belong inside the
 * owner's signed snapshot; querying never changes them or transfers authorship.
 * No expressions, SQL, URLs to fetch, callbacks or arbitrary code are evaluated. */
export const SITE_DATA_LIMITS = Object.freeze({
  columns: 12,
  rows: 256,
  cellText: 1000,
  bytes: 64 * 1024,
  queryText: 160,
});
export type SiteCell = string | number | boolean | null;
export type SiteColumnType = "text" | "number" | "boolean" | "date" | "link";
export interface SiteDataColumn {
  id: string;
  label: string;
  type: SiteColumnType;
}
export interface SiteDataRow {
  id: string;
  values: Record<string, SiteCell>;
}
export interface SiteTable {
  domain: "relayloom/site-table/1";
  columns: SiteDataColumn[];
  rows: SiteDataRow[];
}
export interface SiteTableQuery {
  search: string;
  order?: { column: string; direction: "asc" | "desc" };
  page: number;
  pageSize: 10 | 25 | 50;
}
const identifier = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(v);
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw Error("Dados do site inválidos: " + message);
}
function dense(value: unknown, limit: number): asserts value is unknown[] {
  requireThat(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= limit,
    "limite de lista",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from(
        { length: value.length },
        (_, i) => descriptors[String(i)],
      ).every((d) => d && "value" in d),
    "lista não canónica",
  );
}
export function validSiteCell(value: unknown, type: SiteColumnType) {
  if (value === null) return true;
  switch (type) {
    case "text":
      return (
        typeof value === "string" && value.length <= SITE_DATA_LIMITS.cellText
      );
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER
      );
    case "boolean":
      return typeof value === "boolean";
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
      const time = Date.parse(value + "T00:00:00.000Z");
      return (
        Number.isFinite(time) &&
        new Date(time).toISOString().slice(0, 10) === value
      );
    }
    case "link":
      return typeof value === "string" && safeSiteUrl(value);
  }
}
/** Return an owned value after shape/type/byte validation; never invoke getters. */
export function parseSiteTable(input: unknown): SiteTable {
  requireThat(
    exactShape(input, ["domain", "columns", "rows"]),
    "campos da tabela",
  );
  const value = input as SiteTable;
  requireThat(value.domain === "relayloom/site-table/1", "versão da tabela");
  dense(value.columns, SITE_DATA_LIMITS.columns);
  dense(value.rows, SITE_DATA_LIMITS.rows);
  requireThat(value.columns.length > 0, "colunas em falta");
  const columns = new Map<string, SiteColumnType>();
  for (const column of value.columns) {
    requireThat(
      exactShape(column, ["id", "label", "type"]),
      "campos da coluna",
    );
    requireThat(
      identifier(column.id) &&
        !columns.has(column.id) &&
        typeof column.label === "string" &&
        column.label.length <= 80 &&
        column.label.trim().length > 0 &&
        ["text", "number", "boolean", "date", "link"].includes(column.type),
      "coluna",
    );
    columns.set(column.id, column.type);
  }
  const ids = new Set<string>(),
    keys = [...columns.keys()];
  for (const row of value.rows) {
    requireThat(
      exactShape(row, ["id", "values"]) &&
        identifier(row.id) &&
        !ids.has(row.id),
      "identificador de linha",
    );
    ids.add(row.id);
    requireThat(exactShape(row.values, keys), "valores da linha");
    for (const key of keys)
      requireThat(
        validSiteCell(row.values[key], columns.get(key)!),
        "tipo ou limite da célula",
      );
  }
  const encoded = canonical(value);
  requireThat(
    new TextEncoder().encode(encoded).length <= SITE_DATA_LIMITS.bytes,
    "orçamento da tabela",
  );
  return JSON.parse(encoded);
}
function parseQuery(value: unknown, table: SiteTable): SiteTableQuery {
  requireThat(
    exactShape(value, ["search", "page", "pageSize"]) ||
      exactShape(value, ["search", "page", "pageSize", "order"]),
    "consulta",
  );
  const q = value as SiteTableQuery;
  requireThat(
    typeof q.search === "string" &&
      q.search.length <= SITE_DATA_LIMITS.queryText &&
      Number.isSafeInteger(q.page) &&
      q.page >= 0 &&
      q.page <= SITE_DATA_LIMITS.rows &&
      [10, 25, 50].includes(q.pageSize),
    "limites da consulta",
  );
  if (Object.hasOwn(q, "order"))
    requireThat(
      exactShape(q.order, ["column", "direction"]) &&
        table.columns.some((c) => c.id === q.order!.column) &&
        ["asc", "desc"].includes(q.order!.direction),
      "ordenação",
    );
  return JSON.parse(canonical(q));
}
const compare = (a: string | number | boolean, b: string | number | boolean) =>
  a < b ? -1 : a > b ? 1 : 0;
/** Sorting and filtering are local projections over an immutable signed table.
 * Nulls remain last, ties use row ID, and search uses literal text, never regex. */
export function querySiteTable(input: unknown, query: unknown) {
  const table = parseSiteTable(input),
    q = parseQuery(query, table),
    needle = q.search.toLowerCase();
  const matching = table.rows.filter(
    (row) =>
      !needle ||
      table.columns.some((column) => {
        const cell = row.values[column.id];
        return cell !== null && String(cell).toLowerCase().includes(needle);
      }),
  );
  if (q.order) {
    const { column, direction } = q.order;
    matching.sort((a, b) => {
      const aa = a.values[column],
        bb = b.values[column];
      if (aa === null && bb !== null) return 1;
      if (bb === null && aa !== null) return -1;
      const order = aa === null || bb === null ? 0 : compare(aa, bb);
      return (direction === "asc" ? order : -order) || compare(a.id, b.id);
    });
  }
  const pages = Math.max(1, Math.ceil(matching.length / q.pageSize)),
    page = Math.min(q.page, pages - 1),
    start = page * q.pageSize;
  return {
    columns: table.columns,
    rows: matching.slice(start, start + q.pageSize),
    total: table.rows.length,
    matched: matching.length,
    page,
    pages,
    pageSize: q.pageSize,
  };
}
