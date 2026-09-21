import { bindSiteForm, parseSiteForm, type SiteForm } from "./site-form";
import {
  parseSiteResourceReference,
  type SiteResourceReference,
} from "./site-resource";
import { safeSiteUrl } from "./site-url";
export { safeSiteUrl } from "./site-url";
import { parseSiteTable, type SiteTable } from "./site-data";
import { canonical, exactShape as strictShape } from "../../core/src/protocol";
import type { Attachment, SiteBlock } from "./types";

export const SITE_LIMITS = Object.freeze({
  pages: 12,
  blocks: 128,
  siblings: 24,
  depth: 3,
  bytes: 128 * 1024,
  assets: 4,
  resources: 32,
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
  "table",
  "resource",
  "form",
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
  data?: SiteTable;
  reference?: SiteResourceReference;
  form?: SiteForm;
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
  version: 1 | 2 | 3 | 4;
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
    ![1, 2, 3, 4].includes(s.version) ||
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
    nodes = new Set<string>(),
    resources = new Map<string, string>(),
    located = new Map<string, { pageId: string; node: SiteNode }>(),
    forms: SiteForm[] = [];
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
  function visit(blocks: SiteNode[], depth: number, pageId: string) {
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
          [
            "url",
            "format",
            "children",
            "media",
            "style",
            "limit",
            "data",
            "reference",
            "form",
          ],
        ) ||
        !id(b.id) ||
        nodes.has(b.id) ||
        !SITE_BLOCKS.includes(b.type) ||
        !text(b.title, 120) ||
        !text(b.body, 4000)
      )
        fail("bloco ou identificador repetido");
      if (b.type === "table") {
        if (s.version < 2 || !Object.hasOwn(b, "data"))
          fail("tabela exige documento versão 2");
        parseSiteTable(b.data);
      } else if (Object.hasOwn(b, "data"))
        fail("dados num bloco que não é tabela");
      if (b.type === "resource") {
        if (
          s.version < 3 ||
          !Object.hasOwn(b, "reference") ||
          Object.hasOwn(b, "url")
        )
          fail("recurso exige documento versão 3 e uma referência");
        const ref = parseSiteResourceReference(b.reference),
          encoded = canonical(ref);
        if (
          resources.has(ref.bundleId) &&
          resources.get(ref.bundleId) !== encoded
        )
          fail("referências divergentes para o mesmo recurso");
        resources.set(ref.bundleId, encoded);
        if (resources.size > SITE_LIMITS.resources) fail("demasiados recursos");
      } else if (Object.hasOwn(b, "reference"))
        fail("referência num bloco que não é recurso");
      if (b.type === "form") {
        if (
          s.version !== 4 ||
          !Object.hasOwn(b, "form") ||
          Object.hasOwn(b, "url")
        )
          fail("formulário exige documento versão 4 e um esquema local");
        forms.push(parseSiteForm(b.form));
      } else if (Object.hasOwn(b, "form"))
        fail("esquema num bloco que não é formulário");
      located.set(b.id, { pageId, node: b });
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
        visit(b.children, depth + 1, pageId);
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
  for (const p of s.pages) visit(p.blocks, 1, p.id);
  for (const form of forms) {
    const destination = located.get(form.table.blockId);
    if (
      !destination ||
      destination.pageId !== form.table.pageId ||
      destination.node.type !== "table"
    )
      fail("tabela do formulário inexistente neste documento");
    bindSiteForm(form, destination!.node.data);
  }
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

/** Call after validating the document and its enclosing snapshot. Descriptors
 * remain untrusted until the runtime authenticates and matches the resource. */
export function siteResourceBlocks(
  site: SiteDocument,
): { pageId: string; blockId: string; reference: SiteResourceReference }[] {
  const result: {
    pageId: string;
    blockId: string;
    reference: SiteResourceReference;
  }[] = [];
  function visit(nodes: SiteNode[], pageId: string) {
    for (const node of nodes) {
      if (node.type === "resource")
        result.push({
          pageId,
          blockId: node.id,
          reference: parseSiteResourceReference(node.reference),
        });
      if (node.children) visit(node.children, pageId);
    }
  }
  for (const page of site.pages) visit(page.blocks, page.id);
  return result;
}

/** Resolve only inside an already authenticated and validated document. Callers
 * must never replace these schemas with fields supplied by the UI command. */
export function siteFormBlocks(site: SiteDocument) {
  const nodes: { pageId: string; node: SiteNode }[] = [];
  function visit(blocks: SiteNode[], pageId: string) {
    for (const node of blocks) {
      nodes.push({ pageId, node });
      if (node.children) visit(node.children, pageId);
    }
  }
  for (const page of site.pages) visit(page.blocks, page.id);
  return nodes
    .filter((entry) => entry.node.type === "form")
    .map((entry) => {
      const form = parseSiteForm(entry.node.form);
      const destination = nodes.find(
        (value) =>
          value.pageId === form.table.pageId &&
          value.node.id === form.table.blockId,
      );
      if (!destination || destination.node.type !== "table")
        throw Error("Tabela do formulário inexistente");
      return {
        pageId: entry.pageId,
        blockId: entry.node.id,
        ...bindSiteForm(form, destination.node.data),
      };
    });
}
