import {
  decryptBundle,
  type Bundle,
  type Identity,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import { contributionRejectionManifestPolicy } from "../../../packages/content/src/rejection-content";
import { createContributionRejectionProtocol } from "../../../packages/sites/src/contribution-rejection";
const protocol = createContributionRejectionProtocol(nodeCertificateCrypto);
export function inspectContributionRejection(
  bundle: Bundle,
  identity?: Identity,
) {
  if (bundle.manifest.kind !== "site-contribution-rejection") return null;
  if (!contributionRejectionManifestPolicy(bundle.manifest))
    throw Error("Recusas exigem um envelope privado limitado");
  if (
    !identity ||
    !bundle.manifest.keys.some((k) => k.reader === identity.public.id)
  )
    return null;
  return protocol.matchEnvelope(bundle, decryptBundle(bundle, identity));
}
