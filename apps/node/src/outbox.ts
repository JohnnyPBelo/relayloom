import { canonical, hash } from "../../../packages/core/src/index.js";
import type { Content } from "./node.js";
export * from "../../../packages/content/src/outbox.js";
const address = /^[a-f0-9]{64}$/;
export function sendFingerprint(
  content: Content,
  recipients: string[],
  ttlMs: number,
) {
  if (
    !Array.isArray(recipients) ||
    recipients.length > 64 ||
    recipients.some((id) => typeof id !== "string" || !address.test(id))
  )
    throw new Error("Destinatários inválidos");
  return hash(
    canonical({ content, recipients: [...new Set(recipients)].sort(), ttlMs }),
  );
}
