import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Check,
  GitBranch,
  Globe2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { PublicIdentity } from "../../../../packages/core/src/protocol";
import type { DisplayObject } from "../../../../packages/content/src/types";
import type { SiteRevision } from "../../../../packages/sites/src/protocol";
import { api } from "../api";
import { t } from "../i18n/core";
import { SiteStudio } from "./studio";
import { SiteReader } from "./renderer";
import { SiteHistory } from "./history";
import {
  SitePublisher,
  pendingCannotBeAdmitted,
  type PublishingSession,
} from "./publishing";
import type { StudioValue } from "./model";

function ReviewDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon"
          aria-label={t("Fechar")}
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SiteEditor({
  value,
  onChange,
  owner,
  ownerId,
  posts,
  contacts,
  blocked,
  busy,
  session,
  onSession,
  isActive,
  onView,
  onSaved,
  knownVersions,
}: {
  value: StudioValue;
  onChange: (v: StudioValue) => void;
  owner: string;
  ownerId: string;
  posts: DisplayObject[];
  contacts: PublicIdentity[];
  blocked: string[];
  busy: boolean;
  session: PublishingSession;
  onSession: (s: PublishingSession) => void;
  isActive: () => boolean;
  onView: (o: DisplayObject) => void;
  onSaved: () => Promise<void>;
  knownVersions: string;
}) {
  const publisher = useMemo(
    () => new SitePublisher(api, ownerId, session, isActive, onSession),
    [ownerId],
  );
  const state = useSyncExternalStore(
    publisher.subscribe,
    publisher.snapshot,
    publisher.snapshot,
  );
  const [confirmed, setConfirmed] = useState(""),
    [optionsOpen, setOptionsOpen] = useState(false),
    [reviewVerified, setReviewVerified] = useState(false),
    [studioKey, setStudioKey] = useState(0),
    [localError, setLocalError] = useState("");
  const [review, setReview] = useState<{
    base: string;
    number: number;
    heads: SiteRevision[];
    object?: DisplayObject;
  }>();
  const recovering = useRef<((ok: boolean) => void) | undefined>(undefined);
  useEffect(() => {
    void publisher.sync().catch(() => {});
    return () => {
      publisher.close();
      recovering.current?.(false);
    };
  }, [publisher]);
  useEffect(() => {
    if (!state.busy) publisher.observe();
  }, [publisher, knownVersions, state.busy]);
  const pending = state.editing?.pending,
    frozen = busy || state.busy || !!pending;
  const headKey = state.catalog.heads
      .map((h) => h.id)
      .sort()
      .join(":"),
    conflict = state.catalog.status === "conflict",
    approved = conflict && confirmed === headKey;
  const stale =
    !state.editing ||
    state.editing.base !== state.catalog.base ||
    state.editing.sequence !== state.catalog.nextSequence;
  const canPublish =
    !frozen &&
    !stale &&
    (!conflict || approved) &&
    state.catalog.pending.length === 0;
  const doAction = (fn: () => Promise<unknown>) => {
    setLocalError("");
    void fn().catch(() => {});
  };
  const configure = (recipients: "public" | string[], ttlMs: number) => {
    setLocalError("");
    try {
      publisher.configure(recipients, ttlMs);
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };
  const closeReview = () => {
    if (state.busy) return;
    setReview(undefined);
    recovering.current?.(false);
    recovering.current = undefined;
  };
  async function reviewBase() {
    await publisher.sync();
    const s = publisher.snapshot();
    setReview({
      base: s.catalog.base,
      number: s.catalog.number,
      heads: s.catalog.heads,
    });
  }
  async function recover(object: DisplayObject): Promise<boolean> {
    setReviewVerified(false);
    await publisher.sync();
    const s = publisher.snapshot();
    setReview({
      base: s.catalog.base,
      number: s.catalog.number,
      heads: s.catalog.heads,
      object,
    });
    return new Promise((resolve) => {
      recovering.current = resolve;
    });
  }
  async function acceptReview() {
    if (!review) return;
    if (review.object && !reviewVerified) return;
    if (review.object) {
      const replacement = await publisher.recoveryValue(
        review.object,
        review.base,
      );
      onChange(replacement);
      setStudioKey((n) => n + 1);
    } else await publisher.adopt(value, review.base);
    await onSaved();
    setReview(undefined);
    recovering.current?.(true);
    recovering.current = undefined;
    setConfirmed("");
  }
  const operation = state.operation;
  const retained = !pending ? state.catalog.pending[0] : undefined;
  const audience = !state.editing
    ? t("Privacidade por escolher")
    : state.editing.recipients === "public"
      ? t("Público")
      : state.editing.recipients.length === 0
        ? t("Só tu")
        : t("Privado · {count} leitores", {
            count: state.editing.recipients.length + 1,
          });
  const retired =
    state.editing && pendingCannotBeAdmitted(state.editing, state.catalog);
  const header = (
    <>
      <SiteHistory
        address={state.editing?.address ?? `relayloom:site:${ownerId}/profile`}
        onView={onView}
        onRecover={frozen ? undefined : recover}
        refreshKey={state.catalog.base}
      />
      <section
        className="site-publication card"
        aria-label={t("Publicação e privacidade do site")}
      >
        <div className="site-publication-heading">
          <div>
            <span className="eyebrow">{t("PUBLICAÇÃO ASSINADA")}</span>
            <h3>
              {pending
                ? t("Publicação por concluir")
                : stale
                  ? t("Revê a versão de partida")
                  : t("O teu rascunho, a tua assinatura")}
            </h3>
            <p className="muted">
              {pending
                ? t(
                    "Conservámos o pedido original. Verifica o resultado antes de editar ou tentar outra publicação.",
                  )
                : stale
                  ? t(
                      "Este rascunho não está ligado à versão actual. Compara o histórico antes de publicar.",
                    )
                  : t(
                      "Guardar é privado. Publicar cria uma versão assinada para os leitores que escolheres.",
                    )}
            </p>
          </div>
          <div className="site-publication-tools">
            {state.catalog.number > 0 && (
              <span className="muted">
                {t("Versão {number} conhecida", {
                  number: state.catalog.number,
                })}
              </span>
            )}
            <button
              type="button"
              className="secondary"
              aria-expanded={optionsOpen}
              aria-label={t("Opções de publicação: {audience}", { audience })}
              onClick={() => setOptionsOpen((v) => !v)}
            >
              {state.editing?.recipients === "public" ? (
                <Globe2 size={17} />
              ) : (
                <LockKeyhole size={17} />
              )}{" "}
              {audience}
            </button>
            <button
              type="button"
              className="icon"
              aria-label={t("Verificar estado da publicação")}
              disabled={state.busy || busy}
              onClick={() => doAction(() => publisher.sync())}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </div>
        {optionsOpen && (
          <fieldset
            className="site-publication-options"
            disabled={frozen || !state.editing}
          >
            <label>
              {t("Quem pode ler o site")}
              <select
                aria-label={t("Quem pode ler o site")}
                value={
                  !state.editing
                    ? "unknown"
                    : state.editing.recipients === "public"
                      ? "public"
                      : "private"
                }
                onChange={(e) =>
                  configure(
                    e.target.value === "public" ? "public" : [],
                    state.editing!.ttlMs,
                  )
                }
              >
                {!state.editing && (
                  <option value="unknown">
                    {t("Privacidade por escolher")}
                  </option>
                )}
                <option value="public">
                  {t("Público — qualquer pessoa com uma cópia")}
                </option>
                <option value="private">
                  {t("Privado — leitores escolhidos")}
                </option>
              </select>
            </label>
            <label>
              {t("Prazo desta publicação")}
              <select
                aria-label={t("Prazo desta publicação")}
                value={state.editing?.ttlMs ?? 30 * 86400_000}
                onChange={(e) =>
                  configure(state.editing!.recipients, Number(e.target.value))
                }
              >
                {[
                  [3600_000, "Uma hora"],
                  [86400_000, "Um dia"],
                  [7 * 86400_000, "Uma semana"],
                  [30 * 86400_000, "30 dias"],
                  [365 * 86400_000, "Um ano"],
                ].map(([n, label]) => (
                  <option key={n} value={n}>
                    {t(String(label))}
                  </option>
                ))}
                {state.editing &&
                  ![
                    3600_000,
                    86400_000,
                    7 * 86400_000,
                    30 * 86400_000,
                    365 * 86400_000,
                  ].includes(state.editing.ttlMs) && (
                    <option value={state.editing.ttlMs}>
                      {t("Prazo personalizado")}
                    </option>
                  )}
              </select>
            </label>
            {state.editing && state.editing.recipients !== "public" && (
              <div
                className="site-publication-readers"
                role="group"
                aria-label={t("Leitores privados do site")}
              >
                <p>
                  <LockKeyhole size={16} />
                  {t(
                    "Tu podes sempre ler e assinar. Os restantes leitores podem ler e partilhar a cópia, sem editar o original.",
                  )}
                </p>
                {contacts.map((card) => {
                  const ids = state.editing!.recipients as string[],
                    selected = ids.includes(card.id);
                  return (
                    <label key={card.id} className="site-reader">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={blocked.includes(card.id) && !selected}
                        onChange={(e) =>
                          configure(
                            e.target.checked
                              ? [...ids, card.id].sort()
                              : ids.filter((id) => id !== card.id),
                            state.editing!.ttlMs,
                          )
                        }
                      />
                      <span>
                        {card.name}
                        {blocked.includes(card.id)
                          ? " · " + t("Bloqueado")
                          : ""}
                      </span>
                    </label>
                  );
                })}
                {(state.editing.recipients as string[])
                  .filter((id) => !contacts.some((c) => c.id === id))
                  .map((id) => (
                    <label key={id} className="site-reader">
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          configure(
                            (state.editing!.recipients as string[]).filter(
                              (r) => r !== id,
                            ),
                            state.editing!.ttlMs,
                          )
                        }
                      />
                      <span>
                        {t("Contacto indisponível")}: {id.slice(0, 12)}
                      </span>
                    </label>
                  ))}
              </div>
            )}
            <p className="site-publication-expiry muted">
              {t(
                "O prazo limita a circulação desta publicação. Não apaga cópias que outros leitores tenham conservado.",
              )}
            </p>
          </fieldset>
        )}
        {conflict && !pending && (
          <div className="site-publication-conflict">
            <GitBranch size={20} />
            <div>
              <strong>
                {t("Há {count} versões concorrentes", {
                  count: state.catalog.heads.length,
                })}
              </strong>
              <p>
                {t(
                  "A tua próxima publicação vai indicar explicitamente quais as versões que substitui.",
                )}
              </p>
              <ul>
                {state.catalog.heads.map((h) => (
                  <li key={h.id}>
                    {t("Versão {number}", { number: h.body.number })} ·{" "}
                    <code>{h.id.slice(0, 16)}</code>
                  </li>
                ))}
              </ul>
              <label className="site-reader">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={frozen}
                  onChange={(e) =>
                    setConfirmed(e.target.checked ? headKey : "")
                  }
                />
                {t(
                  "Confirmo que este rascunho resolve todas as versões indicadas",
                )}
              </label>
            </div>
          </div>
        )}
        <div className="site-publication-actions">
          {retained && (
            <>
              <p>
                {t(
                  "Existe uma publicação anterior por concluir. O rascunho actual será mantido.",
                )}
              </p>
              {(retained.phase === "committed" || retained.requested) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={state.busy || busy}
                  onClick={() =>
                    doAction(() => publisher.settleRetained("resume"))
                  }
                >
                  {t("Retomar publicação anterior")}
                </button>
              )}
              {retained.phase === "prepared" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={state.busy || busy}
                  onClick={() =>
                    doAction(() => publisher.settleRetained("cancel"))
                  }
                >
                  {t("Cancelar preparação anterior")}
                </button>
              )}
            </>
          )}
          {!pending && stale && (
            <button
              type="button"
              className="secondary"
              disabled={state.busy || busy}
              onClick={() => doAction(reviewBase)}
              data-site-followup
            >
              <GitBranch size={17} />
              {t("Comparar versões")}
            </button>
          )}
          {pending && (
            <button
              type="button"
              className="primary"
              disabled={state.busy || busy}
              onClick={() =>
                doAction(async () => {
                  await publisher.publish(value);
                  await onSaved();
                })
              }
              data-site-followup
            >
              <RefreshCw size={17} />
              {t("Verificar e retomar publicação")}
            </button>
          )}
          {pending && operation?.phase === "prepared" && (
            <button
              type="button"
              className="secondary"
              disabled={state.busy || busy}
              onClick={() =>
                doAction(() => publisher.clearTerminal(value, true))
              }
            >
              {t("Cancelar preparação")}
            </button>
          )}
          {pending &&
            ((operation &&
              ["expired", "cancelled", "superseded"].includes(
                operation.phase,
              )) ||
              (!operation && retired)) && (
              <button
                type="button"
                className="secondary"
                disabled={state.busy || busy}
                onClick={() => doAction(() => publisher.clearTerminal(value))}
              >
                {t("Encerrar esta tentativa")}
              </button>
            )}
        </div>
        {state.busy && (
          <p role="status" aria-label={t("Estado da publicação do site")}>
            {t("A verificar e guardar o estado do site…")}
          </p>
        )}
        {state.message && (
          <p role="status" aria-label={t("Estado da publicação do site")}>
            <Check size={16} />
            {t(state.message)}
          </p>
        )}
        {(state.error || localError) && (
          <p className="error" role="alert">
            {t(localError || state.error)}
          </p>
        )}
      </section>
    </>
  );
  return (
    <>
      <SiteStudio
        key={studioKey}
        value={value}
        onChange={(v) => {
          if (!frozen) onChange(v);
        }}
        owner={owner}
        posts={posts}
        busy={frozen}
        header={header}
        managedFeedback
        onActionError={(error) => publisher.report(error)}
        publishDisabled={!canPublish}
        onSave={async (v) => {
          await publisher.save(v);
          await onSaved();
        }}
        onPublish={async (v) => {
          await publisher.publish(
            v,
            approved ? state.catalog.heads.map((h) => h.id).sort() : undefined,
          );
          await onSaved();
        }}
      />
      {review && (
        <ReviewDialog
          title={
            review.object
              ? t("Recuperar uma versão anterior")
              : t("Escolher a versão de partida")
          }
          close={closeReview}
        >
          <p>
            {review.object
              ? t(
                  "O rascunho actual será substituído por esta versão. Nada é publicado até voltares a escolher Publicar página.",
                )
              : t(
                  "O conteúdo do rascunho será mantido. A próxima publicação continuará a partir das versões indicadas.",
                )}
          </p>
          {review.object && (
            <div className="card">
              <strong>{review.object.content.site?.title}</strong>
              <p>
                {review.object.public
                  ? t("Esta versão é pública")
                  : t(
                      "Esta versão é privada. Os leitores originais serão conservados no rascunho.",
                    )}
              </p>
              <p>{review.object.content.site?.description}</p>
              <ul>
                {review.object.content.site?.pages.map((p) => (
                  <li key={p.id}>{p.title}</li>
                ))}
              </ul>
              {review.object.content.site && (
                <div
                  className="site-recovery-preview"
                  tabIndex={0}
                  aria-label={t("Pré-visualização da versão escolhida")}
                >
                  <SiteReader
                    key={review.object.id}
                    contentId={review.object.id}
                    site={review.object.content.site}
                    theme={review.object.content.theme ?? "sand"}
                    assets={review.object.content.attachments ?? []}
                    posts={posts}
                    onReady={(object) =>
                      setReviewVerified(object?.id === review.object?.id)
                    }
                  />
                </div>
              )}
            </div>
          )}
          <p>
            {t("Versão {number} conhecida neste dispositivo", {
              number: review.number,
            })}
          </p>
          <ul>
            {review.heads.map((h) => (
              <li key={h.id}>
                <code>{h.id.slice(0, 16)}</code>
              </li>
            ))}
          </ul>
          {state.error && (
            <p role="alert" className="error">
              {t(state.error)}
            </p>
          )}
          <div className="site-publication-actions">
            <button
              type="button"
              className="secondary"
              disabled={state.busy}
              onClick={closeReview}
            >
              {t("Voltar ao rascunho")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={state.busy || (!!review.object && !reviewVerified)}
              onClick={() => doAction(acceptReview)}
            >
              <ShieldCheck size={17} />
              {review.object
                ? t("Substituir rascunho por esta versão")
                : t("Manter o rascunho e continuar")}
            </button>
          </div>
        </ReviewDialog>
      )}
    </>
  );
}
