const siteProblems = [
  ["estrutura", "structure", "estructura"],
  ["imagens acima de 2 MB", "images exceed 2 MB", "las imágenes superan 2 MB"],
  ["páginas ou versão", "pages or version", "páginas o versión"],
  ["estilo", "style", "estilo"],
  [
    "endereço ou nome de página",
    "page address or name",
    "dirección o nombre de página",
  ],
  [
    "página inicial inexistente",
    "home page does not exist",
    "la página de inicio no existe",
  ],
  [
    "composição demasiado profunda ou extensa",
    "layout is too deep or large",
    "la composición es demasiado profunda o extensa",
  ],
  [
    "bloco ou identificador repetido",
    "invalid block or duplicate identifier",
    "bloque no válido o identificador duplicado",
  ],
  ["demasiados blocos", "too many blocks", "demasiados bloques"],
  ["formatação", "formatting", "formato"],
  ["ligação", "link", "enlace"],
  ["estilo de bloco", "block style", "estilo de bloque"],
  [
    "filhos num bloco que não é composição",
    "children in a non-layout block",
    "elementos hijos en un bloque que no es una composición",
  ],
  ["galeria", "gallery", "galería"],
  [
    "imagem não incluída ou não suportada",
    "image is missing or unsupported",
    "la imagen no está incluida o no es compatible",
  ],
  ["limite de publicações", "post limit", "límite de publicaciones"],
  [
    "documento maior que 128 KiB",
    "document exceeds 128 KiB",
    "el documento supera 128 KiB",
  ],
] as const;
export const validation = [
  ...siteProblems.map(
    ([pt, en, es]) =>
      [
        "Site inválido: " + pt,
        "Invalid site: " + en,
        "Sitio no válido: " + es,
      ] as const,
  ),
  [
    "site declarativo inválido ou acima dos limites",
    "Declarative site is invalid or exceeds limits",
    "El sitio declarativo no es válido o supera los límites",
  ],
  [
    "Não foi possível concluir",
    "The operation could not be completed",
    "No se ha podido completar la operación",
  ],
  [
    "O nó demorou demasiado a responder. Tenta novamente.",
    "The node took too long to respond. Try again.",
    "El nodo ha tardado demasiado en responder. Inténtalo de nuevo.",
  ],
  ["Motor já configurado", "Engine already configured", "Motor ya configurado"],
  ["Idioma não suportado", "Unsupported language", "Idioma no compatible"],
] as const;
