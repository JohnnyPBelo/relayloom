import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, History, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n/core";
import type { DisplayObject } from "../../../../packages/content/src/types";
import type { StoredRevision } from "../../../../packages/sites/src/registry";
import type { SiteRevision } from "../../../../packages/sites/src/protocol";
import "./history.css";
interface SiteState {
  number: number;
  status: string;
  heads: SiteRevision[];
}

/** Reads the actual local catalog. A known signature is not a claim that its
 * payload is present, globally current, or editable by this reader. */
export function SiteHistory({
  address,
  onView,
  onRecover,
  refreshKey,
}: {
  address: string;
  onView: (object: DisplayObject) => void;
  onRecover?: (object: DisplayObject) => Promise<boolean>;
  refreshKey?: string;
}) {
  const [state, setState] = useState<SiteState>(),
    [revisions, setRevisions] = useState<StoredRevision[]>([]),
    [open, setOpen] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const generation = useRef(0),
    request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    setState(undefined);
    setRevisions([]);
    setOpen(false);
    setWorking(false);
    setError("");
    setFeedback("");
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [address]);
  useEffect(() => {
    if (open) void load();
  }, [refreshKey]);
  async function load() {
    const own = ++generation.current,
      controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      const selected = await api(
          "site-command",
          { action: "state", address },
          controller.signal,
        ),
        history = await api(
          "site-command",
          { action: "history", address },
          controller.signal,
        );
      if (own !== generation.current) return;
      setState(selected);
      setRevisions(
        [...history.revisions].sort(
          (a: StoredRevision, b: StoredRevision) =>
            b.revision.body.number - a.revision.body.number ||
            a.revision.id.localeCompare(b.revision.id),
        ),
      );
    } catch (e) {
      if (own === generation.current) setError((e as Error).message);
    } finally {
      if (own === generation.current) setWorking(false);
    }
  }
  async function read(revisionId: string, recover = false) {
    const own = ++generation.current,
      controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      const result = await api(
        "site-command",
        { action: "resolve", address, revisionId },
        controller.signal,
      );
      if (own !== generation.current) return;
      if (result.status !== "available") {
        setFeedback(
          result.status === "pending"
            ? "Esta versão ainda não está disponível. Foi pedida aos pares ligados."
            : "Esta versão já não consta do histórico local. Actualiza a lista.",
        );
        return;
      }
      if (recover && onRecover) {
        const recovered = await onRecover(result.object);
        if (recovered && own === generation.current)
          setFeedback(
            "Versão aberta como rascunho. Publicar cria uma nova versão assinada.",
          );
      } else onView(result.object);
    } catch (e) {
      if (own === generation.current) setError((e as Error).message);
    } finally {
      if (own === generation.current) setWorking(false);
    }
  }
  async function copy() {
    const own = generation.current;
    setError("");
    setFeedback("");
    try {
      await navigator.clipboard.writeText(address);
      if (own === generation.current) setFeedback("Endereço do site copiado");
    } catch {
      if (own === generation.current)
        setError("Não foi possível copiar. Selecciona o endereço e copia-o.");
    }
  }
  return (
    <section
      className="site-version-panel"
      aria-label={t("Endereço e histórico do site")}
    >
      <div className="site-version-address">
        <div className="site-version-mark" aria-hidden="true">
          <History size={21} />
        </div>
        <label>
          {t("O endereço permanece. O teu site evolui.")}
          <input
            aria-label={t("Endereço permanente do site")}
            readOnly
            value={address}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        <button type="button" className="secondary" onClick={() => void copy()}>
          <Copy size={16} />
          {t("Copiar endereço")}
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) void load();
          }}
        >
          <History size={16} />
          {t("Ver histórico")}
        </button>
      </div>
      {open && (
        <div className="site-version-history" aria-busy={working}>
          <div className="site-version-heading">
            <div>
              <h3>{t("Publicações deste site")}</h3>
              <p>
                {state?.status === "conflict"
                  ? t(
                      "Há versões concorrentes. Escolhe explicitamente o que queres conservar.",
                    )
                  : state?.number
                    ? t("Versão {number} conhecida neste dispositivo", {
                        number: state.number,
                      })
                    : t("Ainda não há versões assinadas para este endereço.")}
              </p>
            </div>
            <button
              type="button"
              className="icon"
              aria-label={t("Actualizar histórico do site")}
              disabled={working}
              onClick={() => void load()}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <ol className="site-version-list">
            {revisions.map(({ revision }) => (
              <li key={revision.id}>
                <div className="site-version-number">
                  {revision.body.number}
                </div>
                <div className="site-version-description">
                  <strong>
                    {t("Versão {number}", { number: revision.body.number })}
                  </strong>
                  <span>
                    {state?.heads.some((h) => h.id === revision.id)
                      ? t("Versão actual observada")
                      : t("Versão anterior")}
                  </span>
                  <code title={revision.id}>{revision.id.slice(0, 16)}</code>
                </div>
                <div className="site-version-actions">
                  <button
                    type="button"
                    className="secondary"
                    aria-label={t("Ver versão {number}: {id}", {
                      number: revision.body.number,
                      id: revision.id.slice(0, 8),
                    })}
                    disabled={working}
                    onClick={() => void read(revision.id)}
                  >
                    <Eye size={16} />
                    {t("Ver versão")}
                  </button>
                  {onRecover && (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={t("Recuperar versão {number}: {id}", {
                        number: revision.body.number,
                        id: revision.id.slice(0, 8),
                      })}
                      disabled={working}
                      onClick={() => void read(revision.id, true)}
                    >
                      <RotateCcw size={16} />
                      {t("Usar como rascunho")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="site-version-note">
            {t(
              "O histórico depende dos pares e das cópias guardadas. Ver uma página não dá permissão para alterar o original.",
            )}
          </p>
        </div>
      )}
      {working && (
        <p className="site-version-feedback" role="status">
          {t("A verificar versões e disponibilidade…")}
        </p>
      )}
      {feedback && (
        <p className="site-version-feedback" role="status">
          <Check size={16} />
          {t(feedback)}
        </p>
      )}
      {error && (
        <p className="site-version-feedback error" role="alert">
          {t(error)}
        </p>
      )}
    </section>
  );
}
