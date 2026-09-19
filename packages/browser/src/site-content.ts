import type { Bundle, PublicIdentity } from "../../core/src/protocol";
import type { Content } from "../../content/src/types";
import { validateContentShape } from "../../content/src/validation";
import { createSiteContentProtocol } from "../../sites/src/content";
import { browserCertificateCrypto } from "./certificate-crypto";
import { decryptBundle } from "./crypto";
const snapshots = createSiteContentProtocol(browserCertificateCrypto);
export function verifySiteContent(content: Content, author: PublicIdentity) {
  if (content.type !== "site") return null;
  if (!Object.hasOwn(content, "siteRevision")) {
    if (content.site?.version === 3)
      throw new Error("Sites versão 3 exigem um snapshot assinado");
    return null;
  }
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
