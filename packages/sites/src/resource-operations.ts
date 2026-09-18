import { canonical, exactShape } from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import {
  parseSiteResource,
  parseSiteResourceReference,
  describeSiteResource,
  type SiteResource,
  type SiteResourceReference,
  type SiteReadScope,
} from "../../content/src/site-resource";

/** Local creation journal, not a network authority certificate. Runtimes must
 * keep it in signing-owned authenticated transactions and verify staged bundles
 * before calling these transitions. A read key never authorises creation. */
export const RESOURCE_OPERATION_LIMIT = 128;
export const RESOURCE_RECORD_BYTES = 1024 * 1024;
export interface ResourceCreationRequest {
  sequence: number;
  operationId: string;
  content: SiteResource;
  recipients: SiteReadScope;
  ttlMs: number;
}
export interface ResourceOperation {
  sequence: number;
  operationId: string;
  fingerprint: string;
  phase: "copy-pending" | "ready" | "expired";
  reference: SiteResourceReference;
  recipients: SiteReadScope;
  ttlMs: number;
  created: number;
  expires: number;
  bundleHash: string;
}
export interface ResourceCreationRecord {
  domain: "relayloom/resource-creation/1";
  ownerId: string;
  nextSequence: number;
  operations: ResourceOperation[];
}
const address = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const operationID = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error("Operação de recurso inválida: " + message);
}
function dense(value: unknown, max: number): asserts value is unknown[] {
  insist(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= max,
    "limite de lista",
  );
  const d = Object.getOwnPropertyDescriptors(value);
  insist(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from({ length: value.length }, (_, i) => d[String(i)]).every(
        (p) => p && "value" in p,
      ),
    "lista não canónica",
  );
}
function readers(value: unknown, ownerId: string): SiteReadScope {
  if (value === "public") return value;
  dense(value, 64);
  insist(
    value.length > 0 &&
      value.every(
        (id, i) => address(id) && (i === 0 || (value[i - 1] as string) < id),
      ) &&
      value.includes(ownerId),
    "leitores ou proprietário em falta",
  );
  return [...value] as string[];
}
export function createResourceOperations(
  crypto: Pick<CertificateCrypto, "hash">,
) {
  function fingerprint(
    ownerId: string,
    sequence: number,
    operationId: string,
    payloadHash: string,
    recipients: SiteReadScope,
    ttlMs: number,
  ) {
    return crypto.hash(
      canonical({
        domain: "relayloom/resource-creation-request/1",
        ownerId,
        sequence,
        operationId,
        payloadHash,
        recipients,
        ttlMs,
      }),
    );
  }
  function request(value: unknown, ownerId: string) {
    insist(
      address(ownerId) &&
        exactShape(value, [
          "sequence",
          "operationId",
          "content",
          "recipients",
          "ttlMs",
        ]),
      "pedido",
    );
    const q = value as ResourceCreationRequest;
    insist(
      integer(q.sequence) &&
        operationID(q.operationId) &&
        integer(q.ttlMs) &&
        q.ttlMs >= 1000 &&
        q.ttlMs <= 365 * 86400_000,
      "sequência, UUID ou prazo",
    );
    const content = parseSiteResource(q.content),
      recipients = readers(q.recipients, ownerId),
      payloadHash = crypto.hash(canonical(content));
    const normalized: ResourceCreationRequest = {
      sequence: q.sequence,
      operationId: q.operationId,
      content,
      recipients,
      ttlMs: q.ttlMs,
    };
    return {
      request: normalized,
      fingerprint: fingerprint(
        ownerId,
        q.sequence,
        q.operationId,
        payloadHash,
        recipients,
        q.ttlMs,
      ),
    };
  }
  function initial(ownerId: string): ResourceCreationRecord {
    insist(address(ownerId), "proprietário");
    return {
      domain: "relayloom/resource-creation/1",
      ownerId,
      nextSequence: 1,
      operations: [],
    };
  }
  function validate(value: unknown, ownerId: string): ResourceCreationRecord {
    insist(
      address(ownerId) &&
        exactShape(value, ["domain", "ownerId", "nextSequence", "operations"]),
      "registo",
    );
    const record = value as ResourceCreationRecord;
    insist(
      record.domain === "relayloom/resource-creation/1" &&
        record.ownerId === ownerId &&
        integer(record.nextSequence),
      "contexto ou contador",
    );
    dense(record.operations, RESOURCE_OPERATION_LIMIT);
    insist(
      record.operations.length ===
        Math.min(record.nextSequence - 1, RESOURCE_OPERATION_LIMIT),
      "intervalo de operações",
    );
    const seen = new Set<string>();
    for (const [i, op] of record.operations.entries()) {
      insist(
        exactShape(op, [
          "sequence",
          "operationId",
          "fingerprint",
          "phase",
          "reference",
          "recipients",
          "ttlMs",
          "created",
          "expires",
          "bundleHash",
        ]),
        "campos da operação",
      );
      insist(
        op.sequence === record.nextSequence - record.operations.length + i &&
          operationID(op.operationId) &&
          !seen.has(op.operationId) &&
          address(op.fingerprint) &&
          address(op.bundleHash),
        "identidade da operação",
      );
      seen.add(op.operationId);
      const ref = parseSiteResourceReference(op.reference),
        scope = readers(op.recipients, ownerId);
      insist(
        ref.authorId === ownerId &&
          integer(op.created) &&
          integer(op.expires) &&
          integer(op.ttlMs) &&
          op.ttlMs >= 1000 &&
          op.ttlMs <= 365 * 86400_000 &&
          op.expires - op.created === op.ttlMs,
        "época de criação ou prazo",
      );
      insist(
        ["copy-pending", "ready", "expired"].includes(op.phase) &&
          (op.phase !== "copy-pending" || i === record.operations.length - 1),
        "fase",
      );
      insist(
        op.fingerprint ===
          fingerprint(
            ownerId,
            op.sequence,
            op.operationId,
            ref.payloadHash,
            scope,
            op.ttlMs,
          ),
        "pedido não corresponde à operação",
      );
    }
    const encoded = canonical(record);
    insist(
      new TextEncoder().encode(encoded).length <= RESOURCE_RECORD_BYTES,
      "orçamento do registo",
    );
    return JSON.parse(encoded);
  }
  function lookup(
    value: unknown,
    ownerId: string,
    sequence: number,
    id: string,
  ) {
    const record = validate(value, ownerId);
    insist(integer(sequence) && operationID(id), "identificador do pedido");
    const op = record.operations.find((o) => o.sequence === sequence);
    if (op)
      insist(op.operationId === id, "sequência já atribuída a outro pedido");
    return {
      record,
      operation: op ?? null,
      retired: !op && sequence < record.nextSequence,
    };
  }
  function prepare(
    value: unknown,
    ownerId: string,
    input: unknown,
    staged: {
      reference: unknown;
      created: number;
      expires: number;
      bundleHash: string;
      recipients: SiteReadScope;
    },
  ) {
    const checked = request(input, ownerId),
      q = checked.request,
      prior = lookup(value, ownerId, q.sequence, q.operationId),
      record = prior.record;
    if (prior.operation) {
      insist(
        prior.operation.fingerprint === checked.fingerprint,
        "UUID repetido com outro conteúdo",
      );
      return { record, operation: prior.operation };
    }
    insist(
      !prior.retired &&
        q.sequence === record.nextSequence &&
        record.nextSequence < Number.MAX_SAFE_INTEGER,
      "pedido retirado ou sequência diferente",
    );
    insist(
      !record.operations.some(
        (o) => o.phase === "copy-pending" || o.operationId === q.operationId,
      ),
      "operação pendente ou UUID reutilizado",
    );
    insist(
      exactShape(staged, [
        "reference",
        "created",
        "expires",
        "bundleHash",
        "recipients",
      ]),
      "preparação",
    );
    const ref = parseSiteResourceReference(staged.reference);
    insist(
      canonical(ref) ===
        canonical(
          describeSiteResource(q.content, {
            id: ref.bundleId,
            authorId: ownerId,
            kind: "site-resource",
          }),
        ) &&
        canonical(readers(staged.recipients, ownerId)) ===
          canonical(q.recipients),
      "preparação não corresponde ao pedido",
    );
    const operation: ResourceOperation = {
      sequence: q.sequence,
      operationId: q.operationId,
      fingerprint: checked.fingerprint,
      phase: "copy-pending",
      reference: ref,
      recipients: q.recipients,
      ttlMs: q.ttlMs,
      created: staged.created,
      expires: staged.expires,
      bundleHash: staged.bundleHash,
    };
    record.operations.push(operation);
    record.nextSequence++;
    if (record.operations.length > RESOURCE_OPERATION_LIMIT)
      record.operations.shift();
    return {
      record: validate(record, ownerId),
      operation: JSON.parse(canonical(operation)) as ResourceOperation,
    };
  }
  function ready(
    value: unknown,
    ownerId: string,
    sequence: number,
    id: string,
    digest: string,
    bundleHash: string,
  ) {
    const found = lookup(value, ownerId, sequence, id),
      op = found.operation;
    insist(
      op &&
        ["copy-pending", "ready"].includes(op.phase) &&
        op.fingerprint === digest &&
        op.bundleHash === bundleHash,
      "cópia diferente ou resultado desconhecido",
    );
    op.phase = "ready";
    return validate(found.record, ownerId);
  }
  function expire(value: unknown, ownerId: string, now: number) {
    const record = validate(value, ownerId);
    insist(integer(now), "relógio");
    for (const op of record.operations)
      if (op.phase === "copy-pending" && op.expires <= now)
        op.phase = "expired";
    return record;
  }
  return { request, initial, validate, lookup, prepare, ready, expire };
}
