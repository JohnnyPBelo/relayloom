import { validateIdentity } from "../../../packages/core/src/index.js";
import { validateContentShape } from "../../../packages/content/src/validation.js";
import type { Content } from "./node.js";
export function validateContent(content: Content) {
  validateContentShape(content);
  if (content.members?.some((m) => !validateIdentity(m)))
    throw new Error("Membros inválidos");
}
