import {
  createContributionRejectionProtocol,
  type ContributionRejection,
} from "./contribution-rejection";
import {
  createContributionReceiptProtocol,
  type ContributionReceipt,
} from "./contribution-receipt";
import { canonical, exactShape } from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import {
  parseContributionScope,
  parseContributionValues,
  matchContributionValues,
} from "../../content/src/site-form";
import type { SiteReadScope } from "../../content/src/site-resource";
import type { SiteCell } from "../../content/src/site-data";
import { parseSiteAddress } from "./protocol";
import { parseContributionFormLookup } from "./contribution-context";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type ContributionFormContext,
  type ContributionTarget,
  type SiteContribution,
} from "./contribution-protocol";

export const CONTRIBUTION_JOURNAL_LIMITS = Object.freeze({
  operations: 128,
  bytes: 1024 * 1024,
  queued: 32,
  queuedBytes: 32 * 1024 * 1024,
  stageBytes: 6 * 1024 * 1024 + 16384,
});
export interface ContributionCreationRequest {
  sequence: number;
  operationId: string;
  snapshotId: string;
  pageId: string;
  formId: string;
  values: Record<string, SiteCell>;
  publicationScope: SiteReadScope;
  ttlMs: number;
}
export interface ContributionOperation {
  sequence: number;
  operationId: string;
  fingerprint: string;
  phase:
    | "prepared"
    | "signed"
    | "queued"
    | "cancelled"
    | "expired"
    | "received"
    | "rejected";
  receipt?: ContributionReceipt;
  rejection?: ContributionRejection;
  target: ContributionTarget;
  schemaHash: string;
  created: number;
  expires: number;
  certificateId: string | null;
  transport?: {
    bundleId: string;
    bundleHash: string;
    bytes: number;
    copied: boolean;
  };
}
export interface ContributionCreationRecord {
  domain: "relayloom/contribution-creation/1";
  ownerId: string;
  nextSequence: number;
  operations: ContributionOperation[];
}
const hashID = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0;
const clock = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const active = (op: ContributionOperation) =>
  op.phase === "prepared" || op.phase === "signed";
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error("Registo de proposta inválido: " + reason);
}
/** Authentic wire fact with no matching authorised local operation. This is a
 * local admission refusal, not a malformed transport frame or stored corruption. */
export class UnmatchedContributionReceipt extends Error {}
export class UnmatchedContributionRejection extends Error {}
/** Pure local journal transitions. Signing-owned storage and original snapshot
 * validation are mandatory in the catalogue; this record is never wire authority. */
