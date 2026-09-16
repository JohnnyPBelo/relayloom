import { t } from "../i18n/core";
import {
  legacySite,
  SITE_LIMITS,
  validateSite,
  type SiteDocument,
  type SiteNode,
  type SiteNodeType,
} from "../../../../packages/content/src/site";
import type { Attachment } from "../../../../packages/content/src/types";
export type StudioValue = {
  site: SiteDocument;
  theme: string;
  attachments: Attachment[];
};
export const labels: Record<SiteNodeType, string> = {
  hero: "Capa",
  text: "Texto",
  links: "Ligação",
  callout: "Destaque",
  heading: "Título",
  quote: "Citação",
  button: "Botão",
  image: "Imagem",
  gallery: "Galeria",
  divider: "Separador",
  spacer: "Espaço",
  columns: "Colunas",
  posts: "Publicações",
};
export function newBlock(type: SiteNodeType): SiteNode {
  return {
    id: crypto.randomUUID(),
    type,
    title: (
      {
        hero: t("Um lugar para as tuas ideias."),
        text: t("Uma nova história"),
        links: t("Vamos explorar"),
        callout: t("Fica por perto"),
        heading: t("Um novo capítulo"),
        quote: t("Há histórias que merecem ficar."),
        button: t("Descobrir"),
        image: "",
        gallery: t("Uma história em imagens"),
        divider: "",
        spacer: "",
        columns: "",
        posts: t("Do meu diário"),
      } as const
    )[type],
    body: "",
    ...(type === "columns"
      ? { children: [], style: { columns: 2 as const } }
      : {}),
    ...(type === "posts" ? { limit: 6 } : {}),
    ...(["image", "gallery"].includes(type) ? { media: [] } : {}),
    ...(["button", "links"].includes(type)
      ? { url: "https://example.org" }
      : {}),
  };
}
export function initialSite(name: string): StudioValue {
  const value: StudioValue = {
    site: legacySite(
      [
        {
          id: "hero",
          type: "hero",
          title: t("Um lugar para estar perto."),
          body: t("Bem-vindo ao meu pequeno espaço na rede."),
        },
        {
          id: "about",
          type: "text",
          title: t("Sobre mim"),
          body: t("As histórias, as pessoas e os lugares que nos ligam."),
        },
      ],
      name,
    ),
    theme: "sand",
    attachments: [],
  };
  value.site.pages[0].title = t("Início");
  value.site.description = t("Um lugar teu na rede.");
  return value;
}
export function flatten(
  nodes: SiteNode[],
  depth = 1,
  parent?: string,
): { node: SiteNode; depth: number; parent?: string }[] {
  return nodes.flatMap((node) => [
    { node, depth, parent },
    ...flatten(node.children ?? [], depth + 1, node.id),
  ]);
}
export function mapNodes(
  nodes: SiteNode[],
  id: string,
  change: (node: SiteNode) => SiteNode | null,
): SiteNode[] {
  return nodes.flatMap((n) => {
    const v = n.id === id ? change(n) : n;
    return v
      ? [
          {
            ...v,
            ...(v.children
              ? { children: mapNodes(v.children, id, change) }
              : {}),
          },
        ]
      : [];
  });
}
export function cloneNode(node: SiteNode): SiteNode {
  return {
    ...structuredClone(node),
    id: crypto.randomUUID(),
    ...(node.children ? { children: node.children.map(cloneNode) } : {}),
  };
}
export function countBlocks(site: SiteDocument) {
  return site.pages.reduce((n, p) => n + flatten(p.blocks).length, 0);
}
export function validateStudio(value: StudioValue) {
  if (
    !value ||
    !["sand", "forest", "ink"].includes(value.theme) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > SITE_LIMITS.assets
  )
    throw new Error("Projecto inválido");
  for (const a of value.attachments)
    if (
      !a ||
      !/^image\/(png|jpeg|webp|gif)$/.test(a.mime) ||
      typeof a.data !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) ||
      typeof a.name !== "string" ||
      a.name.length > 150
    )
      throw new Error("Imagem inválida");
  if (
    value.attachments.reduce((n, a) => n + a.data.length, 0) >
    Math.ceil((2 * 1024 * 1024) / 3) * 4
  )
    throw new Error("As imagens do site podem ocupar até 2 MB");
  validateSite(value.site, value.attachments);
}
export function templateSite(
  kind: "journal" | "portfolio" | "community",
  name: string,
): StudioValue {
  const start = initialSite(name);
  const n = (type: SiteNodeType, title: string, body = ""): SiteNode => ({
    ...newBlock(type),
    title,
    body,
  });
  const about = {
    id: crypto.randomUUID(),
    slug: "sobre",
    title: t("Sobre"),
    blocks: [
      n(
        "hero",
        t("O que me move."),
        t("Um pouco da história por detrás deste espaço."),
      ),
      n(
        "text",
        t("As minhas raízes"),
        t("Escreve sobre o teu percurso e o que queres partilhar."),
      ),
    ],
  };
  const home = start.site.pages[0];
  start.site.design.font = kind === "journal" ? "serif" : "sans";
  if (kind === "journal") {
    start.site.title = t("Caderno de ") + name;
    home.blocks = [
      n(
        "hero",
        t("Notas de um mundo em comum."),
        t(
          "Pequenas observações. Histórias compridas. Um espaço para pensar em voz alta.",
        ),
      ),
      {
        ...n(
          "text",
          t("Uma nota de boas-vindas"),
          t(
            "**Este caderno é meu, mas a conversa é nossa.**\n\n- Histórias do dia-a-dia\n- Pessoas que inspiram\n- Ideias para experimentar",
          ),
        ),
        format: "markdown",
      },
      n("posts", t("Entradas recentes")),
    ];
  }
  if (kind === "portfolio") {
    start.site.title = t("Estúdio ") + name;
    start.site.design.width = "wide";
    home.blocks = [
      n(
        "hero",
        t("Ideias que ganham forma."),
        t("Design, fotografias e projectos com história."),
      ),
      {
        ...n("columns", ""),
        style: { columns: 2 },
        children: [
          n(
            "callout",
            t("Projecto 01"),
            t("Um espaço para apresentar o teu trabalho."),
          ),
          n(
            "callout",
            t("Projecto 02"),
            t("Mostra o processo, os detalhes e o resultado."),
          ),
        ],
      },
      n("gallery", t("Uma selecção visual")),
      { ...n("button", t("Conhece o meu percurso")), url: "page:" + about.id },
    ];
  }
  if (kind === "community") {
    start.theme = "forest";
    start.site.title = t("O nosso bairro");
    home.blocks = [
      n(
        "hero",
        t("Há lugar para toda a gente."),
        t("Um ponto de encontro para quem faz parte deste lugar."),
      ),
      {
        ...n("columns", ""),
        style: { columns: 3 },
        children: [
          n(
            "callout",
            t("Pontos de encontro"),
            t("Onde nos encontramos e partilhamos ideias."),
          ),
          n(
            "callout",
            t("Recursos úteis"),
            t("Informação para o dia-a-dia da comunidade."),
          ),
          n(
            "callout",
            t("Como participar"),
            t("Cada pessoa traz algo de novo."),
          ),
        ],
      },
      n("posts", t("Novidades da comunidade")),
    ];
  }
  start.site.pages.push(about);
  return start;
}
