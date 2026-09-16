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
        hero: "Um lugar para as tuas ideias.",
        text: "Uma nova história",
        links: "Vamos explorar",
        callout: "Fica por perto",
        heading: "Um novo capítulo",
        quote: "Há histórias que merecem ficar.",
        button: "Descobrir",
        image: "",
        gallery: "Uma história em imagens",
        divider: "",
        spacer: "",
        columns: "",
        posts: "Do meu diário",
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
  return {
    site: legacySite(
      [
        {
          id: "hero",
          type: "hero",
          title: "Um lugar para estar perto.",
          body: "Bem-vindo ao meu pequeno espaço na rede.",
        },
        {
          id: "about",
          type: "text",
          title: "Sobre mim",
          body: "As histórias, as pessoas e os lugares que nos ligam.",
        },
      ],
      name,
    ),
    theme: "sand",
    attachments: [],
  };
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
    title: "Sobre",
    blocks: [
      n(
        "hero",
        "O que me move.",
        "Um pouco da história por detrás deste espaço.",
      ),
      n(
        "text",
        "As minhas raízes",
        "Escreve sobre o teu percurso e o que queres partilhar.",
      ),
    ],
  };
  const home = start.site.pages[0];
  start.site.design.font = kind === "journal" ? "serif" : "sans";
  if (kind === "journal") {
    start.site.title = "Caderno de " + name;
    home.blocks = [
      n(
        "hero",
        "Notas de um mundo em comum.",
        "Pequenas observações. Histórias compridas. Um espaço para pensar em voz alta.",
      ),
      {
        ...n(
          "text",
          "Uma nota de boas-vindas",
          "**Este caderno é meu, mas a conversa é nossa.**\n\n- Histórias do dia-a-dia\n- Pessoas que inspiram\n- Ideias para experimentar",
        ),
        format: "markdown",
      },
      n("posts", "Entradas recentes"),
    ];
  }
  if (kind === "portfolio") {
    start.site.title = "Estúdio " + name;
    start.site.design.width = "wide";
    home.blocks = [
      n(
        "hero",
        "Ideias que ganham forma.",
        "Design, fotografias e projectos com história.",
      ),
      {
        ...n("columns", ""),
        style: { columns: 2 },
        children: [
          n(
            "callout",
            "Projecto 01",
            "Um espaço para apresentar o teu trabalho.",
          ),
          n(
            "callout",
            "Projecto 02",
            "Mostra o processo, os detalhes e o resultado.",
          ),
        ],
      },
      n("gallery", "Uma selecção visual"),
      { ...n("button", "Conhece o meu percurso"), url: "page:" + about.id },
    ];
  }
  if (kind === "community") {
    start.theme = "forest";
    start.site.title = "O nosso bairro";
    home.blocks = [
      n(
        "hero",
        "Há lugar para toda a gente.",
        "Um ponto de encontro para quem faz parte deste lugar.",
      ),
      {
        ...n("columns", ""),
        style: { columns: 3 },
        children: [
          n(
            "callout",
            "Pontos de encontro",
            "Onde nos encontramos e partilhamos ideias.",
          ),
          n(
            "callout",
            "Recursos úteis",
            "Informação para o dia-a-dia da comunidade.",
          ),
          n("callout", "Como participar", "Cada pessoa traz algo de novo."),
        ],
      },
      n("posts", "Novidades da comunidade"),
    ];
  }
  start.site.pages.push(about);
  return start;
}
