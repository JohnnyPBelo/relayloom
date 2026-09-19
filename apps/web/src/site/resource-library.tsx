import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileText,
  FileUp,
  FolderOpen,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Table2,
  X,
} from "lucide-react";
import { api } from "../api";
import { t, getLanguage } from "../i18n/core";
import {
  parseSiteResource,
  matchSiteResource,
  resourceScopeCoversSite,
  SITE_FILE_TYPES,
  type SiteResource,
  type SiteResourceReference,
  type SiteReadScope,
} from "../../../../packages/content/src/site-resource";
import type { SiteTable } from "../../../../packages/content/src/site-data";
import type {
  ResourceCreationRecord,
  ResourceOperation,
} from "../../../../packages/sites/src/resource-operations";
import {
  ResourceCreator,
  formatResourceBytes,
  loadResourceLibrary,
  type ResourceEntry,
} from "./resources";
import { SiteTableEditor } from "./table-editor";
import { ResourcePayload } from "./resource-view";
import "./resources.css";

export function ResourceLibrary({
  ownerId,
  scope,
  ttlMs,
  active,
  onChoose,
  close,
}: {
  ownerId: string;
  scope: SiteReadScope;
  ttlMs: number;
  active(): boolean;
  onChoose(reference: SiteResourceReference): void;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true),
    busyRef = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  const isActive = () => alive.current && active();
  const creator = useMemo(
    () => new ResourceCreator(api, ownerId, isActive),
    [ownerId],
  );
  const [entries, setEntries] = useState<ResourceEntry[]>([]),
    [journal, setJournal] = useState<ResourceCreationRecord>(),
    [tab, setTab] = useState<"saved" | "file" | "table">("saved"),
    [search, setSearch] = useState(""),
    [name, setName] = useState(""),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [preview, setPreview] = useState<SiteResource>(),
    [lifetime, setLifetime] = useState(ttlMs),
    [table, setTable] = useState<SiteTable>({
      domain: "relayloom/site-table/1",
      columns: [
        { id: "name", label: t("Nome"), type: "text" },
        { id: "value", label: t("Valor"), type: "text" },
      ],
      rows: [],
    });
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    void refresh();
    return () => {
      alive.current = false;
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function refresh() {
    if (!isActive()) return;
    setLoading(true);
    try {
      const records = await creator.state(),
        resources = await loadResourceLibrary(api, isActive);
      if (isActive()) {
        setJournal(records);
        setEntries(resources);
      }
    } catch (e) {
      if (isActive()) setError((e as Error).message);
    } finally {
      if (isActive()) setLoading(false);
    }
  }
  async function run(fn: () => Promise<void>) {
    if (busyRef.current || !isActive()) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await fn();
    } catch (e) {
      if (isActive()) setError((e as Error).message);
    } finally {
      busyRef.current = false;
      if (isActive()) {
        setBusy(false);
        setUncertain(creator.uncertain);
      }
    }
  }
  function selectedFile(value?: File) {
    if (!value || busy || uncertain) return;
    if (value.size > 2 * 1024 * 1024) {
      setError("O ficheiro excede 2 MiB.");
      return;
    }
    setFile(value);
    setName(value.name);
    setError("");
  }
  function outcome(result: { operation: ResourceOperation; error?: string }) {
    setFeedback(
      result.operation.phase === "ready"
        ? "Recurso guardado. Escolhe Inserir no site para o juntar ao rascunho."
        : result.operation.phase === "expired"
          ? "O prazo da tentativa terminou. Não foi criada outra cópia."
          : "A criação ficou guardada e pode ser retomada.",
    );
    setError(result.error ?? "");
  }
  async function create() {
    let content: SiteResource;
    if (tab === "table")
      content = parseSiteResource({
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "table",
        name,
        table,
      });
    else {
      if (!file) throw Error("Escolhe um ficheiro.");
      if (file.size > 2 * 1024 * 1024) throw Error("O ficheiro excede 2 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isActive()) return;
      let text = "";
      for (let i = 0; i < bytes.length; i += 8192)
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const mime = SITE_FILE_TYPES.includes(file.type as any)
        ? file.type
        : "application/octet-stream";
      content = parseSiteResource({
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "file",
        name,
        mime,
        data: btoa(text),
      });
    }
    const result = await creator.create(content, scope, lifetime);
    if (!isActive()) return;
    outcome(result);
    setTab("saved");
    setPreview(undefined);
    await refresh();
  }
  async function open(entry: ResourceEntry) {
    const value = await api("view", { id: entry.reference.bundleId });
    if (!isActive()) return;
    if (value.deleted) throw Error("O autor retirou este recurso");
    const content = matchSiteResource(entry.reference, value.content, {
      id: value.id,
      authorId: value.author.id,
      kind: value.kind,
    });
    setPreview(content);
  }
  const pending =
      journal?.operations.filter((op) => op.phase === "copy-pending") ?? [],
    shown = entries.filter((entry) =>
      (entry.reference.name + " " + entry.author.name)
        .toLocaleLowerCase(getLanguage())
        .includes(search.toLocaleLowerCase(getLanguage())),
    );
  return (
    <dialog
      ref={dialog}
      className="resource-library"
      aria-label={t("Biblioteca de recursos")}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">{t("O TEU ARQUIVO DISTRIBUÍDO")}</span>
          <h2>{t("Biblioteca de recursos")}</h2>
        </div>
        <button
          type="button"
          className="icon"
          disabled={busy}
          aria-label={t("Fechar")}
          onClick={close}
        >
          <X />
        </button>
      </div>
      <p className="resource-intro">
        {t(
          "Ficheiros e dados para dar mais vida ao teu site. Cada recurso conserva a assinatura do seu criador.",
        )}
      </p>
      <div
        className="resource-tabs"
        role="group"
        aria-label={t("Escolher recursos")}
      >
        {(
          [
            ["saved", "Guardados", FolderOpen],
            ["file", "Novo ficheiro", FileUp],
            ["table", "Nova tabela", Table2],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            disabled={busy || uncertain}
            onClick={() => {
              setTab(key);
              setPreview(undefined);
              setError("");
            }}
          >
            <Icon size={18} />
            {t(label)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {feedback && (
        <p
          role="status"
          aria-label={t("Estado da criação do recurso")}
          className="resource-feedback"
        >
          <Check size={17} />
          {t(feedback)}
        </p>
      )}
      {uncertain && (
        <div className="resource-pending">
          <p>
            {t(
              "O resultado ainda não foi confirmado. Verifica a mesma tentativa antes de criar outra cópia.",
            )}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await creator.retry();
                if (!isActive()) return;
                outcome(result);
                setTab("saved");
                await refresh();
              })
            }
          >
            <RefreshCw size={17} />
            {t("Confirmar a mesma tentativa")}
          </button>
        </div>
      )}
      {pending.map((op) => (
        <div className="resource-pending" key={op.operationId}>
          <strong>{op.reference.name}</strong>
          <p>
            {t(
              "A assinatura está guardada. Falta concluir a cópia neste dispositivo.",
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await creator.resume(op);
                if (!isActive()) return;
                outcome(result);
                await refresh();
              })
            }
          >
            <RefreshCw size={17} />
            {t("Retomar criação")}
          </button>
        </div>
      ))}
      {tab === "saved" ? (
        <>
          <div className="resource-search">
            <label>
              <Search size={17} />
              <input
                aria-label={t("Pesquisar recursos")}
                placeholder={t("Pesquisar recursos")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="icon"
              aria-label={t("Actualizar arquivo")}
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {loading ? (
            <p role="status">{t("A abrir o arquivo local…")}</p>
          ) : shown.length === 0 ? (
            <div className="resource-empty">
              <FolderOpen size={34} />
              <h3>
                {t(
                  entries.length
                    ? "Nenhum recurso corresponde à pesquisa"
                    : "O teu arquivo começa aqui",
                )}
              </h3>
              <p>
                {t(
                  "Adiciona um ficheiro ou cria uma tabela. Os recursos que leres noutros sites também podem ficar aqui.",
                )}
              </p>
            </div>
          ) : (
            <div className="resource-grid">
              {shown.map((entry) => {
                const compatible = resourceScopeCoversSite(scope, entry.scope),
                  usable =
                    compatible &&
                    !entry.withdrawn &&
                    entry.expires > Date.now(),
                  Icon = entry.reference.kind === "table" ? Table2 : FileText;
                return (
                  <article
                    className="resource-card"
                    key={entry.reference.bundleId}
                  >
                    <Icon size={25} />
                    <div>
                      <h3>{entry.reference.name}</h3>
                      <p>
                        {entry.author.name} ·{" "}
                        {entry.author.id === ownerId
                          ? t("Criado por ti")
                          : t("Autor original")}
                      </p>
                      <p className="small-note">
                        {formatResourceBytes(
                          entry.reference.bytes,
                          getLanguage(),
                        )}{" "}
                        · {t(entry.scope === "public" ? "Público" : "Privado")}
                      </p>
                      <p className="small-note">
                        {t("Disponível até {date}", {
                          date: new Date(entry.expires).toLocaleDateString(
                            getLanguage(),
                          ),
                        })}
                      </p>
                    </div>
                    {entry.withdrawn ? (
                      <p>{t("O autor retirou este recurso")}</p>
                    ) : !compatible ? (
                      <p className="resource-policy">
                        <LockKeyhole size={14} />
                        {t(
                          "Não permite todos os leitores escolhidos para este site.",
                        )}
                      </p>
                    ) : null}
                    <div className="resource-card-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !usable}
                        onClick={() =>
                          void run(async () => {
                            const current = await api("view", {
                              id: entry.reference.bundleId,
                            });
                            if (!isActive()) return;
                            if (current.deleted)
                              throw Error("O autor retirou este recurso");
                            matchSiteResource(
                              entry.reference,
                              current.content,
                              {
                                id: current.id,
                                authorId: current.author.id,
                                kind: current.kind,
                              },
                            );
                            onChoose(entry.reference);
                          })
                        }
                      >
                        <Plus size={16} />
                        {t("Inserir no site")}
                      </button>
                      <button
                        type="button"
                        disabled={busy || entry.withdrawn}
                        onClick={() => void run(() => open(entry))}
                      >
                        {t("Abrir recurso")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {preview && (
            <section
              className="resource-library-preview"
              aria-label={t("Pré-visualização do recurso")}
            >
              <div className="modal-head">
                <h3>{preview.name}</h3>
                <button
                  type="button"
                  className="icon"
                  aria-label={t("Fechar pré-visualização")}
                  onClick={() => setPreview(undefined)}
                >
                  <X size={18} />
                </button>
              </div>
              <ResourcePayload content={preview} />
            </section>
          )}
        </>
      ) : (
        <div className="resource-create">
          {tab === "file" && (
            <div
              className="resource-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                selectedFile(e.dataTransfer.files[0]);
              }}
            >
              <FileUp size={30} />
              <strong>
                {file?.name ?? t("Arrasta um ficheiro para aqui")}
              </strong>
              <span>
                {t("Até 2 MiB por ficheiro. Sem execução de scripts.")}
              </span>
              <input
                ref={fileInput}
                type="file"
                aria-label={t("Ficheiro do recurso")}
                disabled={busy || uncertain}
                onChange={(e) => selectedFile(e.target.files?.[0])}
              />
            </div>
          )}
          <div className="resource-form-row">
            <label>
              {t("Nome do recurso")}
              <input
                value={name}
                maxLength={150}
                disabled={busy || uncertain}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              {t("Prazo do recurso")}
              <select
                value={lifetime}
                disabled={busy || uncertain}
                onChange={(e) => setLifetime(Number(e.target.value))}
              >
                {[86400000, 7 * 86400000, 30 * 86400000, 365 * 86400000].map(
                  (ms) => (
                    <option value={ms} key={ms}>
                      {t(
                        ms === 86400000
                          ? "Um dia"
                          : ms === 7 * 86400000
                            ? "Uma semana"
                            : ms === 30 * 86400000
                              ? "Um mês"
                              : "Um ano",
                      )}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          {tab === "table" && (
            <SiteTableEditor
              data={table}
              onChange={setTable}
              disabled={busy || uncertain}
            />
          )}
          <div className="resource-create-footer">
            <p>
              <LockKeyhole size={16} />
              {t(
                scope === "public"
                  ? "Recurso público: quem receber a referência poderá obtê-lo."
                  : "Só os leitores escolhidos para este site poderão abrir o recurso.",
              )}
            </p>
            <p className="small-note">
              {t(
                "Guardar não envia estes dados à rede. A página publicada partilha a referência; cada leitor decide obter os dados.",
              )}
            </p>
            <button
              type="button"
              className="primary"
              disabled={
                busy || uncertain || !name.trim() || (tab === "file" && !file)
              }
              onClick={() => void run(create)}
            >
              {busy ? t("A guardar recurso…") : t("Guardar recurso")}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
