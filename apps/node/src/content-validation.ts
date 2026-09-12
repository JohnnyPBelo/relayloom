import {
  canonical,
  validateIdentity,
} from "../../../packages/core/src/index.js";
import type { Content } from "./node.js";

export function validateContent(content: Content) {
  if (
    !content ||
    ![
      "message",
      "post",
      "group",
      "site",
      "comment",
      "reaction",
      "edit",
      "delete",
      "receipt",
      "delivery",
      "alert",
    ].includes(content.type)
  )
    throw new Error("Tipo de conteúdo inválido");
  for (const key of [
    "text",
    "title",
    "conversation",
    "target",
    "replyTo",
    "emoji",
  ])
    if (
      content[key] !== undefined &&
      (typeof content[key] !== "string" ||
        String(content[key]).length > (key === "text" ? 12000 : 256))
    )
      throw new Error("Texto demasiado longo ou inválido");
  if (content.value !== undefined && typeof content.value !== "boolean")
    throw new Error("Valor de reacção inválido");
  if (
    content.priority !== undefined &&
    !["sos", "normal", "bulk"].includes(content.priority)
  )
    throw new Error("Prioridade inválida");
  if (content.theme !== undefined && typeof content.theme !== "string")
    throw new Error("Tema inválido");
  if (
    content.members &&
    (!Array.isArray(content.members) ||
      content.members.length > 64 ||
      content.members.some((m) => !validateIdentity(m)))
  )
    throw new Error("Membros inválidos");
  if (content.attachments) {
    if (!Array.isArray(content.attachments) || content.attachments.length > 4)
      throw new Error("Máximo de quatro anexos");
    for (const a of content.attachments)
      if (
        !a ||
        typeof a.name !== "string" ||
        a.name.length > 150 ||
        typeof a.mime !== "string" ||
        a.mime.length > 100 ||
        typeof a.data !== "string" ||
        a.data.length > 3_500_000 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)
      )
        throw new Error("Anexo inválido ou demasiado grande");
  }
  if (content.type === "site") {
    if (
      !Array.isArray(content.blocks) ||
      content.blocks.length > 24 ||
      !["sand", "forest", "ink"].includes(content.theme ?? "sand")
    )
      throw new Error("Página inválida");
    for (const b of content.blocks)
      if (
        !b ||
        typeof b.id !== "string" ||
        b.id.length > 64 ||
        !["hero", "text", "links", "callout"].includes(b.type) ||
        typeof b.title !== "string" ||
        b.title.length > 120 ||
        typeof b.body !== "string" ||
        b.body.length > 4000 ||
        (b.url &&
          (typeof b.url !== "string" ||
            b.url.length > 2000 ||
            !/^https:\/\//.test(b.url)))
      )
        throw new Error("Bloco declarativo inválido");
  }
  canonical(content);
}
