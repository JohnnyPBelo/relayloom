import React, { useEffect, useId, useRef, useState } from "react";
import {
  Columns3,
  Download,
  FileUp,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  parseSiteTable,
  validSiteCell,
  SITE_DATA_LIMITS,
  type SiteCell,
  type SiteTable,
  type SiteColumnType,
} from "../../../../packages/content/src/site-data";
import {
  editSiteCell,
  convertSiteCell,
  tableCSV,
  tableJSON,
  tableFromCSV,
} from "../../../../packages/content/src/site-data-editor";
import { t } from "../i18n/core";
import "./table-editor.css";
const types: SiteColumnType[] = ["text", "number", "boolean", "date", "link"];
const typeLabels: Record<SiteColumnType, string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sim ou não",
  date: "Data",
  link: "Ligação HTTPS",
};
const stringCell = (value: SiteCell) => (value === null ? "" : String(value));
function Confirmation({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" aria-label={t("Fechar")} onClick={close}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
/** Authoring controls manipulate an owned declarative value. No scripts from
 * imports are executed. Parsing and schema validation precede replacement. */
export function SiteTableEditor({
  data,
  onChange,
  disabled,
}: {
  data: SiteTable;
  onChange: (value: SiteTable) => void;
  disabled: boolean;
}) {
  const errorID = useId();
  const [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [incoming, setIncoming] = useState<SiteTable>(),
    [remove, setRemove] = useState<{ kind: "row" | "column"; id: string }>(),
    [format, setFormat] = useState<"json" | "csv">("json"),
    [working, setWorking] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    live = useRef(true),
    generation = useRef(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
    };
  }, []);
  const current = Math.min(
      page,
      Math.max(0, Math.ceil(data.rows.length / 10) - 1),
    ),
    rows = data.rows.slice(current * 10, current * 10 + 10);
  function change(edit: (next: SiteTable) => void) {
    if (disabled || working) return;
    setError("");
    setFeedback("");
    const next = structuredClone(data);
    edit(next);
    onChange(next);
  }
  function addRow() {
    change((next) => {
      if (next.rows.length >= SITE_DATA_LIMITS.rows)
        throw Error("Limite de linhas atingido");
      next.rows.push({
        id: "r-" + crypto.randomUUID(),
        values: Object.fromEntries(next.columns.map((c) => [c.id, null])),
      });
    });
    setPage(Math.floor(data.rows.length / 10));
  }
  function addColumn() {
    change((next) => {
      if (next.columns.length >= SITE_DATA_LIMITS.columns)
        throw Error("Limite de colunas atingido");
      const id = "c-" + crypto.randomUUID();
      next.columns.push({ id, label: t("Nova coluna"), type: "text" });
      for (const row of next.rows) row.values[id] = null;
    });
  }
  async function importFile(selected: File | undefined) {
    if (!selected || disabled || working) return;
    const own = ++generation.current;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      if (selected.size > 128 * 1024)
        throw Error("O ficheiro de dados excede 128 KiB");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await selected.arrayBuffer(),
        );
      } catch {
        throw Error("Não foi possível ler o ficheiro como texto UTF-8");
      }
      if (!live.current || own !== generation.current || disabledRef.current)
        return;
      let decoded: unknown;
      if (format === "json") {
        try {
          decoded = JSON.parse(text);
        } catch {
          throw Error("O ficheiro JSON não é válido");
        }
      }
      const parsed =
        format === "csv" ? tableFromCSV(text) : parseSiteTable(decoded);
      setIncoming(parsed);
    } catch (e) {
      if (live.current && own === generation.current)
        setError((e as Error).message);
    } finally {
      if (live.current && own === generation.current) setWorking(false);
      if (file.current) file.current.value = "";
    }
  }
  function download() {
    setError("");
    setFeedback("");
    try {
      const content = format === "csv" ? tableCSV(data) : tableJSON(data),
        url = URL.createObjectURL(
          new Blob([content], {
            type:
              format === "csv" ? "text/csv;charset=utf-8" : "application/json",
          }),
        );
      const link = document.createElement("a");
      link.href = url;
      link.download = "relayloom-table." + format;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback("Exportação da tabela iniciada");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  let invalid = false;
  try {
    const candidate = structuredClone(data);
    for (const column of candidate.columns)
      if (column.type === "number")
        for (const row of candidate.rows)
          if (typeof row.values[column.id] === "string")
            row.values[column.id] = editSiteCell(
              String(row.values[column.id]),
              "number",
            );
    parseSiteTable(candidate);
  } catch {
    invalid = true;
  }
  const closeImport = () => setIncoming(undefined),
    closeRemove = () => setRemove(undefined);
  return (
    <section
      className="table-editor"
      aria-label={t("Editar dados da tabela")}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.stopPropagation()}
    >
      <div className="table-editor-heading">
        <Table2 size={20} />
        <div>
          <strong>{t("Uma tabela, muitas possibilidades")}</strong>
          <p>
            {t(
              "Cria listas, directórios ou registos. Os leitores podem pesquisar e ordenar sem alterar o original.",
            )}
          </p>
        </div>
      </div>
      <p className="small-note">
        {t(
          "Para ler estas tabelas, os outros participantes precisam de uma versão recente do RelayLoom.",
        )}
      </p>
      <fieldset
        disabled={disabled || working}
        className="table-editor-controls"
      >
        <div className="table-editor-actions">
          <button
            type="button"
            onClick={addRow}
            disabled={data.rows.length >= 256}
          >
            <Plus size={16} />
            {t("Adicionar linha")}
          </button>
          <button
            type="button"
            onClick={addColumn}
            disabled={data.columns.length >= 12}
          >
            <Columns3 size={16} />
            {t("Adicionar coluna")}
          </button>
          <span>
            {t("{rows}/256 linhas · {columns}/12 colunas", {
              rows: data.rows.length,
              columns: data.columns.length,
            })}
          </span>
        </div>
        <div
          className="table-editor-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Células editáveis da tabela")}
        >
          <table>
            <caption>{t("Colunas e valores")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Linha")}</th>
                {data.columns.map((column, i) => (
                  <th scope="col" key={column.id}>
                    <input
                      aria-label={t("Nome da coluna {number}", {
                        number: i + 1,
                      })}
                      maxLength={80}
                      aria-invalid={
                        !column.label.trim() || column.label.length > 80
                      }
                      aria-describedby={invalid ? errorID : undefined}
                      value={column.label}
                      onChange={(e) =>
                        change((next) => {
                          next.columns[i].label = e.target.value;
                        })
                      }
                    />
                    <div className="table-editor-column-tools">
                      <select
                        aria-label={t("Tipo da coluna {number}", {
                          number: i + 1,
                        })}
                        value={column.type}
                        onChange={(e) =>
                          change((next) => {
                            const type = e.target.value as SiteColumnType;
                            next.columns[i].type = type;
                            for (const row of next.rows)
                              row.values[column.id] = convertSiteCell(
                                row.values[column.id],
                                type,
                              );
                          })
                        }
                      >
                        {types.map((type) => (
                          <option key={type} value={type}>
                            {t(typeLabels[type])}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={data.columns.length === 1}
                        aria-label={t("Eliminar coluna {number}", {
                          number: i + 1,
                        })}
                        onClick={() =>
                          setRemove({ kind: "column", id: column.id })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, offset) => {
                const number = current * 10 + offset + 1;
                return (
                  <tr key={row.id}>
                    <th scope="row">
                      <span>{number}</span>
                      <button
                        type="button"
                        aria-label={t("Eliminar linha {number}", { number })}
                        onClick={() => setRemove({ kind: "row", id: row.id })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </th>
                    {data.columns.map((column) => {
                      const value = row.values[column.id],
                        invalidCell = !validSiteCell(
                          column.type === "number" && typeof value === "string"
                            ? editSiteCell(value, "number")
                            : value,
                          column.type,
                        ),
                        label = t("Linha {number}, {column}", {
                          number,
                          column: column.label || t("Coluna sem nome"),
                        }),
                        update = (value: SiteCell) =>
                          change((next) => {
                            next.rows.find((r) => r.id === row.id)!.values[
                              column.id
                            ] = value;
                          });
                      return (
                        <td key={column.id}>
                          {column.type === "boolean" ? (
                            <select
                              aria-label={label}
                              aria-invalid={invalidCell}
                              aria-describedby={
                                invalidCell ? errorID : undefined
                              }
                              value={
                                value === null
                                  ? ""
                                  : typeof value === "boolean"
                                    ? String(value)
                                    : "invalid"
                              }
                              onChange={(e) =>
                                update(editSiteCell(e.target.value, "boolean"))
                              }
                            >
                              {value !== null && typeof value !== "boolean" && (
                                <option value="invalid" disabled>
                                  {String(value)}
                                </option>
                              )}
                              <option value="">{t("Sem valor")}</option>
                              <option value="true">{t("Sim")}</option>
                              <option value="false">{t("Não")}</option>
                            </select>
                          ) : column.type === "text" ? (
                            <textarea
                              aria-label={label}
                              aria-invalid={invalidCell}
                              aria-describedby={
                                invalidCell ? errorID : undefined
                              }
                              value={stringCell(value)}
                              maxLength={1000}
                              rows={2}
                              onChange={(e) => update(e.target.value)}
                            />
                          ) : (
                            <input
                              aria-label={label}
                              aria-invalid={invalidCell}
                              aria-describedby={
                                invalidCell ? errorID : undefined
                              }
                              value={stringCell(value)}
                              maxLength={column.type === "link" ? 2000 : 1000}
                              inputMode={
                                column.type === "number" ? "decimal" : undefined
                              }
                              placeholder={
                                column.type === "date"
                                  ? t("AAAA-MM-DD")
                                  : column.type === "link"
                                    ? "https://…"
                                    : undefined
                              }
                              onChange={(e) =>
                                update(
                                  column.type === "number"
                                    ? e.target.value
                                    : editSiteCell(e.target.value, column.type),
                                )
                              }
                              onBlur={(e) => {
                                if (column.type === "number")
                                  update(
                                    editSiteCell(e.target.value, "number"),
                                  );
                              }}
                              onKeyDown={(e) => {
                                if (
                                  column.type === "number" &&
                                  e.key === "Enter"
                                ) {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.rows.length && (
          <p>
            {t(
              "A tabela está vazia. Adiciona uma linha ou importa um ficheiro.",
            )}
          </p>
        )}
        <div className="table-editor-pagination">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t("Página anterior")}
          </button>
          <span>
            {t("Página {page} de {pages}", {
              page: current + 1,
              pages: Math.max(1, Math.ceil(data.rows.length / 10)),
            })}
          </span>
          <button
            type="button"
            disabled={(current + 1) * 10 >= data.rows.length}
            onClick={() => setPage(current + 1)}
          >
            {t("Página seguinte")}
          </button>
        </div>
        <div className="table-editor-actions">
          <label>
            {t("Formato dos dados")}
            <select
              aria-label={t("Formato dos dados")}
              value={format}
              onChange={(e) => setFormat(e.target.value as "csv" | "json")}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <button type="button" onClick={() => file.current?.click()}>
            <FileUp size={16} />
            {t("Importar dados")}
          </button>
          <button type="button" onClick={download}>
            <Download size={16} />
            {t("Exportar dados")}
          </button>
          <input
            ref={file}
            hidden
            type="file"
            tabIndex={-1}
            aria-label={t("Ficheiro de dados da tabela")}
            accept={
              format === "csv" ? ".csv,text/csv" : ".json,application/json"
            }
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
        <p className="small-note">
          {format === "json"
            ? t("JSON conserva os tipos e os campos vazios.")
            : t(
                "CSV importa texto sem adivinhar tipos. A exportação protege texto que folhas de cálculo tratariam como fórmulas.",
              )}
        </p>
        <p className="small-note">
          {t(
            "Números aceitam ponto ou vírgula decimal. Datas usam AAAA-MM-DD.",
          )}
        </p>
      </fieldset>
      {invalid && (
        <p id={errorID} role="alert" className="error">
          {t(
            "Há células ou colunas inválidas. Corrige-as antes de publicar ou exportar.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {feedback && <p role="status">{t(feedback)}</p>}
      {incoming && (
        <Confirmation
          title={t("Substituir dados da tabela")}
          close={closeImport}
        >
          <p>
            {t(
              "O ficheiro foi validado. Confirma a substituição; podes desfazer a alteração no estúdio.",
            )}
          </p>
          <p>
            {t("{rows} linhas · {columns} colunas", {
              rows: incoming.rows.length,
              columns: incoming.columns.length,
            })}
          </p>
          <ul>
            {incoming.columns.map((c) => (
              <li key={c.id}>{c.label}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(incoming);
              setPage(0);
              setIncoming(undefined);
              setFeedback("Dados importados para o rascunho");
            }}
          >
            {t("Substituir por estes dados")}
          </button>
        </Confirmation>
      )}
      {remove && (
        <Confirmation
          title={
            remove.kind === "row"
              ? t("Eliminar linha da tabela")
              : t("Eliminar coluna da tabela")
          }
          close={closeRemove}
        >
          <p>
            {t(
              "A alteração fica no rascunho e pode ser desfeita antes de fechar o estúdio.",
            )}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              change((next) => {
                if (remove.kind === "row")
                  next.rows = next.rows.filter((row) => row.id !== remove.id);
                else {
                  next.columns = next.columns.filter((c) => c.id !== remove.id);
                  for (const row of next.rows) delete row.values[remove.id];
                }
              });
              setRemove(undefined);
            }}
          >
            {t("Confirmar eliminação")}
          </button>
        </Confirmation>
      )}
    </section>
  );
}
