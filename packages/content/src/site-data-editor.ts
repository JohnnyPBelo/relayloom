import {
  parseSiteTable,
  SITE_DATA_LIMITS,
  type SiteCell,
  type SiteColumnType,
  type SiteTable,
} from "./site-data";
const text = (cell: SiteCell) => (cell === null ? "" : String(cell));
export function editSiteCell(input: string, type: SiteColumnType): SiteCell {
  if (input === "" && type !== "text") return null;
  if (type === "number") {
    if (input === "") return null;
    const decimal =
      input.includes(",") && !input.includes(".")
        ? input.replace(",", ".")
        : input;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(decimal)) {
      const value = Number(decimal);
      if (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)
        return value;
    }
    return input; // Keep incomplete/invalid editing text; publishing validation rejects it.
  }
  if (type === "boolean")
    return input === ""
      ? null
      : input === "true"
        ? true
        : input === "false"
          ? false
          : input;
  return input;
}
/** Changing a column type must keep missing values distinct from empty text. */
export function convertSiteCell(
  value: SiteCell,
  type: SiteColumnType,
): SiteCell {
  return value === null ? null : editSiteCell(String(value), type);
}
function formulaSafe(value: string) {
  return /^[=+\-@]/.test(value.trimStart()) || /^[\t\r\n]/.test(value)
    ? "'" + value
    : value;
}
const csvField = (value: string) =>
  /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
/** CSV intentionally has no type/null metadata. Text that spreadsheets could
 * interpret as formulas is escaped. JSON is the lossless project format. */
export function tableCSV(value: unknown): string {
  const table = parseSiteTable(value);
  const lines = [
    table.columns.map((c) => csvField(formulaSafe(c.label))).join(","),
  ];
  for (const row of table.rows)
    lines.push(
      table.columns
        .map((c) => {
          const value = row.values[c.id];
          return csvField(
            typeof value === "number"
              ? String(value)
              : formulaSafe(text(value)),
          );
        })
        .join(","),
    );
  return lines.join("\r\n") + "\r\n";
}
export function tableJSON(value: unknown): string {
  return JSON.stringify(parseSiteTable(value), null, 2);
}
/** RFC4180-style comma-separated text. Import creates text columns so identifiers,
 * leading zeros and user-provided text are not silently reinterpreted. */
export function tableFromCSV(input: string): SiteTable {
  if (
    typeof input !== "string" ||
    new TextEncoder().encode(input).length > 128 * 1024
  )
    throw Error("CSV acima do limite");
  input = input.startsWith("\ufeff") ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    afterQuote = false,
    atStart = true;
  const field = () => {
    if (value.length > SITE_DATA_LIMITS.cellText)
      throw Error("Célula CSV acima do limite");
    row.push(value);
    if (row.length > SITE_DATA_LIMITS.columns)
      throw Error("Demasiadas colunas CSV");
    value = "";
    atStart = true;
    afterQuote = false;
  };
  const line = () => {
    field();
    rows.push(row);
    row = [];
    if (rows.length > SITE_DATA_LIMITS.rows + 1)
      throw Error("Demasiadas linhas CSV");
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else value += c;
      continue;
    }
    if (afterQuote && c !== "," && c !== "\n" && c !== "\r")
      throw Error("Texto após aspas CSV");
    if (c === '"') {
      if (!atStart) throw Error("Aspas CSV inválidas");
      quoted = true;
      atStart = false;
    } else if (c === ",") field();
    else if (c === "\n") line();
    else if (c === "\r") {
      if (input[i + 1] !== "\n") throw Error("Quebra de linha CSV inválida");
      i++;
      line();
    } else {
      value += c;
      atStart = false;
    }
  }
  if (quoted) throw Error("Aspas CSV por fechar");
  if (row.length || value !== "" || afterQuote || !atStart) line();
  if (!rows.length) throw Error("CSV sem cabeçalho");
  const header = rows.shift()!;
  if (header.some((label) => !label.trim() || label.length > 80))
    throw Error("Cabeçalho CSV inválido");
  if (rows.some((row) => row.length !== header.length))
    throw Error("Colunas CSV não correspondem ao cabeçalho");
  const columns = header.map((label, i) => ({
    id: "column-" + (i + 1),
    label,
    type: "text" as const,
  }));
  return parseSiteTable({
    domain: "relayloom/site-table/1",
    columns,
    rows: rows.map((row, i) => ({
      id: "row-" + (i + 1),
      values: Object.fromEntries(
        columns.map((column, j) => [column.id, row[j]]),
      ),
    })),
  });
}
