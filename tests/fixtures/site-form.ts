import type { SiteDocument } from "../../packages/content/src/site";
export const formRowSentinel = "SYNTHETIC_STORED_ROW_NOT_FORM_METADATA";
export function formSite(
  contributors: "readers" | string[] = "readers",
): SiteDocument {
  return {
    version: 4,
    title: "Comunidade",
    description: "Propostas para revisão",
    home: "entry",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [
      {
        id: "entry",
        slug: "inicio",
        title: "Participar",
        blocks: [
          {
            id: "layout",
            type: "columns",
            title: "",
            body: "",
            children: [
              {
                id: "form",
                type: "form",
                title: "Inscreve um lugar",
                body: "O dono vai rever a proposta.",
                form: {
                  domain: "relayloom/site-form/1",
                  table: { pageId: "directory", blockId: "table" },
                  contributors,
                  fields: [
                    { column: "name", required: true },
                    { column: "count", required: false },
                    { column: "open", required: true },
                  ],
                },
              },
            ],
          },
        ],
      },
      {
        id: "directory",
        slug: "lugares",
        title: "Lugares",
        blocks: [
          {
            id: "table",
            type: "table",
            title: "Lugares",
            body: "",
            data: {
              domain: "relayloom/site-table/1",
              columns: [
                { id: "name", label: "Nome", type: "text" },
                { id: "count", label: "Quantidade", type: "number" },
                { id: "open", label: "Aberto", type: "boolean" },
              ],
              rows: [
                {
                  id: "stored",
                  values: { name: formRowSentinel, count: 2, open: false },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
export const formPayload = (
  contributors: "readers" | string[] = "readers",
) => ({
  type: "site" as const,
  theme: "sand" as const,
  blocks: [],
  site: formSite(contributors),
});
