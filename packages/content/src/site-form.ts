import { canonical, exactShape } from "../../core/src/protocol";
import {
  parseSiteTable,
  validSiteCell,
  type SiteCell,
  type SiteTable,
} from "./site-data";
import type { SiteReadScope } from "./site-resource";

export const SITE_FORM_LIMITS = Object.freeze({
  fields: 12,
  identities: 64,
  bytes: 12 * 1024,
  cellText: 1000,
});
export interface SiteForm {
  domain: "relayloom/site-form/1";
  table: { pageId: string; blockId: string };
  fields: { column: string; required: boolean }[];
  contributors: "readers" | string[];
}
const hashID = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nodeID = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const columnID = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(value);
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw Error("Formulário do site inválido: " + message);
}
function list(value: unknown, maximum: number): asserts value is unknown[] {
  requireThat(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length > 0 &&
      value.length <= maximum,
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
function readers(value: unknown): string[] {
  list(value, SITE_FORM_LIMITS.identities);
  requireThat(
    value.every(
      (id, i) => hashID(id) && (i === 0 || (value[i - 1] as string) < id),
    ),
    "identidades não canónicas",
  );
  return [...value] as string[];
}
/** Consent to later publication is distinct from the encrypted proposal audience. */
export function parseContributionScope(value: unknown): SiteReadScope {
  return value === "public" ? "public" : readers(value);
}
/** A declarative schema, not permission to submit or approve by itself. */
export function parseSiteForm(input: unknown): SiteForm {
  requireThat(
    exactShape(input, ["domain", "table", "fields", "contributors"]),
    "campos",
  );
  const value = input as SiteForm;
  requireThat(value.domain === "relayloom/site-form/1", "domínio");
  requireThat(
    exactShape(value.table, ["pageId", "blockId"]) &&
      nodeID(value.table.pageId) &&
      nodeID(value.table.blockId),
    "destino da tabela",
  );
  list(value.fields, SITE_FORM_LIMITS.fields);
  const ids = new Set<string>();
  for (const field of value.fields) {
    requireThat(
      exactShape(field, ["column", "required"]) &&
        columnID(field.column) &&
        !ids.has(field.column) &&
        typeof field.required === "boolean",
      "campo",
    );
    ids.add(field.column);
  }
  if (value.contributors !== "readers") readers(value.contributors);
  const encoded = canonical(value);
  requireThat(
    new TextEncoder().encode(encoded).length <= SITE_FORM_LIMITS.bytes,
    "orçamento",
  );
  return JSON.parse(encoded);
}
/** Validate a bounded object without executing accessors before the schema is known. */
export function parseContributionValues(
  input: unknown,
): Record<string, SiteCell> {
  requireThat(
    input &&
      typeof input === "object" &&
      Object.getPrototypeOf(input) === Object.prototype,
    "valores",
  );
  const keys = Object.keys(input);
  requireThat(
    keys.length > 0 &&
      keys.length <= SITE_FORM_LIMITS.fields &&
      keys.every(columnID) &&
      exactShape(input, keys),
    "colunas dos valores",
  );
  const values = input as Record<string, SiteCell>;
  for (const key of keys) {
    const value = values[key];
    requireThat(
      value === null ||
        typeof value === "boolean" ||
        (typeof value === "string" &&
          value.length <= SITE_FORM_LIMITS.cellText) ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          Math.abs(value) <= Number.MAX_SAFE_INTEGER),
      "tipo ou tamanho de valor",
    );
  }
  return JSON.parse(canonical(values));
}
/** The runtime must get both inputs from one authenticated snapshot. Never use a
 * caller-supplied table or form to authorise a proposal at the application API. */
export function bindSiteForm(
  formInput: unknown,
  tableInput: unknown,
): { form: SiteForm; table: SiteTable } {
  const form = parseSiteForm(formInput),
    table = parseSiteTable(tableInput);
  requireThat(
    form.fields.length === table.columns.length &&
      form.fields.every((f, i) => f.column === table.columns[i].id),
    "campos não correspondem às colunas",
  );
  return { form, table };
}
export function matchContributionValues(
  formInput: unknown,
  tableInput: unknown,
  input: unknown,
) {
  const { form, table } = bindSiteForm(formInput, tableInput),
    values = parseContributionValues(input);
  requireThat(
    exactShape(
      values,
      table.columns.map((c) => c.id),
    ),
    "valores não correspondem ao formulário",
  );
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i],
      column = table.columns[i],
      value = values[column.id];
    requireThat(validSiteCell(value, column.type), "tipo de valor");
    if (field.required)
      requireThat(
        value !== null &&
          (typeof value !== "string" || value.trim().length > 0),
        "campo obrigatório em falta",
      );
  }
  return values;
}
