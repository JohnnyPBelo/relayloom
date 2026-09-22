import { canonical, exactShape, type Manifest } from "../../core/src/protocol";
/** Envelope readers and lifetime are visible even to an opaque carrier. */
export function contributionManifestPolicy(m: Manifest) {
  return (
    m.kind === "site-contribution" &&
    m.publicKey === null &&
    m.keys.length >= 1 &&
    m.keys.length <= 2 &&
    m.keys.some((k) => k.reader === m.author.id) &&
    m.expires - m.created <= 30 * 86400_000
  );
}
/** Structural admission only. The runtime must verify the visitor certificate
 * and bind it to the authenticated envelope before accepting readable content. */
export function parseContributionContentShape(value: unknown) {
  if (
    !exactShape(value, ["type", "proposal"]) ||
    (value as any).type !== "site-contribution" ||
    !exactShape((value as any).proposal, ["body", "id", "signature"])
  )
    throw Error("Conteúdo de proposta inválido");
  const encoded = canonical(value);
  if (new TextEncoder().encode(encoded).length > 16 * 1024 + 128)
    throw Error("Proposta acima do limite");
  const owned = JSON.parse(encoded),
    p = owned.proposal;
  if (
    typeof p.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.id) ||
    typeof p.signature !== "string" ||
    p.signature.length !== 88
  )
    throw Error("Certificado de proposta inválido");
  return owned as {
    type: "site-contribution";
    proposal: import("../../sites/src/contribution-protocol").SiteContribution;
  };
}
export function summarizeContribution(value: unknown) {
  const content = parseContributionContentShape(value),
    b = content.proposal.body;
  return {
    type: "site-contribution",
    proposalId: content.proposal.id,
    proposalTarget: b.target,
    created: b.created,
    expires: b.expires,
  };
}
