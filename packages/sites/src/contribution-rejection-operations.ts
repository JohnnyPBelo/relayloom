import {
  canonical,
  exactShape,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import {
  createContributionRejectionProtocol,
  CONTRIBUTION_REJECTION_LIMITS,
  type ContributionRejectionRequest,
} from "./contribution-rejection";
import {
  createSiteContributionProtocol,
  type ContributionTarget,
} from "./contribution-protocol";

export const REJECTION_STORAGE_LIMITS = Object.freeze({
  stageBytes: 64 * 1024,
  totalStageBytes: 4 * 1024 * 1024,
});
export interface RejectionEntryReference {
  id: string;
  contributorId: string;
  operationId: string;
  target: ContributionTarget;
  created: number;
  expires: number;
  observedAt: number;
  verifiedAt: number | null;
}
export interface RejectionOperation {
  owner: PublicIdentity;
  recipient: PublicIdentity;
  request: ContributionRejectionRequest;
  fingerprint: string;
  phase: "prepared" | "signed" | "queued" | "expired";
  certificateId: string | null;
  stage: { hash: string; bytes: number } | null;
  transport?: { bundleId: string; bundleHash: string; copied: boolean };
}
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const clock = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error("Registo de recusa inválido: " + reason);
}
/** Local explicit decision in the signing-owned inbox. Preparation binds the
 * authenticated proposal and recipient before releasing its proof. It does not
 * claim source verification, actual delivery or publication authorization. */
