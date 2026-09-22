import {
  decryptBundle,
  type Bundle,
  type Identity,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import { contributionManifestPolicy } from "../../../packages/content/src/site-contribution";
import { createContributionEnvelopeProtocol } from "../../../packages/sites/src/contribution-envelope";
const envelopes = createContributionEnvelopeProtocol(nodeCertificateCrypto);
export function inspectContribution(bundle: Bundle, identity?: Identity) {
  if (bundle.manifest.kind !== "site-contribution") return null;
  if (!contributionManifestPolicy(bundle.manifest))
    throw Error("Propostas exigem um envelope privado limitado");
  if (
    !identity ||
    !bundle.manifest.keys.some((k) => k.reader === identity.public.id)
  )
    return null;
  return envelopes.match(bundle, decryptBundle(bundle, identity));
}
