import type { Bundle, PublicIdentity } from "../../core/src/protocol";
import type { Content } from "../../content/src/types";
import { validateContentShape } from "../../content/src/validation";
import { createSiteContentProtocol } from "../../sites/src/content";
import { browserCertificateCrypto } from "./certificate-crypto";
import { decryptBundle } from "./crypto";
const snapshots = createSiteContentProtocol(browserCertificateCrypto);
export function verifySiteContent(content: Content, author: PublicIdentity) {
  if (content.type !== "site" || !Object.hasOwn(content, "siteRevision"))
    return null;
  return snapshots.verify(content, author);
}
export async function inspectPublicSite(bundle: Bundle) {
  if (bundle.manifest.kind !== "site" || bundle.manifest.publicKey === null)
    return;
  const content = (await decryptBundle(bundle)) as Content;
  validateContentShape(content);
  if (content.type !== "site") throw new Error("Conteúdo de site inválido");
  verifySiteContent(content, bundle.manifest.author);
}
