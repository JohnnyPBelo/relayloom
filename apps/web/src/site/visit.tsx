import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import type { PublicIdentity } from "../../../../packages/core/src/protocol";
import type { DisplayObject } from "../../../../packages/content/src/types";
import {
  siteAddress,
  type SiteRevision,
} from "../../../../packages/sites/src/protocol";
import { api } from "../api";
import { t } from "../i18n/core";
import { SiteReader } from "./renderer";
import { SiteHistory } from "./history";
export interface SiteVisitTarget {
  author: PublicIdentity;
  name?: string;
  revisionId?: string;
  legacyId?: string;
}
/** Stable addresses resolve known heads. Explicit historical choices remain
 * fixed; a missing head never silently opens an older cached publication. */
export function SiteVisit({
  target,
  legacy,
  posts,
  knownVersions,
}: {
  target: SiteVisitTarget;
  legacy: DisplayObject[];
  posts: DisplayObject[];
  knownVersions: string;
}) {
  const address = siteAddress(target.author.id, target.name ?? "profile");
  const [selected, setSelected] = useState<DisplayObject>(),
    [status, setStatus] = useState("loading"),
    [error, setError] = useState(""),
    [catalogBase, setCatalogBase] = useState("");
  const generation = useRef(0),
    following = useRef(!target.revisionId && !target.legacyId),
    observedVersions = useRef(knownVersions),
    request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    following.current = !target.revisionId && !target.legacyId;
    void load(target.revisionId, target.legacyId);
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [address, target.revisionId, target.legacyId]);
  useEffect(() => {
    if (observedVersions.current !== knownVersions) {
      observedVersions.current = knownVersions;
      if (following.current) void load();
    }
  }, [knownVersions]);
  async function load(revisionId?: string, legacyId?: string) {
    const own = ++generation.current,
      controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setSelected(undefined);
    setStatus("loading");
    setError("");
    try {
      if (legacyId) {
        const object = await api("view", { id: legacyId }, controller.signal);
        if (own !== generation.current) return;
        if (object.kind !== "site" || object.author.id !== target.author.id)
          throw Error("Página de outro autor recusada");
        setSelected(object);
        setStatus("available");
        return;
      }
      const result = await api(
        "site-command",
        { action: "resolve", address, ...(revisionId ? { revisionId } : {}) },
        controller.signal,
      );
      if (own !== generation.current) return;
      setCatalogBase(result.state.base);
      if (result.status === "available") {
        setSelected(result.object);
        setStatus("available");
        return;
      }
      if (
        !revisionId &&
        result.state.number === 0 &&
        result.state.heads.length === 0
      ) {
        const candidate = [...legacy]
          .filter(
            (o) => o.author.id === target.author.id && !o.content.siteRevision,
          )
          .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id))[0];
        if (candidate) {
          const object = await api(
            "view",
            { id: candidate.id },
            controller.signal,
          );
          if (own !== generation.current) return;
          if (object.kind !== "site" || object.author.id !== target.author.id)
            throw Error("Página de outro autor recusada");
          setSelected(object);
          setStatus("available");
          return;
        }
      }
      setStatus(result.status);
    } catch (e) {
      if (own === generation.current) {
        setError((e as Error).message);
        setStatus("error");
      }
    }
  }
  async function choose(object: DisplayObject) {
    const revision = object.content.siteRevision as SiteRevision | undefined;
    if (!revision || object.author.id !== target.author.id) return;
    following.current = false;
    await load(revision.id);
  }
  const revision = selected?.content.siteRevision as SiteRevision | undefined;
  return (
    <div className="site-visit">
      <SiteHistory
        address={address}
        onView={(object) => void choose(object)}
        refreshKey={catalogBase}
      />
      <div className="site-visit-state">
        <span>
          {revision
            ? t("A ler a versão {number}", { number: revision.body.number })
            : selected
              ? t("Página guardada anterior ao histórico de versões")
              : t("A abrir o site…")}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={status === "loading"}
          onClick={() => {
            following.current = true;
            void load();
          }}
        >
          <RefreshCw size={16} />
          {t("Ver versão actual")}
        </button>
      </div>
      {status === "loading" && (
        <p role="status">{t("A verificar e abrir o site…")}</p>
      )}
      {status === "conflict" && (
        <p role="status">
          {t(
            "Este site tem versões concorrentes. Abre o histórico e escolhe a versão que queres ler.",
          )}
        </p>
      )}
      {["pending", "unknown-revision"].includes(status) && (
        <p role="status">
          {t(
            "A página ainda não está disponível neste dispositivo. Mantém uma ligação a um par que tenha uma cópia.",
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {selected &&
        (selected.content.site ? (
          <SiteReader
            key={selected.id}
            contentId={selected.id}
            site={selected.content.site}
            theme={selected.content.theme ?? "sand"}
            assets={selected.content.attachments ?? []}
            posts={posts}
          />
        ) : (
          <div className={"site-canvas " + selected.content.theme}>
            <div className="site-masthead">
              <strong>{selected.author.name}</strong>
              <ShieldCheck size={18} />
            </div>
            {selected.content.blocks?.map((b) => (
              <section className={"site-block " + b.type} key={b.id}>
                <h2>{b.title}</h2>
                <p>{b.body}</p>
                {b.url && /^https:\/\//.test(b.url) && (
                  <a href={b.url} target="_blank" rel="noopener noreferrer">
                    {t("Explorar")}
                    <ArrowUpRight size={16} />
                  </a>
                )}
              </section>
            ))}
          </div>
        ))}
      <p className="small-note">
        {t(
          "As páginas são verificadas antes de abrir. Os leitores autorizados podem servir cópias sem adquirir autoria.",
        )}
      </p>
    </div>
  );
}
