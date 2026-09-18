import React, { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import {
  parseSiteTable,
  querySiteTable,
  type SiteCell,
  type SiteDataColumn,
  type SiteTableQuery,
} from "../../../../packages/content/src/site-data";
import { t, getLanguage } from "../i18n/core";
import "./table.css";
function cell(value: SiteCell, column: SiteDataColumn) {
  if (value === null) return <span aria-label={t("Sem valor")}>—</span>;
  if (column.type === "link")
    return (
      <a href={String(value)} target="_blank" rel="noopener noreferrer">
        {String(value)}
      </a>
    );
  if (column.type === "boolean") return t(value ? "Sim" : "Não");
  if (column.type === "number")
    return new Intl.NumberFormat(getLanguage(), {
      maximumSignificantDigits: 17,
    }).format(Number(value));
  if (column.type === "date")
    return new Intl.DateTimeFormat(getLanguage(), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
      ...(String(value).startsWith("0000-") ? { era: "short" as const } : {}),
    }).format(new Date(String(value) + "T00:00:00.000Z"));
  return String(value);
}
/** Component for verified declarative data. It makes no network requests and
 * only holds the reader's search/sort/page; the authored data is never mutated. */
export function SiteTableView({
  data,
  title,
}: {
  data: unknown;
  title: string;
}) {
  const identity = useId(),
    searchID = identity + "-search";
  const parsed = useMemo(() => {
    try {
      return { table: parseSiteTable(data) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [data]);
  const [query, setQuery] = useState<SiteTableQuery>({
    search: "",
    page: 0,
    pageSize: 10,
  });
  // A newer signed snapshot may remove the column previously chosen by the reader.
  const safeQuery =
    parsed.table &&
    query.order &&
    !parsed.table.columns.some((c) => c.id === query.order!.column)
      ? { ...query, order: undefined }
      : query;
  const projection = useMemo(() => {
    if (!parsed.table) return undefined;
    const { order, ...rest } = safeQuery;
    return querySiteTable(parsed.table, {
      ...rest,
      ...(order ? { order } : {}),
    });
  }, [parsed.table, safeQuery]);
  if (!projection)
    return (
      <p role="alert">
        {t("Não foi possível verificar os dados desta tabela.")}
      </p>
    );
  const sort = (column: string) =>
    setQuery((previous) => {
      const { order, ...rest } = previous;
      return {
        ...rest,
        page: 0,
        ...(!order || order.column !== column
          ? { order: { column, direction: "asc" as const } }
          : order.direction === "asc"
            ? { order: { column, direction: "desc" as const } }
            : {}),
      };
    });
  return (
    <section className="site-data" aria-label={title || t("Tabela de dados")}>
      <div className="site-data-tools">
        <label htmlFor={searchID}>
          {t("Pesquisar nesta tabela")}
          <span>
            <Search size={16} aria-hidden="true" />
            <input
              id={searchID}
              type="search"
              maxLength={160}
              value={query.search}
              onChange={(e) =>
                setQuery({ ...query, search: e.target.value, page: 0 })
              }
            />
          </span>
        </label>
        <label>
          {t("Linhas por página")}
          <select
            aria-label={t("Linhas por página")}
            value={query.pageSize}
            onChange={(e) =>
              setQuery({
                ...query,
                pageSize: Number(e.target.value) as 10 | 25 | 50,
                page: 0,
              })
            }
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {(query.search || query.order) && (
          <button
            type="button"
            onClick={() =>
              setQuery({ search: "", page: 0, pageSize: query.pageSize })
            }
          >
            <X size={16} />
            {t("Limpar filtros")}
          </button>
        )}
      </div>
      <div
        className="site-data-scroll"
        tabIndex={0}
        role="region"
        aria-label={t("Dados de {title}", {
          title: title || t("Tabela de dados"),
        })}
      >
        <table>
          <caption>{title || t("Tabela de dados")}</caption>
          <thead>
            <tr>
              {projection.columns.map((column) => (
                <th
                  scope="col"
                  key={column.id}
                  aria-sort={
                    safeQuery.order?.column === column.id
                      ? safeQuery.order.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => sort(column.id)}
                    aria-label={t("Ordenar por {column}", {
                      column: column.label,
                    })}
                  >
                    {column.label}
                    {safeQuery.order?.column === column.id ? (
                      safeQuery.order.direction === "asc" ? (
                        <ArrowUp size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )
                    ) : (
                      <ChevronsUpDown size={14} />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projection.rows.map((row) => (
              <tr key={row.id}>
                {projection.columns.map((column) => (
                  <td key={column.id}>{cell(row.values[column.id], column)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {projection.matched === 0 && (
          <p>{t("Não há linhas para esta pesquisa.")}</p>
        )}
      </div>
      <div className="site-data-pagination">
        <p role="status">
          {t("{shown} de {matched} linhas · página {page} de {pages}", {
            shown: projection.rows.length,
            matched: projection.matched,
            page: projection.page + 1,
            pages: projection.pages,
          })}
        </p>
        <div>
          <button
            type="button"
            disabled={projection.page === 0}
            onClick={() => setQuery({ ...query, page: projection.page - 1 })}
          >
            {t("Página anterior")}
          </button>
          <button
            type="button"
            disabled={projection.page + 1 >= projection.pages}
            onClick={() => setQuery({ ...query, page: projection.page + 1 })}
          >
            {t("Página seguinte")}
          </button>
        </div>
      </div>
    </section>
  );
}
