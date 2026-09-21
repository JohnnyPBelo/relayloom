import { formatResourceBytes } from "./resources";
import { canonical } from "../../../../packages/core/src/protocol";
import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  RefreshCw,
  Table2,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api";
import { resourceInspector } from "./resource-inspection";
import { t, getLanguage } from "../i18n/core";
import {
  parseSiteResource,
  type SiteResource,
  type SiteResourceReference,
} from "../../../../packages/content/src/site-resource";
import { SiteTableView } from "./table";
import "./resources.css";

export function ResourcePayload({ content }: { content: SiteResource }) {
  const [fileURL, setFileURL] = useState<{
    content: SiteResource;
    url: string;
  }>();
  // A render may receive new content before the previous effect is cleaned up.
  // Never pair that content's name/MIME with the previous file's bytes.
  const url = fileURL?.content === content ? fileURL.url : "";
  useEffect(() => {
    if (content.kind !== "file") return;
    const bytes = Uint8Array.from(atob(content.data), (char) =>
        char.charCodeAt(0),
      ),
      objectURL = URL.createObjectURL(
        new Blob([bytes], { type: content.mime }),
      );
    setFileURL({ content, url: objectURL });
    return () => {
      URL.revokeObjectURL(objectURL);
      setFileURL((current) =>
        current?.url === objectURL ? undefined : current,
      );
    };
  }, [content]);
  if (content.kind === "table")
    return <SiteTableView data={content.table} title={content.name} />;
  return (
    <div className="resource-payload">
      {url && /^image\/(png|jpeg|webp|gif)$/.test(content.mime) && (
        <img src={url} alt={content.name} />
      )}
      {url && /^audio\/(ogg|mpeg|webm|wav|mp4)$/.test(content.mime) && (
        <audio src={url} controls aria-label={content.name} />
      )}
      {url && /^video\/(mp4|webm)$/.test(content.mime) && (
        <video
          src={url}
          controls
          preload="metadata"
          aria-label={content.name}
        />
      )}
      {url && (
        <a className="resource-download" href={url} download={content.name}>
          <Download size={18} />
          {t("Guardar ficheiro")}
          <span>{content.name}</span>
        </a>
      )}
    </div>
  );
}
const labels: Record<string, string> = {
  loading: "A verificar o recurso…",
  available: "Disponível neste dispositivo",
  missing: "Ainda não guardado neste dispositivo",
  requested: "À espera de uma cópia na rede",
  blocked: "Este autor está bloqueado",
  unreadable: "Não tens acesso a este recurso",
  expired: "O prazo deste recurso terminou",
  invalid: "Não foi possível verificar esta cópia",
  withdrawn: "O autor retirou este recurso",
};
export function SiteResourceView({
  reference,
  title,
  target,
  authorHint,
}: {
  reference: SiteResourceReference;
  authorHint?: { id: string; name: string };
  title: string;
  target?: { snapshotId: string; pageId: string; blockId: string };
}) {
  const [author, setAuthor] = useState<{ id: string; name: string }>();
  const [status, setStatus] = useState("loading"),
    [content, setContent] = useState<SiteResource>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | undefined>(undefined),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const identity = target
    ? `${target.snapshotId}:${target.pageId}:${target.blockId}:${reference.bundleId}`
    : reference.bundleId;
  useEffect(() => {
    generation.current++;
    setContent(undefined);
    setAuthor(undefined);
    setError("");
    setBusy(false);
    setStatus("loading");
    if (target) void check("inspect");
    return () => {
      generation.current++;
      controller.current?.abort();
      clearTimeout(timer.current);
    };
  }, [identity]);
  async function check(action: "inspect" | "obtain", attempt = 0) {
    if (!target) return;
    const own = generation.current,
      abort = new AbortController();
    const isCurrent = () =>
      own === generation.current &&
      controller.current === abort &&
      !abort.signal.aborted;
    controller.current?.abort();
    controller.current = abort;
    clearTimeout(timer.current);
    setError("");
    if (action === "obtain") setBusy(true);
    try {
      const result =
        action === "inspect"
          ? await resourceInspector.inspect(target, abort.signal, reference)
          : await api("resource-command", { action, ...target }, abort.signal);
      if (!isCurrent()) return;
      if (canonical(result.reference) !== canonical(reference))
        throw Error("A resposta não corresponde ao recurso desta página.");
      setStatus(result.status);
      if (result.author?.id === reference.authorId) setAuthor(result.author);
      if (result.content) setContent(parseSiteResource(result.content));
      if (
        result.status === "requested" ||
        (action === "inspect" && attempt > 0 && result.status === "missing")
      ) {
        setStatus("requested");
        if (attempt < 15)
          timer.current = setTimeout(
            () => void check("inspect", attempt + 1),
            1000,
          );
      } else if (result.status === "available" && attempt > 0) {
        void check("obtain");
      }
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  const Icon = reference.kind === "table" ? Table2 : FileText;
  return (
    <div className="site-resource" data-resource-id={reference.bundleId}>
      <div className="resource-heading">
        <span className="resource-symbol">
          <Icon size={23} />
        </span>
        <div>
          <span className="eyebrow">
            {t(
              reference.kind === "table"
                ? "DADOS PARTILHADOS"
                : "FICHEIRO PARTILHADO",
            )}
          </span>
          <h2>{title || reference.name}</h2>
          <p>
            {reference.name} ·{" "}
            <span className="resource-size">
              {formatResourceBytes(reference.bytes, getLanguage())}
            </span>
          </p>
        </div>
      </div>
      <p className="resource-credit">
        <ShieldCheck size={15} />
        {t("Autor original")}{" "}
        <span title={reference.authorId}>
          {author?.name ??
            (authorHint?.id === reference.authorId
              ? authorHint.name
              : reference.authorId.slice(0, 12))}
        </span>
      </p>
      {!target ? (
        <p className="studio-note">
          {t("A obtenção fica disponível depois de publicar o site.")}
        </p>
      ) : (
        <>
          <p role="status" className="resource-status">
            {t(labels[status] ?? "A verificar o recurso…")}
          </p>
          {!content &&
            ![
              "blocked",
              "unreadable",
              "expired",
              "invalid",
              "withdrawn",
              "loading",
            ].includes(status) && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void check("obtain")}
              >
                <Download size={17} />
                {t(
                  reference.kind === "table"
                    ? "Obter e abrir tabela"
                    : "Obter ficheiro",
                )}
              </button>
            )}
          {!content && ["invalid", "requested", "missing"].includes(status) && (
            <button
              type="button"
              className="resource-check"
              disabled={busy}
              onClick={() => void check("inspect")}
            >
              <RefreshCw size={15} />
              {t("Verificar disponibilidade")}
            </button>
          )}
        </>
      )}
      {error && (
        <>
          <p role="alert" className="error">
            {t(error)}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void check("inspect")}
          >
            {t("Tentar novamente")}
          </button>
        </>
      )}
      {content && <ResourcePayload content={content} />}
      <p className="small-note">
        {t(
          "A tua cópia pode ajudar outras pessoas. A autoria continua a ser do criador.",
        )}
      </p>
    </div>
  );
}
