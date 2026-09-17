import { nodeCertificateCrypto } from "../../core/src/certificate-crypto";
import { createSiteRevisionProtocol } from "./protocol";
export * from "./protocol";
export const siteRevisions: ReturnType<typeof createSiteRevisionProtocol> =
  createSiteRevisionProtocol(nodeCertificateCrypto);
