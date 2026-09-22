import {
  canonical,
  exactShape,
  type Bundle,
  type Identity,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { parseSiteAddress } from "./protocol";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type ContributionTarget,
} from "./contribution-protocol";

export const CONTRIBUTION_RECEIPT_LIMITS = Object.freeze({
  bytes: 8192,
  lifetimeMs: 30 * 86400_000,
});
export interface ContributionReceiptRequest {
  contributorId: string;
  certificateId: string;
  operationId: string;
  target: ContributionTarget;
  proposalCreated: number;
  proposalExpires: number;
  verifiedAt: number;
  created: number;
  expires: number;
}
export interface ContributionReceiptBody extends ContributionReceiptRequest {
  domain: "relayloom/site-contribution-receipt/1";
  owner: PublicIdentity;
}
export interface ContributionReceipt {
  body: ContributionReceiptBody;
  id: string;
  signature: string;
}
export interface ContributionReceiptContent {
  type: "site-contribution-receipt";
  receipt: ContributionReceipt;
}
const fields = [
  "contributorId",
  "certificateId",
  "operationId",
  "target",
  "proposalCreated",
  "proposalExpires",
  "verifiedAt",
  "created",
  "expires",
];
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const clock = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error("Recibo de proposta inválido: " + reason);
}

/** An owner's attestation of historical verified reception. This is never a
 * publication decision, visitor grant, transport ACK or proof of clock accuracy.
 * Only signing-owned catalogues may derive an intent from authenticated evidence;
 * none of these signing/intent helpers is an RPC operation. */
export function createContributionReceiptProtocol(crypto: CertificateCrypto) {
  const proposals = createSiteContributionProtocol(crypto);
  function bounded(value: unknown) {
    const text = canonical(value);
    insist(
      new TextEncoder().encode(text).length <=
        CONTRIBUTION_RECEIPT_LIMITS.bytes,
      "orçamento",
    );
    return text;
  }
  function body(input: unknown): asserts input is ContributionReceiptBody {
    insist(exactShape(input, ["domain", "owner", ...fields]), "campos");
    const b = input as ContributionReceiptBody;
    insist(
      b.domain === "relayloom/site-contribution-receipt/1" &&
        crypto.validateIdentity(b.owner),
      "dono ou domínio",
    );
    insist(
      id(b.contributorId) &&
        id(b.certificateId) &&
        typeof b.operationId === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          b.operationId,
        ),
      "referência da proposta",
    );
    insist(
      exactShape(b.target, [
        "site",
        "snapshotId",
        "revisionId",
        "pageId",
        "formId",
      ]),
      "destino",
    );
    insist(
      parseSiteAddress(b.target.site).ownerId === b.owner.id &&
        id(b.target.snapshotId) &&
        id(b.target.revisionId) &&
        [b.target.pageId, b.target.formId].every(
          (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v),
        ),
      "dono ou referência do destino",
    );
    insist(
      [
        b.proposalCreated,
        b.proposalExpires,
        b.verifiedAt,
        b.created,
        b.expires,
      ].every(clock) &&
        b.proposalExpires > b.proposalCreated &&
        b.proposalExpires - b.proposalCreated <=
          SITE_CONTRIBUTION_LIMITS.lifetimeMs &&
        b.verifiedAt < b.proposalExpires &&
        b.proposalCreated - b.verifiedAt <=
          SITE_CONTRIBUTION_LIMITS.clockSkewMs &&
        b.created === b.verifiedAt &&
        b.expires > b.created &&
        b.expires - b.created <= CONTRIBUTION_RECEIPT_LIMITS.lifetimeMs,
      "prazo histórico ou intenção renovada",
    );
    bounded(b);
  }
  function verify(input: unknown): ContributionReceipt {
    insist(exactShape(input, ["body", "id", "signature"]), "certificado");
    const value = input as ContributionReceipt;
    body(value.body);
    insist(
      id(value.id) &&
        typeof value.signature === "string" &&
        value.signature.length === 88,
      "assinatura",
    );
    const bytes = Uint8Array.from(atob(value.signature), (c) =>
      c.charCodeAt(0),
    );
    insist(
      bytes.length === 64 &&
        btoa(String.fromCharCode(...bytes)) === value.signature,
      "assinatura não canónica",
    );
    const text = bounded(value.body);
    insist(
      value.id === crypto.hash(text) &&
        crypto.verify(value.body.owner, text, bytes),
      "assinatura ou hash",
    );
    return JSON.parse(bounded(value));
  }
  function request(
    input: unknown,
    owner: PublicIdentity,
  ): ContributionReceiptRequest {
    insist(exactShape(input, fields), "intenção");
    body({
      domain: "relayloom/site-contribution-receipt/1",
      owner,
      ...(input as ContributionReceiptRequest),
    });
    return JSON.parse(bounded(input));
  }
  function create(
    identity: Identity,
    request: ContributionReceiptRequest,
  ): ContributionReceipt {
    insist(exactShape(request, fields), "intenção");
    const value: ContributionReceiptBody = {
      domain: "relayloom/site-contribution-receipt/1",
      owner: identity.public,
      ...request,
    };
    body(value);
    const owned = JSON.parse(bounded(value)),
      text = bounded(owned);
    return verify({
      body: owned,
      id: crypto.hash(text),
      signature: crypto.sign(identity, text),
    });
  }
  /** Historical binding; does not check admission or create publication authority. */
  function matchProposal(input: unknown, proposalInput: unknown) {
    const receipt = verify(input),
      proposal = proposals.verify(proposalInput),
      r = receipt.body,
      b = proposal.body;
    insist(
      r.certificateId === proposal.id &&
        r.contributorId === b.contributor.id &&
        r.operationId === b.operationId &&
        canonical(r.target) === canonical(b.target) &&
        r.proposalCreated === b.created &&
        r.proposalExpires === b.expires,
      "recibo de outra proposta",
    );
    return receipt;
  }
  function content(input: unknown): ContributionReceiptContent {
    insist(
      exactShape(input, ["type", "receipt"]) &&
        (input as ContributionReceiptContent).type ===
          "site-contribution-receipt",
      "conteúdo",
    );
    return {
      type: "site-contribution-receipt",
      receipt: verify((input as ContributionReceiptContent).receipt),
    };
  }
  /** Caller must authenticate/decrypt the outer bundle and enforce live policy. */
  function matchEnvelope(bundle: Bundle, plaintext: unknown) {
    const value = content(plaintext),
      b = value.receipt.body,
      m = bundle.manifest,
      readers = [...new Set([b.owner.id, b.contributorId])].sort();
    insist(
      m.kind === "site-contribution-receipt" &&
        canonical(m.author) === canonical(b.owner) &&
        m.publicKey === null &&
        canonical(m.keys.map((k) => k.reader).sort()) === canonical(readers) &&
        m.created === b.created &&
        m.expires === b.expires,
      "envelope diferente do recibo privado",
    );
    return value;
  }
  return { create, verify, matchProposal, content, matchEnvelope, request };
}