export function createContributionOperations(crypto: CertificateCrypto) {
  const protocol = createSiteContributionProtocol(crypto),
    receipts = createContributionReceiptProtocol(crypto),
    rejections = createContributionRejectionProtocol(crypto);
  function outcomeMatches(
    op: ContributionOperation,
    ownerId: string,
    receipt: ContributionReceipt | ContributionRejection,
  ) {
    const r = receipt.body;
    return (
      op.transport?.copied === true &&
      op.certificateId !== null &&
      r.certificateId === op.certificateId &&
      r.contributorId === ownerId &&
      r.operationId === op.operationId &&
      canonical(r.target) === canonical(op.target) &&
      r.proposalCreated === op.created &&
      r.proposalExpires === op.expires &&
      r.owner.id === parseSiteAddress(op.target.site).ownerId
    );
  }
  function bindReceipt(
    op: ContributionOperation,
    ownerId: string,
    input: unknown,
  ) {
    const receipt = receipts.verify(input);
    insist(
      outcomeMatches(op, ownerId, receipt),
      "recibo de operação não enviada ou diferente",
    );
    return receipt;
  }
  function bindRejection(
    op: ContributionOperation,
    ownerId: string,
    input: unknown,
  ) {
    const rejection = rejections.verify(input);
    insist(
      outcomeMatches(op, ownerId, rejection),
      "recusa de operação não enviada ou diferente",
    );
    return rejection;
  }
  function request(input: unknown, ownerId: string) {
    insist(
      hashID(ownerId) &&
        exactShape(input, [
          "sequence",
          "operationId",
          "snapshotId",
          "pageId",
          "formId",
          "values",
          "publicationScope",
          "ttlMs",
        ]),
      "pedido",
    );
    const q = input as ContributionCreationRequest;
    insist(
      positive(q.sequence) &&
        uuid(q.operationId) &&
        positive(q.ttlMs) &&
        q.ttlMs >= 1000 &&
        q.ttlMs <= SITE_CONTRIBUTION_LIMITS.lifetimeMs,
      "sequência, UUID ou prazo",
    );
    const locator = parseContributionFormLookup({
      action: "form",
      snapshotId: q.snapshotId,
      pageId: q.pageId,
      formId: q.formId,
    });
    const scope = parseContributionScope(q.publicationScope);
    insist(
      scope === "public" || scope.includes(ownerId),
      "contribuidor em falta na concessão",
    );
    const normalized: ContributionCreationRequest = {
      sequence: q.sequence,
      operationId: q.operationId,
      snapshotId: locator.snapshotId,
      pageId: locator.pageId,
      formId: locator.formId,
      values: parseContributionValues(q.values),
      publicationScope: scope,
      ttlMs: q.ttlMs,
    };
    insist(
      new TextEncoder().encode(canonical(normalized)).length <=
        SITE_CONTRIBUTION_LIMITS.bytes,
      "orçamento do pedido",
    );
    return {
      request: normalized,
      fingerprint: crypto.hash(
        canonical({
          domain: "relayloom/contribution-creation-request/1",
          ownerId,
          request: normalized,
        }),
      ),
    };
  }
  function initial(ownerId: string): ContributionCreationRecord {
    insist(hashID(ownerId), "proprietário");
    return {
      domain: "relayloom/contribution-creation/1",
      ownerId,
      nextSequence: 1,
      operations: [],
    };
  }
  function validate(
    input: unknown,
    ownerId: string,
  ): ContributionCreationRecord {
    insist(
      hashID(ownerId) &&
        exactShape(input, ["domain", "ownerId", "nextSequence", "operations"]),
      "campos",
    );
    const r = input as ContributionCreationRecord;
    insist(
      r.domain === "relayloom/contribution-creation/1" &&
        r.ownerId === ownerId &&
        positive(r.nextSequence),
      "dono ou contador",
    );
    const ops = r.operations;
    insist(
      Array.isArray(ops) &&
        Object.getPrototypeOf(ops) === Array.prototype &&
        ops.length <= CONTRIBUTION_JOURNAL_LIMITS.operations,
      "limite de operações",
    );
    const d = Object.getOwnPropertyDescriptors(ops);
    insist(
      Reflect.ownKeys(ops).length === ops.length + 1 &&
        Array.from({ length: ops.length }, (_, i) => d[String(i)]).every(
          (v) => v && "value" in v,
        ),
      "lista não canónica",
    );
    insist(
      ops.length ===
        Math.min(r.nextSequence - 1, CONTRIBUTION_JOURNAL_LIMITS.operations),
      "resultados retidos em falta",
    );
    let last = r.nextSequence - ops.length - 1,
      pending = 0,
      queued = 0,
      queuedBytes = 0;
    const seen = new Set<string>();
    for (const op of ops) {
      const fields = [
        ...(Object.hasOwn(op, "receipt") ? ["receipt"] : []),
        ...(Object.hasOwn(op, "rejection") ? ["rejection"] : []),
        "sequence",
        "operationId",
        "fingerprint",
        "phase",
        "target",
        "schemaHash",
        "created",
        "expires",
        "certificateId",
      ];
      insist(
        exactShape(op, fields) || exactShape(op, [...fields, "transport"]),
        "operação",
      );
      insist(
        positive(op.sequence) &&
          op.sequence === last + 1 &&
          op.sequence < r.nextSequence &&
          uuid(op.operationId) &&
          !seen.has(op.operationId) &&
          hashID(op.fingerprint) &&
          hashID(op.schemaHash),
        "sequência ou identidade",
      );
      insist(
        [
          "prepared",
          "signed",
          "queued",
          "cancelled",
          "expired",
          "received",
          "rejected",
        ].includes(op.phase) &&
          clock(op.created) &&
          clock(op.expires) &&
          op.expires > op.created &&
          op.expires - op.created <= SITE_CONTRIBUTION_LIMITS.lifetimeMs,
        "fase ou validade",
      );
      insist(
        exactShape(op.target, [
          "site",
          "snapshotId",
          "revisionId",
          "pageId",
          "formId",
        ]),
        "alvo",
      );
      parseSiteAddress(op.target.site);
      insist(hashID(op.target.revisionId), "revisão");
      parseContributionFormLookup({
        action: "form",
        snapshotId: op.target.snapshotId,
        pageId: op.target.pageId,
        formId: op.target.formId,
      });
      insist(
        op.certificateId === null || hashID(op.certificateId),
        "certificado",
      );
      insist(
        op.phase !== "prepared" || op.certificateId === null,
        "assinatura antes da preparação",
      );
      insist(
        op.phase !== "signed" || hashID(op.certificateId),
        "assinatura em falta",
      );
      if (Object.hasOwn(op, "transport")) {
        insist(
          !active(op) &&
            hashID(op.certificateId) &&
            exactShape(op.transport, [
              "bundleId",
              "bundleHash",
              "bytes",
              "copied",
            ]),
          "transporte inválido",
        );
        const t = op.transport!;
        insist(
          hashID(t.bundleId) &&
            hashID(t.bundleHash) &&
            positive(t.bytes) &&
            t.bytes <= CONTRIBUTION_JOURNAL_LIMITS.stageBytes &&
            typeof t.copied === "boolean",
          "descritor de transporte",
        );
      }
      if (Object.hasOwn(op, "receipt")) {
        bindReceipt(op, ownerId, op.receipt);
        insist(
          ["received", "rejected", "cancelled", "expired"].includes(op.phase),
          "recibo ainda em fila",
        );
      }
      if (Object.hasOwn(op, "rejection")) {
        bindRejection(op, ownerId, op.rejection);
        insist(
          ["rejected", "cancelled", "expired"].includes(op.phase),
          "recusa ainda em fila",
        );
      }
      insist(op.phase !== "rejected" || op.rejection, "recusa sem prova");
      insist(op.phase !== "received" || op.receipt, "recepção sem recibo");
      if (op.phase === "queued") {
        insist(op.transport, "intenção de transporte em falta");
        queued++;
        queuedBytes += op.transport.bytes;
      }
      if (active(op)) pending++;
      last = op.sequence;
      seen.add(op.operationId);
    }
    insist(pending <= 1, "preparação já pendente");
    insist(
      queued <= CONTRIBUTION_JOURNAL_LIMITS.queued &&
        queuedBytes <= CONTRIBUTION_JOURNAL_LIMITS.queuedBytes,
      "orçamento da fila",
    );
    insist(
      new TextEncoder().encode(canonical(r)).length <=
        CONTRIBUTION_JOURNAL_LIMITS.bytes,
      "orçamento",
    );
    return JSON.parse(canonical(r));
  }
  function lookup(
    input: unknown,
    ownerId: string,
    sequence: number,
    operationId: string,
  ) {
    const record = validate(input, ownerId);
    insist(positive(sequence) && uuid(operationId), "identificador do pedido");
    const bySequence = record.operations.find((op) => op.sequence === sequence),
      byId = record.operations.find((op) => op.operationId === operationId);
    insist(
      (!bySequence || bySequence.operationId === operationId) &&
        (!byId || byId.sequence === sequence),
      "UUID ou sequência reutilizado",
    );
    return {
      record,
      operation: bySequence ?? null,
      retired: sequence < record.nextSequence && !bySequence,
    };
  }
  function prepare(
    input: unknown,
    ownerId: string,
    raw: unknown,
    context: ContributionFormContext,
    now: number,
  ) {
    const checked = request(raw, ownerId),
      q = checked.request,
      found = lookup(input, ownerId, q.sequence, q.operationId),
      record = found.record;
    if (found.operation) {
      insist(
        found.operation.fingerprint === checked.fingerprint,
        "pedido repetido com outros valores",
      );
      return { record, operation: found.operation };
    }
    insist(
      !found.retired &&
        q.sequence === record.nextSequence &&
        !record.operations.some(active) &&
        record.nextSequence < Number.MAX_SAFE_INTEGER,
      "pedido retirado ou preparação pendente",
    );
    insist(
      record.operations.length < CONTRIBUTION_JOURNAL_LIMITS.operations ||
        record.operations[0].phase !== "queued",
      "a janela retida ainda contém envios pendentes",
    );
    protocol.authorizeContext(context, ownerId, now);
    insist(
      q.snapshotId === context.target.snapshotId &&
        q.pageId === context.target.pageId &&
        q.formId === context.target.formId,
      "snapshot diferente",
    );
    matchContributionValues(context.form, context.table, q.values);
    const siteOwner = parseSiteAddress(context.target.site).ownerId;
    insist(
      q.publicationScope === "public" || q.publicationScope.includes(siteOwner),
      "dono do site em falta na concessão",
    );
    const expires = Math.min(now + q.ttlMs, context.snapshotExpires);
    insist(clock(expires) && expires - now >= 1000, "prazo insuficiente");
    const operation: ContributionOperation = {
      sequence: q.sequence,
      operationId: q.operationId,
      fingerprint: checked.fingerprint,
      phase: "prepared",
      target: structuredClone(context.target),
      schemaHash: protocol.schemaHash(context.form, context.table),
      created: now,
      expires,
      certificateId: null,
    };
    record.operations.push(operation);
    record.nextSequence++;
    if (record.operations.length > CONTRIBUTION_JOURNAL_LIMITS.operations)
      record.operations.splice(
        0,
        record.operations.length - CONTRIBUTION_JOURNAL_LIMITS.operations,
      );
    return {
      record: validate(record, ownerId),
      operation: structuredClone(operation),
    };
  }
  function handle(
    input: unknown,
    ownerId: string,
    op: Pick<ContributionOperation, "sequence" | "operationId" | "fingerprint">,
  ) {
    const found = lookup(input, ownerId, op.sequence, op.operationId);
    insist(
      found.operation && found.operation.fingerprint === op.fingerprint,
      "resultado desconhecido",
    );
    return { record: found.record, operation: found.operation };
  }
  function boundCertificate(
    input: unknown,
    ownerId: string,
    op: ContributionOperation,
    raw: unknown,
    certificate: SiteContribution,
  ) {
    const found = handle(input, ownerId, op),
      checked = request(raw, ownerId),
      cert = protocol.verify(certificate),
      b = cert.body;
    insist(
      checked.fingerprint === found.operation.fingerprint &&
        checked.request.sequence === op.sequence &&
        checked.request.operationId === op.operationId,
      "intenção diferente",
    );
    insist(
      b.contributor.id === ownerId &&
        b.operationId === op.operationId &&
        canonical(b.target) === canonical(found.operation.target) &&
        b.schemaHash === found.operation.schemaHash &&
        b.created === found.operation.created &&
        b.expires === found.operation.expires &&
        canonical(b.values) === canonical(checked.request.values) &&
        canonical(b.publicationScope) ===
          canonical(checked.request.publicationScope),
      "certificado diferente da intenção",
    );
    insist(
      found.operation.certificateId === null ||
        found.operation.certificateId === cert.id,
      "certificado retido diferente",
    );
    return { ...found, certificate: cert };
  }
  function checkCertificate(
    input: unknown,
    ownerId: string,
    op: ContributionOperation,
    raw: unknown,
    certificate: SiteContribution,
  ) {
    return boundCertificate(input, ownerId, op, raw, certificate).certificate;
  }
  function signed(
    input: unknown,
    ownerId: string,
    op: ContributionOperation,
    raw: unknown,
    certificate: SiteContribution,
  ) {
    const found = boundCertificate(input, ownerId, op, raw, certificate),
      cert = found.certificate;
    insist(
      found.operation.phase === "prepared" ||
        (found.operation.phase === "signed" &&
          found.operation.certificateId === cert.id),
      "assinatura não autorizada",
    );
    const current = found.record.operations.find(
      (v) => v.sequence === op.sequence,
    )!;
    current.phase = "signed";
    current.certificateId = cert.id;
    return {
      record: validate(found.record, ownerId),
      operation: structuredClone(current),
    };
  }
  function queue(
    input: unknown,
    ownerId: string,
    op: ContributionOperation,
    descriptor: Omit<NonNullable<ContributionOperation["transport"]>, "copied">,
  ) {
    const found = handle(input, ownerId, op);
    insist(
      exactShape(descriptor, ["bundleId", "bundleHash", "bytes"]),
      "descritor de fila",
    );
    if (found.operation.phase === "queued") {
      const { copied: _copied, ...retained } = found.operation.transport!;
      insist(
        canonical(retained) === canonical(descriptor),
        "envelope repetido com outros bytes",
      );
      return found;
    }
    insist(
      found.operation.phase === "signed" &&
        hashID(found.operation.certificateId),
      "proposta ainda não assinada",
    );
    const current = found.record.operations.find(
      (v) => v.sequence === op.sequence,
    )!;
    current.phase = "queued";
    current.transport = { ...descriptor, copied: false };
    return {
      record: validate(found.record, ownerId),
      operation: structuredClone(current),
    };
  }
  function copied(
    input: unknown,
    ownerId: string,
    op: ContributionOperation,
    bundleHash: string,
  ) {
    const found = handle(input, ownerId, op);
    insist(
      found.operation.phase === "queued" &&
        found.operation.transport?.bundleHash === bundleHash,
      "cópia diferente ou não autorizada",
    );
    const current = found.record.operations.find(
      (v) => v.sequence === op.sequence,
    )!;
    current.transport!.copied = true;
    return {
      record: validate(found.record, ownerId),
      operation: structuredClone(current),
    };
  }
  function expire(input: unknown, ownerId: string, now: number) {
    const r = validate(input, ownerId);
    insist(clock(now), "relógio");
    for (const op of r.operations)
      if ((active(op) || op.phase === "queued") && op.expires <= now)
        op.phase = "expired";
    return validate(r, ownerId);
  }
  function cancel(input: unknown, ownerId: string, op: ContributionOperation) {
    const found = handle(input, ownerId, op);
    insist(
      active(found.operation) ||
        found.operation.phase === "queued" ||
        found.operation.phase === "cancelled",
      "resultado terminal",
    );
    found.record.operations.find((v) => v.sequence === op.sequence)!.phase =
      "cancelled";
    return validate(found.record, ownerId);
  }
  function receive(
    input: unknown,
    ownerId: string,
    certificate: unknown,
    now: number,
  ) {
    const record = validate(input, ownerId),
      receipt = receipts.verify(certificate),
      op = record.operations.find(
        (op) => op.operationId === receipt.body.operationId,
      );
    insist(
      clock(now) &&
        receipt.body.expires > now &&
        receipt.body.created - now <= SITE_CONTRIBUTION_LIMITS.clockSkewMs,
      "recibo expirado ou futuro",
    );
    if (!op || !outcomeMatches(op, ownerId, receipt))
      throw new UnmatchedContributionReceipt(
        "Recibo sem operação enviada correspondente",
      );
    if (op.receipt) return { record, operation: op, changed: false };
    insist(
      ["queued", "rejected", "cancelled", "expired"].includes(op.phase),
      "operação não autorizada para transporte",
    );
    op.receipt = receipt;
    if (op.phase === "queued") op.phase = "received";
    const next = validate(record, ownerId);
    return {
      record: next,
      operation: next.operations.find((e) => e.sequence === op.sequence)!,
      changed: true,
    };
  }
  function receiveRejection(
    input: unknown,
    ownerId: string,
    certificate: unknown,
    now: number,
  ) {
    const record = validate(input, ownerId),
      rejection = rejections.verify(certificate),
      op = record.operations.find(
        (op) => op.operationId === rejection.body.operationId,
      );
    insist(
      clock(now) &&
        rejection.body.expires > now &&
        rejection.body.decidedAt - now <= SITE_CONTRIBUTION_LIMITS.clockSkewMs,
      "recusa expirada ou futura",
    );
    if (!op || !outcomeMatches(op, ownerId, rejection))
      throw new UnmatchedContributionRejection(
        "Recusa sem operação enviada correspondente",
      );
    if (op.rejection) return { record, operation: op, changed: false };
    insist(
      ["queued", "received", "cancelled", "expired"].includes(op.phase),
      "operação não autorizada para transporte",
    );
    op.rejection = rejection;
    if (op.phase === "queued" || op.phase === "received") op.phase = "rejected";
    const next = validate(record, ownerId);
    return {
      record: next,
      operation: next.operations.find((e) => e.sequence === op.sequence)!,
      changed: true,
    };
  }
  return {
    receiveRejection,
    receive,
    initial,
    validate,
    request,
    lookup,
    prepare,
    signed,
    checkCertificate,
    queue,
    copied,
    expire,
    cancel,
  };
}
