import { canonical, exactShape, type Manifest } from "../../core/src/protocol";
export function contributionRejectionManifestPolicy(m: Manifest) {
  return (
    m.kind === "site-contribution-rejection" &&
    m.publicKey === null &&
    m.keys.length >= 1 &&
    m.keys.length <= 2 &&
    m.keys.some((k) => k.reader === m.author.id) &&
    m.expires - m.created <= 30 * 86400_000 &&
    m.chunks.reduce((n, c) => n + c.size, 0) <= 8192 + 128
  );
}
/** Structural admission only; readable payloads require owner signature and
 * full envelope binding before storage/admission in the corresponding runtime. */
export function parseContributionRejectionShape(value: unknown) {
  if (
    !exactShape(value, ["type", "rejection"]) ||
    (value as any).type !== "site-contribution-rejection" ||
    !exactShape((value as any).rejection, ["body", "id", "signature"])
  )
    throw Error("Conteúdo de recusa inválido");
  const text = canonical(value);
  if (new TextEncoder().encode(text).length > 8192 + 128)
    throw Error("Recusa acima do limite");
  const owned = JSON.parse(text),
    rejection = owned.rejection;
  if (
    typeof rejection.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(rejection.id) ||
    typeof rejection.signature !== "string" ||
    rejection.signature.length !== 88
  )
    throw Error("Certificado de recusa inválido");
  return owned as {
    type: "site-contribution-rejection";
    rejection: import("../../sites/src/contribution-rejection").ContributionRejection;
  };
}
export function summarizeContributionRejection(input: unknown) {
  const c = parseContributionRejectionShape(input),
    b = c.rejection.body;
  return {
    type: "site-contribution-rejection",
    rejectionId: c.rejection.id,
    proposalId: b.certificateId,
    operationId: b.operationId,
    proposalTarget: b.target,
    decidedAt: b.decidedAt,
    expires: b.expires,
  };
}
