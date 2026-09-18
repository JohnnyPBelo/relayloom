import { SiteTableView } from "./table";
import { t, getLanguage } from "../i18n/core";
import { api } from "../api";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import { ArrowUpRight, Image as ImageIcon } from "lucide-react";
import {
  safeSiteUrl,
  validateSite,
  type SiteDocument,
  type SiteNode,
} from "../../../../packages/content/src/site";
import type {
  Attachment,
  DisplayObject,
} from "../../../../packages/content/src/types";
import "./studio.css";
// Share decoded bytes while the same attachment is displayed more than once.
// The last mounted consumer releases the URL; no global content cache survives it.
const mediaURLs = new WeakMap<Attachment, { url: string; readers: number }>();
function acquireMedia(asset: Attachment) {
  let entry = mediaURLs.get(asset);
  if (!entry) {
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(asset.mime) ||
      asset.data.length > 2800000
    )
      throw new Error("Imagem não suportada");
    const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
    entry = {
      url: URL.createObjectURL(new Blob([bytes], { type: asset.mime })),
      readers: 0,
    };
    mediaURLs.set(asset, entry);
  }
  entry.readers++;
  return {
    url: entry.url,
    release() {
      if (--entry.readers === 0) {
        URL.revokeObjectURL(entry.url);
        mediaURLs.delete(asset);
      }
    },
  };
}
export function SiteBody({ node }: { node: SiteNode }) {
  return node.format === "markdown" ? (
    <div className="studio-markdown">
      <Markdown
        skipHtml
        allowedElements={[
          "p",
          "strong",
          "em",
          "del",
          "a",
          "ul",
          "ol",
          "li",
          "blockquote",
          "pre",
          "code",
          "h2",
          "h3",
          "h4",
          "br",
          "hr",
        ]}
        urlTransform={(url) => (safeSiteUrl(url) ? url : "")}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {node.body}
      </Markdown>
    </div>
  ) : (
    <p className="studio-prose">{node.body}</p>
  );
}
function Media({
  entry,
  asset,
  load,
}: {
  entry: { attachment: number; alt: string };
  asset?: Attachment;
  load?: (index: number) => Promise<Attachment>;
}) {
  const [url, setURL] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      release: (() => void) | undefined;
    setURL("");
    setError("");
    void (async () => {
      if (!asset) return;
      const a = asset.data ? asset : await load?.(entry.attachment);
      if (!a) return;
      if (!alive) return;
      const media = acquireMedia(a);
      release = media.release;
      setURL(media.url);
    })().catch(() => {
      if (alive) setError("Não foi possível abrir esta imagem.");
    });
    return () => {
      alive = false;
      release?.();
    };
  }, [asset, entry.attachment, load]);
  return url && !error ? (
    <img
      src={url}
      alt={entry.alt}
      loading="lazy"
      decoding="async"
      onError={() => setError("Não foi possível abrir esta imagem.")}
    />
  ) : (
    <div className="studio-media-placeholder">
      <ImageIcon aria-hidden="true" />
      <span>{error ? t(error) : t("Imagem guardada no site")}</span>
    </div>
  );
}
export function SiteNodeView({
  node,
  assets,
  load,
  posts = [],
  onNavigate,
}: {
  node: SiteNode;
  assets: Attachment[];
  load?: (index: number) => Promise<Attachment>;
  posts?: DisplayObject[];
  onNavigate: (id: string) => void;
}) {
  const link = (label: ReactNode) =>
    node.url?.startsWith("page:") ? (
      <button
        className="studio-site-link"
        onClick={() => onNavigate(node.url!.slice(5))}
      >
        {label}
        <ArrowUpRight size={16} />
      </button>
    ) : node.url && safeSiteUrl(node.url) ? (
      <a
        className="studio-site-link"
        href={node.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
        <ArrowUpRight size={16} />
      </a>
    ) : null;
  if (node.type === "table")
    return (
      <>
        {node.body && <SiteBody node={node} />}
        <SiteTableView data={node.data} title={node.title} />
      </>
    );
  if (node.type === "divider") return <hr className="studio-divider" />;
  if (node.type === "spacer")
    return <div className="studio-spacer" aria-hidden="true" />;
  return (
    <>
      {node.title &&
        (node.type === "hero" ? <h1>{node.title}</h1> : <h2>{node.title}</h2>)}
      {node.type === "quote" ? (
        <blockquote>
          <SiteBody node={node} />
        </blockquote>
      ) : (
        node.body && <SiteBody node={node} />
      )}
      {node.type === "columns" && (
        <div
          className="studio-columns"
          style={{ "--columns": node.style?.columns ?? 2 } as CSSProperties}
        >
          {node.children?.map((child) => (
            <section key={child.id} className={nodeClass(child)}>
              <SiteNodeView
                node={child}
                assets={assets}
                load={load}
                posts={posts}
                onNavigate={onNavigate}
              />
            </section>
          ))}
        </div>
      )}
      {["image", "gallery"].includes(node.type) &&
        (node.media?.length ? (
          <div
            className="studio-gallery"
            style={
              {
                "--columns":
                  node.type === "image" ? 1 : (node.style?.columns ?? 2),
              } as CSSProperties
            }
          >
            {node.media.map((entry, i) => (
              <figure key={i}>
                <Media
                  entry={entry}
                  asset={assets[entry.attachment]}
                  load={load}
                />
                {entry.alt && <figcaption>{entry.alt}</figcaption>}
              </figure>
            ))}
          </div>
        ) : (
          <div className="studio-media-placeholder">
            <ImageIcon aria-hidden="true" />
            <span>{t("Ainda sem imagens")}</span>
          </div>
        ))}
      {node.type === "posts" &&
        (posts.length ? (
          <div className="studio-posts">
            {posts.slice(0, node.limit ?? 6).map((post) => (
              <article key={post.id}>
                <small>
                  {new Date(post.created).toLocaleDateString(getLanguage())}
                </small>
                <h3>{post.content.title || post.author.name}</h3>
                <p>
                  {(post.editedText ?? post.content.text)?.slice(0, 600) ||
                    t("Publicação sem texto")}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="studio-note">
            {t(
              "As publicações deste autor disponíveis neste dispositivo aparecem aqui.",
            )}
          </p>
        ))}
      {node.url &&
        link(
          node.type === "button" ? node.title || t("Continuar") : t("Explorar"),
        )}
    </>
  );
}
export const nodeClass = (node: SiteNode) =>
  `site-block studio-node ${node.type} studio-align-${node.style?.align ?? "left"} studio-tone-${node.style?.tone ?? "surface"} studio-space-${node.style?.space ?? "normal"}`;
export function SiteSurface({
  site,
  theme,
  pageId,
  onNavigate,
  children,
}: {
  site: SiteDocument;
  theme: string;
  pageId: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`site-canvas studio-surface ${theme} studio-font-${site.design.font} studio-width-${site.design.width} studio-radius-${site.design.radius}`}
      style={{ "--site-accent": site.design.accent } as CSSProperties}
    >
      <header className="studio-masthead">
        <strong>{site.title}</strong>
        <nav aria-label={t("Páginas do site")}>
          {site.pages.map((page) => (
            <button
              key={page.id}
              aria-current={page.id === pageId ? "page" : undefined}
              onClick={() => onNavigate(page.id)}
            >
              {page.title}
            </button>
          ))}
        </nav>
      </header>
      {children}
      <footer className="studio-footer">
        <span>{site.description}</span>
        <span>{t("Feito com RelayLoom · guardado por pessoas")}</span>
      </footer>
    </div>
  );
}
export function SiteReader({
  site: suppliedSite,
  theme: suppliedTheme,
  assets: suppliedAssets,
  posts,
  contentId,
  onReady,
}: {
  site: SiteDocument;
  theme: string;
  assets: Attachment[];
  posts: DisplayObject[];
  contentId: string;
  onReady?: (object: DisplayObject | undefined) => void;
}) {
  const [verified, setVerified] = useState<DisplayObject>(),
    [readError, setReadError] = useState("");
  useEffect(() => {
    let active = true;
    setVerified(undefined);
    onReady?.(undefined);
    setReadError("");
    void api("view", { id: contentId })
      .then((value: DisplayObject) => {
        validateSite(value.content.site, value.content.attachments);
        if (active) {
          setVerified(value);
          onReady?.(value);
        }
      })
      .catch(() => {
        if (active)
          setReadError(
            "Não foi possível verificar e abrir este site no armazenamento local.",
          );
      });
    return () => {
      active = false;
    };
  }, [contentId]);
  const site = verified?.content.site ?? suppliedSite,
    theme = verified?.content.theme ?? suppliedTheme,
    assets = verified?.content.attachments ?? suppliedAssets;
  const jobs = useMemo(
    () => new Map<number, Promise<Attachment>>(),
    [contentId],
  );
  const load = useCallback(
    (index: number) => {
      let job = jobs.get(index);
      if (!job) {
        job = api("attachment", {
          id: contentId,
          index,
        }) as Promise<Attachment>;
        jobs.set(index, job);
        void job.catch(() => jobs.delete(index));
      }
      return job;
    },
    [contentId, jobs],
  );
  const [pageId, setPage] = useState(site.home);
  const page =
    site.pages.find((p) => p.id === pageId) ??
    site.pages.find((p) => p.id === site.home)!;
  if (readError)
    return (
      <p role="alert" className="error">
        {t(readError)}
      </p>
    );
  if (!verified) return <p role="status">{t("A verificar e abrir o site…")}</p>;
  return (
    <SiteSurface
      site={site}
      theme={theme}
      pageId={page.id}
      onNavigate={setPage}
    >
      {page.blocks.map((node) => (
        <section className={nodeClass(node)} key={node.id}>
          <SiteNodeView
            node={node}
            assets={assets}
            posts={posts}
            load={load}
            onNavigate={setPage}
          />
        </section>
      ))}
    </SiteSurface>
  );
}
