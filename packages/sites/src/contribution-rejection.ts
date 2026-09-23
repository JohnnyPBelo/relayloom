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

export const CONTRIBUTION_REJECTION_LIMITS = Object.freeze({
  bytes: 8192,
  lifetimeMs: 30 * 86400_000,
  reasonUnits: 512,
});
export interface ContributionRejectionRequest {
  contributorId: string;
  certificateId: string;
  operationId: string;
  target: ContributionTarget;
  proposalCreated: number;
  proposalExpires: number;
  decidedAt: number;
  reason: string;
  expires: number;
}
export interface ContributionRejectionBody extends ContributionRejectionRequest {
  domain: "relayloom/site-contribution-rejection/1";
  owner: PublicIdentity;
}
export interface ContributionRejection {
  body: ContributionRejectionBody;
  id: string;
  signature: string;
}
export interface ContributionRejectionContent {
  type: "site-contribution-rejection";
  rejection: ContributionRejection;
}
const fields = [
  "contributorId",
  "certificateId",
  "operationId",
  "target",
  "proposalCreated",
  "proposalExpires",
  "decidedAt",
  "reason",
  "expires",
];
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const clock = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error("Recusa de proposta inválida: " + reason);
}

/** An owner's explicit refusal of a particular signed proposal. It contains no
 * proposal values, publication grant or assertion of source verification. Refusal
 * may be historical/late; it cannot extend the visitor's original consent. Only
 * a signing-owned durable journal may authorize creation, never generic RPC. */
export function createContributionRejectionProtocol(crypto: CertificateCrypto) {
  const proposals = createSiteContributionProtocol(crypto);
  function bounded(value: unknown) {
    const text = canonical(value);
    insist(
      new TextEncoder().encode(text).length <=
        CONTRIBUTION_REJECTION_LIMITS.bytes,
      "orçamento",
    );
    return text;
  }
  function body(input: unknown): asserts input is ContributionRejectionBody {
    insist(exactShape(input, ["domain", "owner", ...fields]), "campos");
    const b = input as ContributionRejectionBody;
    insist(
      b.domain === "relayloom/site-contribution-rejection/1" &&
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
      [b.proposalCreated, b.proposalExpires, b.decidedAt, b.expires].every(
        clock,
      ) &&
        b.proposalExpires > b.proposalCreated &&
        b.proposalExpires - b.proposalCreated <=
          SITE_CONTRIBUTION_LIMITS.lifetimeMs &&
        b.proposalCreated - b.decidedAt <=
          SITE_CONTRIBUTION_LIMITS.clockSkewMs &&
        b.expires > b.decidedAt &&
        b.expires - b.decidedAt <= CONTRIBUTION_REJECTION_LIMITS.lifetimeMs,
      "prazo histórico ou intenção renovada",
    );
    insist(
      typeof b.reason === "string" &&
        b.reason.length <= CONTRIBUTION_REJECTION_LIMITS.reasonUnits,
      "motivo",
    );
    bounded(b);
  }
  function verify(input: unknown): ContributionRejection {
    insist(exactShape(input, ["body", "id", "signature"]), "certificado");
    const value = input as ContributionRejection;
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
  ): ContributionRejectionRequest {
    insist(exactShape(input, fields), "intenção");
    body({
      domain: "relayloom/site-contribution-rejection/1",
      owner,
      ...(input as ContributionRejectionRequest),
    });
    return JSON.parse(bounded(input));
  }
  function create(
    identity: Identity,
    request: ContributionRejectionRequest,
  ): ContributionRejection {
    insist(exactShape(request, fields), "intenção");
    const value: ContributionRejectionBody = {
      domain: "relayloom/site-contribution-rejection/1",
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
    const rejection = verify(input),
      proposal = proposals.verify(proposalInput),
      r = rejection.body,
      b = proposal.body;
    insist(
      r.certificateId === proposal.id &&
        r.contributorId === b.contributor.id &&
        r.operationId === b.operationId &&
        canonical(r.target) === canonical(b.target) &&
        r.proposalCreated === b.created &&
        r.proposalExpires === b.expires,
      "recusa de outra proposta",
    );
    return rejection;
  }
  function content(input: unknown): ContributionRejectionContent {
    insist(
      exactShape(input, ["type", "rejection"]) &&
        (input as ContributionRejectionContent).type ===
          "site-contribution-rejection",
      "conteúdo",
    );
    return {
      type: "site-contribution-rejection",
      rejection: verify((input as ContributionRejectionContent).rejection),
    };
  }
  /** Caller must authenticate/decrypt the outer bundle and enforce live policy. */
  function matchEnvelope(bundle: Bundle, plaintext: unknown) {
    const value = content(plaintext),
      b = value.rejection.body,
      m = bundle.manifest,
      readers = [...new Set([b.owner.id, b.contributorId])].sort();
    insist(
      m.kind === "site-contribution-rejection" &&
        canonical(m.author) === canonical(b.owner) &&
        m.publicKey === null &&
        canonical(m.keys.map((k) => k.reader).sort()) === canonical(readers) &&
        m.created === b.decidedAt &&
        m.expires === b.expires,
      "envelope diferente da recusa privada",
    );
    return value;
  }
  return { create, verify, matchProposal, content, matchEnvelope, request };
}
