import { canonical, exactShape, type Manifest } from "../../core/src/protocol";
export function contributionReceiptManifestPolicy(m: Manifest) {
  return (
    m.kind === "site-contribution-receipt" &&
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
export function parseContributionReceiptShape(value: unknown) {
  if (
    !exactShape(value, ["type", "receipt"]) ||
    (value as any).type !== "site-contribution-receipt" ||
    !exactShape((value as any).receipt, ["body", "id", "signature"])
  )
    throw Error("Conteúdo de recibo inválido");
  const text = canonical(value);
  if (new TextEncoder().encode(text).length > 8192 + 128)
    throw Error("Recibo acima do limite");
  const owned = JSON.parse(text),
    receipt = owned.receipt;
  if (
    typeof receipt.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.id) ||
    typeof receipt.signature !== "string" ||
    receipt.signature.length !== 88
  )
    throw Error("Certificado de recibo inválido");
  return owned as {
    type: "site-contribution-receipt";
    receipt: import("../../sites/src/contribution-receipt").ContributionReceipt;
  };
}
export function summarizeContributionReceipt(input: unknown) {
  const c = parseContributionReceiptShape(input),
    b = c.receipt.body;
  return {
    type: "site-contribution-receipt",
    receiptId: c.receipt.id,
    proposalId: b.certificateId,
    operationId: b.operationId,
    proposalTarget: b.target,
    verifiedAt: b.verifiedAt,
    created: b.created,
    expires: b.expires,
  };
}
