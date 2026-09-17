import { createSiteRevisionProtocol } from "../../sites/src/protocol";
import { browserCertificateCrypto } from "./certificate-crypto";
export const browserSiteRevisions: ReturnType<
  typeof createSiteRevisionProtocol
> = createSiteRevisionProtocol(browserCertificateCrypto);
