import {
  decryptBundle,
  type Bundle,
  type Identity,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import { contributionReceiptManifestPolicy } from "../../../packages/content/src/receipt-content";
import { createContributionReceiptProtocol } from "../../../packages/sites/src/contribution-receipt";
const protocol = createContributionReceiptProtocol(nodeCertificateCrypto);
export function inspectContributionReceipt(
  bundle: Bundle,
  identity?: Identity,
) {
  if (bundle.manifest.kind !== "site-contribution-receipt") return null;
  if (!contributionReceiptManifestPolicy(bundle.manifest))
    throw Error("Recibos exigem um envelope privado limitado");
  if (
    !identity ||
    !bundle.manifest.keys.some((k) => k.reader === identity.public.id)
  )
    return null;
  return protocol.matchEnvelope(bundle, decryptBundle(bundle, identity));
}
