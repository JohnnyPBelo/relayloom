import type { SiteTable } from "../../packages/content/src/site-data";
/** Synthetic authored values shared by the protocol and actual transport gates. */
export function authoredTable(): SiteTable {
  return {
    domain: "relayloom/site-table/1",
    columns: [
      { id: "place", label: "Lugar", type: "text" },
      { id: "water", label: "Litros", type: "number" },
      { id: "open", label: "Aberto", type: "boolean" },
      { id: "date", label: "Data", type: "date" },
      { id: "link", label: "Informação", type: "link" },
    ],
    rows: [
      {
        id: "school",
        values: {
          place: "Escola 🧶",
          water: 1.25,
          open: true,
          date: "2024-02-29",
          link: "https://example.org/escola",
        },
      },
      {
        id: "park",
        values: {
          place: "Parque",
          water: 1e-15,
          open: false,
          date: null,
          link: null,
        },
      },
      {
        id: "empty",
        values: {
          place: null,
          water: null,
          open: null,
          date: null,
          link: null,
        },
      },
    ],
  };
}
export function largeTable(): SiteTable {
  return {
    domain: "relayloom/site-table/1",
    columns: [{ id: "text", label: "Texto", type: "text" }],
    rows: Array.from({ length: 64 }, (_, i) => ({
      id: "row-" + i,
      values: { text: "á".repeat(400) },
    })),
  };
}
