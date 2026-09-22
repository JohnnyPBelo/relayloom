import { canonical, exactShape, type Bundle } from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { parseSiteAddress } from "./protocol";
import {
  createSiteContributionProtocol,
  type SiteContribution,
} from "./contribution-protocol";
export interface SiteContributionContent {
  type: "site-contribution";
  proposal: SiteContribution;
}
/** Certificate/envelope binding. The caller authenticates and decrypts the
 * outer bundle first and separately enforces expiry, policy and inbox limits. */
export function createContributionEnvelopeProtocol(crypto: CertificateCrypto) {
  const proposals = createSiteContributionProtocol(crypto);
  function content(input: unknown): SiteContributionContent {
    if (
      !exactShape(input, ["type", "proposal"]) ||
      (input as SiteContributionContent).type !== "site-contribution"
    )
      throw Error("Conteúdo de proposta inválido");
    return {
      type: "site-contribution",
      proposal: proposals.verify((input as SiteContributionContent).proposal),
    };
  }
  function match(bundle: Bundle, plaintext: unknown) {
    const value = content(plaintext),
      b = value.proposal.body,
      m = bundle.manifest,
      owner = parseSiteAddress(b.target.site).ownerId;
    const readers = [...new Set([owner, b.contributor.id])].sort();
    if (
      m.kind !== "site-contribution" ||
      m.author.id !== b.contributor.id ||
      m.publicKey !== null ||
      canonical(m.keys.map((k) => k.reader).sort()) !== canonical(readers) ||
      m.created !== b.created ||
      m.expires !== b.expires
    )
      throw Error("Envelope diferente da proposta privada");
    return value;
  }
  return { content, match };
}
