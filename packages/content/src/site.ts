import { canonical, exactShape as strictShape } from "../../core/src/protocol";
import type { Attachment, SiteBlock } from "./types";

export const SITE_LIMITS = Object.freeze({
  pages: 12,
  blocks: 128,
  siblings: 24,
  depth: 3,
  bytes: 128 * 1024,
  assets: 4,
});
export const SITE_BLOCKS = [
  "hero",
  "text",
  "links",
  "callout",
  "heading",
  "quote",
  "button",
  "image",
  "gallery",
  "divider",
  "spacer",
  "columns",
  "posts",
] as const;
export type SiteNodeType = (typeof SITE_BLOCKS)[number];
export type SiteNode = {
  id: string;
  type: SiteNodeType;
  title: string;
  body: string;
  url?: string;
  format?: "plain" | "markdown";
  children?: SiteNode[];
  media?: { attachment: number; alt: string }[];
  limit?: number;
  style?: {
    align?: "left" | "center" | "right";
    tone?: "surface" | "soft" | "accent";
    columns?: 1 | 2 | 3;
    space?: "compact" | "normal" | "large";
  };
};
export type SitePage = {
  id: string;
  slug: string;
  title: string;
  blocks: SiteNode[];
};
export type SiteDocument = {
  version: 1;
  title: string;
  description: string;
  home: string;
  pages: SitePage[];
  design: {
    font: "sans" | "serif" | "mono";
    width: "compact" | "standard" | "wide";
    radius: "sharp" | "soft" | "round";
    accent: string;
  };
};
export type SiteDraft = {
  editing?: import("../../sites/src/editing").SiteEditingContext;
  blocks: SiteBlock[];
  theme: string;
  site?: SiteDocument;
  attachments?: Attachment[];
  savedAt: number;
};
function exactShape(
  v: unknown,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    !!v &&
    typeof v === "object" &&
    strictShape(v, Object.keys(v)) &&
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k))
  );
}
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
export function safeSiteUrl(value: string): boolean {
  // One lexical policy in TS and Go; WHATWG URL and net/url disagree on
  // malformed escapes, whitespace and abbreviated/octal IPv4 addresses.
  const parts =
    /^https:\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#].*)?$/u.exec(value);
  if (
    !parts ||
    value.length > 2000 ||
    parts[1].length > 253 ||
    /[\p{White_Space}\uFEFF\\\u0000-\u001f\u007f]/u.test(value) ||
    /%(?![0-9a-f]{2})/i.test(value) ||
    Number(parts[2] ?? 443) > 65535
  )
    return false;
  const labels = parts[1].split(".");
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )
  )
    return false;
  if (/^(?:[0-9]+|0x[0-9a-f]*)$/i.test(labels.at(-1)!))
    return (
      labels.length === 4 &&
      labels.every(
        (label) =>
          /^(?:0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255,
      )
    );
  return true;
}
export function validateSite(
  value: unknown,
  attachments: Pick<Attachment, "mime" | "data">[] = [],
): asserts value is SiteDocument {
  const fail = (message: string): never => {
    throw new Error("Site inválido: " + message);
  };
  if (
    !exactShape(value, [
      "version",
      "title",
      "description",
      "home",
      "pages",
      "design",
    ])
  )
    fail("estrutura");
  const s = value as SiteDocument;
  if (
    !Array.isArray(attachments) ||
    attachments.length > 4 ||
    attachments.some(
      (a) =>
        !a ||
        typeof a.data !== "string" ||
        !/^image\/(png|jpeg|webp|gif)$/.test(a.mime) ||
        a.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data),
    ) ||
    attachments.reduce(
      (n, a) => n + Math.floor((a.data.replace(/=+$/, "").length * 6) / 8),
      0,
    ) >
      2 * 1024 * 1024
  )
    fail("imagens acima de 2 MB");
  if (
    s.version !== 1 ||
    !text(s.title, 120) ||
    !text(s.description, 500) ||
    !id(s.home) ||
    !Array.isArray(s.pages) ||
    !s.pages.length ||
    s.pages.length > SITE_LIMITS.pages
  )
    fail("páginas ou versão");
  if (
    !exactShape(s.design, ["font", "width", "radius", "accent"]) ||
    !["sans", "serif", "mono"].includes(s.design.font) ||
    !["compact", "standard", "wide"].includes(s.design.width) ||
    !["sharp", "soft", "round"].includes(s.design.radius) ||
    typeof s.design.accent !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(s.design.accent)
  )
    fail("estilo");
  const pages = new Set<string>(),
    slugs = new Set<string>(),
    nodes = new Set<string>();
  for (const p of s.pages) {
    if (
      !exactShape(p, ["id", "slug", "title", "blocks"]) ||
      !id(p.id) ||
      pages.has(p.id) ||
      !text(p.title, 80) ||
      !p.title.trim() ||
      typeof p.slug !== "string" ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(p.slug) ||
      slugs.has(p.slug)
    )
      fail("endereço ou nome de página");
    pages.add(p.id);
    slugs.add(p.slug);
  }
  if (!pages.has(s.home)) fail("página inicial inexistente");
  function visit(blocks: SiteNode[], depth: number) {
    if (
      (depth > SITE_LIMITS.depth &&
        Array.isArray(blocks) &&
        blocks.length > 0) ||
      !Array.isArray(blocks) ||
      blocks.length > SITE_LIMITS.siblings
    )
      fail("composição demasiado profunda ou extensa");
    for (const b of blocks) {
      if (
        !exactShape(
          b,
          ["id", "type", "title", "body"],
          ["url", "format", "children", "media", "style", "limit"],
        ) ||
        !id(b.id) ||
        nodes.has(b.id) ||
        !SITE_BLOCKS.includes(b.type) ||
        !text(b.title, 120) ||
        !text(b.body, 4000)
      )
        fail("bloco ou identificador repetido");
      nodes.add(b.id);
      if (nodes.size > SITE_LIMITS.blocks) fail("demasiados blocos");
      if (b.format !== undefined && !["plain", "markdown"].includes(b.format))
        fail("formatação");
      if (
        b.url !== undefined &&
        (typeof b.url !== "string" ||
          (b.url !== "" &&
            !(b.url.startsWith("page:")
              ? pages.has(b.url.slice(5))
              : safeSiteUrl(b.url))))
      )
        fail("ligação");
      if (b.style !== undefined) {
        if (!exactShape(b.style, [], ["align", "tone", "columns", "space"]))
          fail("estilo de bloco");
        const st = b.style;
        if (
          (st.align !== undefined &&
            !["left", "center", "right"].includes(st.align)) ||
          (st.tone !== undefined &&
            !["surface", "soft", "accent"].includes(st.tone)) ||
          (st.columns !== undefined && ![1, 2, 3].includes(st.columns)) ||
          (st.space !== undefined &&
            !["compact", "normal", "large"].includes(st.space))
        )
          fail("estilo de bloco");
      }
      if (b.children !== undefined) {
        if (b.type !== "columns") fail("filhos num bloco que não é composição");
        visit(b.children, depth + 1);
      }
      if (b.media !== undefined) {
        if (
          !["image", "gallery"].includes(b.type) ||
          !Array.isArray(b.media) ||
          b.media.length > (b.type === "image" ? 1 : 4)
        )
          fail("galeria");
        for (const m of b.media)
          if (
            !exactShape(m, ["attachment", "alt"]) ||
            !Number.isInteger(m.attachment) ||
            m.attachment < 0 ||
            m.attachment >= attachments.length ||
            !/^image\/(png|jpeg|webp|gif)$/.test(
              attachments[m.attachment].mime,
            ) ||
            !text(m.alt, 300)
          )
            fail("imagem não incluída ou não suportada");
      }
      if (
        b.limit !== undefined &&
        (b.type !== "posts" ||
          !Number.isInteger(b.limit) ||
          b.limit < 1 ||
          b.limit > 12)
      )
        fail("limite de publicações");
    }
  }
  for (const p of s.pages) visit(p.blocks, 1);
  if (new TextEncoder().encode(canonical(s)).length > SITE_LIMITS.bytes)
    fail("documento maior que 128 KiB");
}
export function legacySite(blocks: SiteBlock[], title: string): SiteDocument {
  return {
    version: 1,
    title,
    description: "Um lugar teu na rede.",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [
      {
        id: "home",
        slug: "inicio",
        title: "Início",
        blocks: blocks.map((b, i) => ({
          id: "block-" + i,
          type: b.type,
          title: b.title,
          body: b.body,
          ...(b.url && safeSiteUrl(b.url) ? { url: b.url } : {}),
        })),
      },
    ],
  };
}
/** Older clients retain a safe, readable home-page excerpt; only v1 site nodes are used here. */
export function siteFallback(site: SiteDocument): SiteBlock[] {
  const result: SiteBlock[] = [];
  function add(nodes: SiteNode[]) {
    for (const n of nodes) {
      if (result.length >= 24) return;
      if (n.title || n.body)
        result.push({
          id: n.id,
          type:
            n.type === "hero"
              ? "hero"
              : n.type === "callout"
                ? "callout"
                : n.url && safeSiteUrl(n.url)
                  ? "links"
                  : "text",
          title: n.title,
          body: n.body,
          ...(n.url && safeSiteUrl(n.url) ? { url: n.url } : {}),
        });
      if (n.children) add(n.children);
    }
  }
  add(site.pages.find((p) => p.id === site.home)!.blocks);
  return result;
}

export function draftSummary<T extends { attachments?: Attachment[] }>(
  draft: T | null | undefined,
): T | null {
  if (!draft) return null;
  return {
    ...draft,
    ...(draft.attachments
      ? {
          attachments: draft.attachments.map((a) => ({
            name: a.name,
            mime: a.mime,
            data: "",
            size: Math.floor((a.data.replace(/=+$/, "").length * 6) / 8),
          })),
        }
      : {}),
  };
}