export function createRejectionOperations(crypto: CertificateCrypto) {
  // Cache only immutable, fully signed public cards, never access policy,
  // session validity or proposal/rejection signatures. Bound both key and count.
  const cards = new Set<string>();
  const checkedCrypto: CertificateCrypto = {
    ...crypto,
    validateIdentity(card) {
      if (!exactShape(card, ["id", "name", "signKey", "boxKey", "proof"]))
        return false;
      let key: string;
      try {
        key = canonical(card);
      } catch {
        return false;
      }
      if (key.length > 2048) return false;
      if (cards.has(key)) return true;
      if (!crypto.validateIdentity(card)) return false;
      cards.add(key);
      if (cards.size > 512) cards.delete(cards.values().next().value!);
      return true;
    },
  };
  const rejections = createContributionRejectionProtocol(checkedCrypto),
    proposals = createSiteContributionProtocol(checkedCrypto);
  function intentHash(
    owner: PublicIdentity,
    recipient: PublicIdentity,
    request: ContributionRejectionRequest,
  ) {
    return crypto.hash(
      canonical({
        domain: "relayloom/contribution-rejection-intent/1",
        owner,
        recipient,
        request,
      }),
    );
  }
  function stage(
    value: unknown,
  ): asserts value is NonNullable<RejectionOperation["stage"]> {
    insist(exactShape(value, ["hash", "bytes"]), "preparação");
    const v = value as NonNullable<RejectionOperation["stage"]>;
    insist(
      id(v.hash) &&
        clock(v.bytes) &&
        v.bytes > 0 &&
        v.bytes <= REJECTION_STORAGE_LIMITS.stageBytes,
      "orçamento da preparação",
    );
  }
  function validate(
    input: unknown,
    ownerId: string,
    entry: RejectionEntryReference,
  ): RejectionOperation {
    const fields = [
      "owner",
      "recipient",
      "request",
      "fingerprint",
      "phase",
      "certificateId",
      "stage",
    ];
    insist(
      exactShape(input, fields) || exactShape(input, [...fields, "transport"]),
      "campos",
    );
    const op = input as RejectionOperation;
    insist(
      checkedCrypto.validateIdentity(op.owner) &&
        op.owner.id === ownerId &&
        checkedCrypto.validateIdentity(op.recipient),
      "identidades",
    );
    const q = rejections.request(op.request, op.owner);
    insist(
      q.certificateId === entry.id &&
        q.contributorId === entry.contributorId &&
        q.contributorId === op.recipient.id &&
        q.operationId === entry.operationId &&
        canonical(q.target) === canonical(entry.target) &&
        q.proposalCreated === entry.created &&
        q.proposalExpires === entry.expires &&
        clock(entry.observedAt) &&
        (entry.verifiedAt === null || clock(entry.verifiedAt)) &&
        q.decidedAt >= entry.observedAt &&
        q.decidedAt >= (entry.verifiedAt ?? 0) &&
        q.decidedAt < entry.expires &&
        q.expires ===
          Math.min(
            Number.MAX_SAFE_INTEGER,
            q.decidedAt + CONTRIBUTION_REJECTION_LIMITS.lifetimeMs,
          ),
      "origem ou prazo diferente da intenção",
    );
    insist(
      id(op.fingerprint) &&
        op.fingerprint === intentHash(op.owner, op.recipient, q),
      "fingerprint",
    );
    insist(
      ["prepared", "signed", "queued", "expired"].includes(op.phase) &&
        (op.certificateId === null || id(op.certificateId)),
      "fase ou certificado",
    );
    if (op.phase === "prepared")
      insist(
        op.certificateId === null &&
          op.stage === null &&
          !Object.hasOwn(op, "transport"),
        "assinatura sem intenção",
      );
    else if (op.phase === "expired")
      insist(op.stage === null, "limpeza em falta");
    else {
      insist(id(op.certificateId), "assinatura em falta");
      stage(op.stage);
    }
    if (Object.hasOwn(op, "transport")) {
      insist(
        (op.phase === "queued" || op.phase === "expired") &&
          id(op.certificateId) &&
          exactShape(op.transport, ["bundleId", "bundleHash", "copied"]),
        "transporte sem assinatura",
      );
      insist(
        id(op.transport!.bundleId) &&
          id(op.transport!.bundleHash) &&
          typeof op.transport!.copied === "boolean",
        "cópia",
      );
    }
    insist(op.phase !== "queued" || op.transport, "envelope em falta");
    return JSON.parse(canonical(op));
  }
  function prepare(
    owner: PublicIdentity,
    entry: RejectionEntryReference,
    input: unknown,
    reason: string,
    now: number,
  ) {
    const p = proposals.verify(input),
      b = p.body;
    insist(clock(now), "relógio da decisão");
    const request: ContributionRejectionRequest = {
      contributorId: b.contributor.id,
      certificateId: p.id,
      operationId: b.operationId,
      target: b.target,
      proposalCreated: b.created,
      proposalExpires: b.expires,
      decidedAt: now,
      reason,
      expires: Math.min(
        Number.MAX_SAFE_INTEGER,
        now + CONTRIBUTION_REJECTION_LIMITS.lifetimeMs,
      ),
    };
    return validate(
      {
        owner,
        recipient: b.contributor,
        request,
        fingerprint: intentHash(owner, b.contributor, request),
        phase: "prepared",
        certificateId: null,
        stage: null,
      },
      owner.id,
      entry,
    );
  }
  function checkCertificate(
    input: unknown,
    ownerId: string,
    entry: RejectionEntryReference,
    certificate: unknown,
  ) {
    const op = validate(input, ownerId, entry),
      signed = rejections.verify(certificate),
      { domain: _domain, owner, ...q } = signed.body;
    insist(
      canonical(owner) === canonical(op.owner) &&
        canonical(q) === canonical(op.request) &&
        (op.certificateId === null || op.certificateId === signed.id),
      "certificado diferente da intenção",
    );
    return signed;
  }
  function signed(
    input: unknown,
    ownerId: string,
    entry: RejectionEntryReference,
    certificate: unknown,
    proof: unknown,
    now: number,
  ) {
    const op = validate(input, ownerId, entry),
      rejection = checkCertificate(op, ownerId, entry, certificate);
    stage(proof);
    insist(
      clock(now) && op.request.expires > now && op.phase === "prepared",
      "assinatura fora da fase ou prazo",
    );
    op.phase = "signed";
    op.certificateId = rejection.id;
    op.stage = { ...proof };
    return validate(op, ownerId, entry);
  }
  function queued(
    input: unknown,
    ownerId: string,
    entry: RejectionEntryReference,
    bundle: { id: string; hash: string },
    proof: unknown,
    now: number,
  ) {
    const op = validate(input, ownerId, entry);
    stage(proof);
    insist(
      clock(now) &&
        op.request.expires > now &&
        op.phase === "signed" &&
        exactShape(bundle, ["id", "hash"]) &&
        id(bundle.id) &&
        id(bundle.hash),
      "envelope fora da fase ou prazo",
    );
    op.phase = "queued";
    op.stage = { ...proof };
    op.transport = {
      bundleId: bundle.id,
      bundleHash: bundle.hash,
      copied: false,
    };
    return validate(op, ownerId, entry);
  }
  function copied(
    input: unknown,
    ownerId: string,
    entry: RejectionEntryReference,
    bundleId: string,
    bundleHash: string,
    now: number,
  ) {
    const op = validate(input, ownerId, entry);
    insist(
      clock(now) &&
        op.request.expires > now &&
        op.phase === "queued" &&
        op.transport?.bundleId === bundleId &&
        op.transport.bundleHash === bundleHash,
      "cópia ou prazo inválido",
    );
    op.transport.copied = true;
    return validate(op, ownerId, entry);
  }
  function expire(
    input: unknown,
    ownerId: string,
    entry: RejectionEntryReference,
    now: number,
  ) {
    const op = validate(input, ownerId, entry);
    insist(clock(now), "relógio");
    if (op.request.expires <= now) {
      op.phase = "expired";
      op.stage = null;
    }
    return validate(op, ownerId, entry);
  }
  return {
    validate,
    prepare,
    checkCertificate,
    signed,
    queued,
    copied,
    expire,
  };
}
