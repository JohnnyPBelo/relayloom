import { createGroupCertificateProtocol } from "../../groups/src/certificate-protocol";
import { browserCertificateCrypto } from "./certificate-crypto";

export const browserGroupCertificates = createGroupCertificateProtocol(
  browserCertificateCrypto,
);
