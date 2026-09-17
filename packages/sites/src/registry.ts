import { canonical, exactShape } from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import {
  createSiteRevisionProtocol,
  siteAddress,
  SITE_REVISION_LIMITS,
  type SiteRevision,
} from "./protocol";

export const SITE_REGISTRY_LIMITS = Object.freeze({
  headers: 128,
  bundlesPerRevision: 4,
  operations: 32,
  recordBytes: 480 * 1024,
});
export interface StoredRevision {
  revision: SiteRevision;
  bundles: string[];
}
export interface SiteOperation {
  sequence: number;
  operationId: string;
  fingerprint: string;
  expectedBase: string;
  revision: SiteRevision;
  bundleId: string;
  requestFingerprint?: string;
  phase:
    "prepared" | "committed" | "ready" | "cancelled" | "superseded" | "expired";
}
export interface SiteRecord {
  domain: "relayloom/site-record/1";
  ownerId: string;
  name: string;
  counter: number;
  headers: StoredRevision[];
  operations: SiteOperation[];
}
export interface SiteReservation {
  sequence: number;
  operationId: string;
  fingerprint: string;
  expectedBase: string;
  revision: SiteRevision;
  bundleId: string;
  requestFingerprint?: string;
}
const operationShape = (value: unknown, keys: string[]) =>
  exactShape(value, keys) || exactShape(value, [...keys, "requestFingerprint"]);
const address = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const operationID = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function requireThat(value: unknown, error: string): asserts value {
  if (!value) throw new Error(error);
}
function list(value: unknown, maximum: number): asserts value is unknown[] {
  requireThat(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= maximum,
    "Lista de registo de site inválida",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from(
        { length: value.length },
        (_, i) => descriptors[String(i)],
      ).every((d) => d && "value" in d),
    "Lista de registo de site inválida",
  );
}
function sortedIDs(value: unknown, maximum: number): asserts value is string[] {
  list(value, maximum);
  requireThat(
    value.every(
      (id, i) => address(id) && (i === 0 || String(value[i - 1]) < id),
    ),
    "Identificadores do registo não canónicos",
  );
}

/** Pure state transitions. Callers commit the returned record atomically with
 * staged payloads. Reserving a sequence is not publication or permission to seed.
 * A durable counter makes retired operation IDs fail instead of executing again. */
function registryModel(crypto: CertificateCrypto) {
  const protocol = createSiteRevisionProtocol(crypto),
    encoder = new TextEncoder();
  const recordKey = (ownerId: string, name: string) =>
    "site:" + crypto.hash(siteAddress(ownerId, name));
  function initial(ownerId: string, name: string): SiteRecord {
    siteAddress(ownerId, name);
    return {
      domain: "relayloom/site-record/1",
      ownerId,
      name,
      counter: 0,
      headers: [],
      operations: [],
    };
  }
  function validate(input: unknown, ownerId: string, name: string): SiteRecord {
    siteAddress(ownerId, name);
    requireThat(
      exactShape(input, [
        "domain",
        "ownerId",
        "name",
        "counter",
        "headers",
        "operations",
      ]),
      "Registo de site inválido",
    );
    const value = input as SiteRecord;
    requireThat(
      value.domain === "relayloom/site-record/1" &&
        value.ownerId === ownerId &&
        value.name === name &&
        Number.isSafeInteger(value.counter) &&
        value.counter >= 0 &&
        value.counter <= SITE_REVISION_LIMITS.sequence,
      "Contexto do registo de site inválido",
    );
    list(value.headers, SITE_REGISTRY_LIMITS.headers);
    list(value.operations, SITE_REGISTRY_LIMITS.operations);
    const headers = new Set<string>(),
      sequences = new Set<number>(),
      operationIDs = new Set<string>();
    for (const entry of value.headers) {
      requireThat(
        exactShape(entry, ["revision", "bundles"]),
        "Cabeçalho guardado inválido",
      );
      const revision = protocol.verifyRevision(entry.revision);
      requireThat(
        revision.body.owner.id === ownerId &&
          revision.body.name === name &&
          revision.body.number <= value.counter &&
          !headers.has(revision.id),
        "Cabeçalho de outro site ou repetido",
      );
      sortedIDs(entry.bundles, SITE_REGISTRY_LIMITS.bundlesPerRevision);
      headers.add(revision.id);
    }
    let prepared = 0;
    for (const entry of value.operations) {
      requireThat(
        operationShape(entry, [
          "sequence",
          "operationId",
          "fingerprint",
          "expectedBase",
          "revision",
          "bundleId",
          "phase",
        ]),
        "Operação de site inválida",
      );
      const revision = protocol.verifyRevision(entry.revision);
      requireThat(
        operationID(entry.operationId) &&
          !operationIDs.has(entry.operationId) &&
          address(entry.fingerprint) &&
          address(entry.expectedBase) &&
          address(entry.bundleId) &&
          (entry.requestFingerprint === undefined ||
            address(entry.requestFingerprint)) &&
          [
            "prepared",
            "committed",
            "ready",
            "cancelled",
            "superseded",
            "expired",
          ].includes(entry.phase) &&
          Number.isSafeInteger(entry.sequence) &&
          entry.sequence === revision.body.number &&
          entry.sequence <= value.counter &&
          !sequences.has(entry.sequence) &&
          revision.body.owner.id === ownerId &&
          revision.body.name === name,
        "Operação de outro contexto ou inválida",
      );
      if (entry.phase === "prepared" || entry.phase === "committed") prepared++;
      sequences.add(entry.sequence);
      operationIDs.add(entry.operationId);
    }
    requireThat(prepared <= 1, "Mais de uma publicação pendente no site");
    protocol.classifyRevisions(
      ownerId,
      name,
      value.headers.map((entry) => entry.revision),
    );
    requireThat(
      encoder.encode(canonical(value)).length <=
        SITE_REGISTRY_LIMITS.recordBytes,
      "Registo de site excede o limite",
    );
    return value;
  }
  const checked = (value: SiteRecord) => {
    requireThat(
      exactShape(value, [
        "domain",
        "ownerId",
        "name",
        "counter",
        "headers",
        "operations",
      ]),
      "Registo de site inválido",
    );
    return validate(value, value.ownerId, value.name);
  };
  const clone = (value: SiteRecord) => structuredClone(checked(value));
  function state(value: SiteRecord) {
    checked(value);
    const selection = protocol.classifyRevisions(
      value.ownerId,
      value.name,
      value.headers.map((entry) => entry.revision),
    );
    return {
      ...structuredClone(selection),
      nextSequence:
        value.counter < SITE_REVISION_LIMITS.sequence
          ? value.counter + 1
          : null,
      address: siteAddress(value.ownerId, value.name),
    };
  }
  function baseHash(value: SiteRecord) {
    const current = state(value);
    return crypto.hash(
      canonical({
        domain: "relayloom/site-base/1",
        ownerId: value.ownerId,
        name: value.name,
        heads: current.heads.map((header) => header.id),
      }),
    );
  }
  function append(
    value: SiteRecord,
    revision: SiteRevision,
    bundleId?: string,
  ) {
    const existing = value.headers.find(
      (entry) => entry.revision.id === revision.id,
    );
    if (existing && bundleId)
      existing.bundles = [...new Set([...existing.bundles, bundleId])]
        .sort()
        .slice(-SITE_REGISTRY_LIMITS.bundlesPerRevision);
    else if (!existing)
      value.headers.push({
        revision: structuredClone(revision),
        bundles: bundleId ? [bundleId] : [],
      });
    value.counter = Math.max(value.counter, revision.body.number);
    value.headers.sort(
      (a, b) =>
        b.revision.body.number - a.revision.body.number ||
        (a.revision.id < b.revision.id
          ? -1
          : a.revision.id > b.revision.id
            ? 1
            : 0),
    );
    const highest = value.headers[0].revision.body.number;
    requireThat(
      value.headers.filter((entry) => entry.revision.body.number === highest)
        .length <= SITE_REGISTRY_LIMITS.headers,
      "Demasiadas revisões concorrentes",
    );
    value.headers = value.headers.slice(0, SITE_REGISTRY_LIMITS.headers);
  }
  function observe(
    value: SiteRecord,
    revision: SiteRevision,
    bundleId: string,
  ) {
    const next = clone(value);
    protocol.verifyRevision(revision);
    requireThat(address(bundleId), "Bundle de site inválido");
    requireThat(
      revision.body.owner.id === value.ownerId &&
        revision.body.name === value.name,
      "Revisão de outro site",
    );
    append(next, revision, bundleId);
    return checked(next);
  }
  function lookup(
    value: SiteRecord,
    sequence: number,
    id: string,
    fingerprint: string,
  ): SiteOperation | undefined {
    checked(value);
    requireThat(
      Number.isSafeInteger(sequence) &&
        sequence >= 1 &&
        sequence <= SITE_REVISION_LIMITS.sequence &&
        operationID(id) &&
        address(fingerprint),
      "Pedido de publicação inválido",
    );
    const operation = value.operations.find(
      (entry) => entry.sequence === sequence,
    );
    if (operation) {
      requireThat(
        operation.operationId === id && operation.fingerprint === fingerprint,
        "A operação já foi usada para outra publicação",
      );
      return structuredClone(operation);
    }
    requireThat(
      !value.operations.some((entry) => entry.operationId === id),
      "A operação já foi usada noutra sequência",
    );
    requireThat(
      sequence > value.counter,
      "Operação de publicação antiga ou desconhecida",
    );
    return undefined;
  }
  function begin(value: SiteRecord, request: SiteReservation) {
    requireThat(
      operationShape(request, [
        "sequence",
        "operationId",
        "fingerprint",
        "expectedBase",
        "revision",
        "bundleId",
      ]),
      "Reserva de publicação inválida",
    );
    requireThat(
      request.requestFingerprint === undefined ||
        address(request.requestFingerprint),
      "Pedido de publicação inválido",
    );
    const previous = lookup(
      value,
      request.sequence,
      request.operationId,
      request.fingerprint,
    );
    if (previous)
      return { record: clone(value), operation: previous, created: false };
    const next = clone(value),
      current = state(value);
    requireThat(
      request.sequence === current.nextSequence &&
        request.expectedBase === baseHash(value),
      "O site mudou desde que começaste a editar",
    );
    requireThat(
      !next.operations.some(
        (entry) => entry.phase === "prepared" || entry.phase === "committed",
      ),
      "Conclui ou cancela a publicação pendente",
    );
    const revision = protocol.verifyRevision(request.revision);
    requireThat(
      address(request.bundleId) &&
        revision.body.owner.id === value.ownerId &&
        revision.body.name === value.name &&
        revision.body.number === request.sequence &&
        canonical(revision.body.previous) ===
          canonical(
            current.heads
              .map((head) => head.id)
              .sort()
              .slice(0, SITE_REVISION_LIMITS.predecessors),
          ),
      "Certificado não corresponde à reserva",
    );
    const operation: SiteOperation = {
      sequence: request.sequence,
      operationId: request.operationId,
      fingerprint: request.fingerprint,
      expectedBase: request.expectedBase,
      revision: structuredClone(revision),
      bundleId: request.bundleId,
      phase: "prepared",
      ...(request.requestFingerprint !== undefined
        ? { requestFingerprint: request.requestFingerprint }
        : {}),
    };
    next.counter = request.sequence;
    next.operations.sort((a, b) => a.sequence - b.sequence);
    next.operations = next.operations.slice(
      -(SITE_REGISTRY_LIMITS.operations - 1),
    );
    next.operations.push(operation);
    return {
      record: checked(next),
      operation: structuredClone(operation),
      created: true,
    };
  }
  /** Authorization commits before any payload is placed in a seedable store.
   * The caller persists this result and the private staging record atomically. */
  function commit(
    value: SiteRecord,
    sequence: number,
    id: string,
    fingerprint: string,
  ) {
    const prior = lookup(value, sequence, id, fingerprint);
    requireThat(prior, "Publicação não reservada");
    if (prior.phase !== "prepared")
      return { record: clone(value), operation: prior };
    const next = clone(value),
      operation = next.operations.find((entry) => entry.sequence === sequence)!;
    operation.phase =
      baseHash(value) !== prior.expectedBase ? "superseded" : "committed";
    if (operation.phase === "committed") append(next, operation.revision);
    return { record: checked(next), operation: structuredClone(operation) };
  }
  /** A durable authorization cannot be recalled by cancelling a local task. */
  function cancel(
    value: SiteRecord,
    sequence: number,
    id: string,
    fingerprint: string,
  ) {
    const prior = lookup(value, sequence, id, fingerprint);
    requireThat(prior, "Publicação não reservada");
    if (prior.phase !== "prepared")
      return { record: clone(value), operation: prior };
    const next = clone(value),
      operation = next.operations.find((entry) => entry.sequence === sequence)!;
    operation.phase = "cancelled";
    return { record: checked(next), operation: structuredClone(operation) };
  }
  /** Caller has successfully copied the exact authorized bundle to its public
   * store. Losing that store later changes availability, never signed authority. */
  function markReady(
    value: SiteRecord,
    sequence: number,
    id: string,
    fingerprint: string,
  ) {
    const prior = lookup(value, sequence, id, fingerprint);
    requireThat(
      prior && ["committed", "ready"].includes(prior.phase),
      "Publicação sem autorização durável",
    );
    const next = clone(value),
      operation = next.operations.find((entry) => entry.sequence === sequence)!;
    operation.phase = "ready";
    append(next, operation.revision, operation.bundleId);
    return { record: checked(next), operation: structuredClone(operation) };
  }
  /** Caller verified the original bundle deadline. Expiry stops future copying,
   * preserves any already-authorized head and never reuses its sequence. */
  function expire(
    value: SiteRecord,
    sequence: number,
    id: string,
    fingerprint: string,
  ) {
    const prior = lookup(value, sequence, id, fingerprint);
    requireThat(prior, "Publicação não reservada");
    if (!["prepared", "committed"].includes(prior.phase))
      return { record: clone(value), operation: prior };
    const next = clone(value),
      operation = next.operations.find((o) => o.sequence === sequence)!;
    operation.phase = "expired";
    return { record: checked(next), operation: structuredClone(operation) };
  }
  return {
    recordKey,
    initial,
    validate,
    state,
    baseHash,
    observe,
    lookup,
    begin,
    commit,
    cancel,
    markReady,
    expire,
  };
}

/** Cache only successful cryptographic checks within one immutable synchronous
 * transition. No result survives into another read/write operation. All shapes,
 * limits, contextual relationships and resulting records remain checked. */
export function createSiteRegistry(
  crypto: CertificateCrypto,
): ReturnType<typeof registryModel> {
  type API = ReturnType<typeof registryModel>;
  function scoped() {
    const identities = new Set<string>(),
      signatures = new Set<string>();
    const adapter: CertificateCrypto = {
      ...crypto,
      validateIdentity(card) {
        const safe =
          exactShape(card, ["id", "name", "signKey", "boxKey", "proof"]) &&
          Object.values(card).every(
            (v) => typeof v === "string" && v.length <= 4096,
          );
        if (!safe) return crypto.validateIdentity(card);
        const key = canonical(card);
        if (identities.has(key)) return true;
        const valid = crypto.validateIdentity(card);
        if (valid) identities.add(key);
        return valid;
      },
      verify(card, text, signature) {
        const key = canonical([card.signKey, text, Array.from(signature)]);
        if (signatures.has(key)) return true;
        const valid = crypto.verify(card, text, signature);
        if (valid) signatures.add(key);
        return valid;
      },
    };
    return registryModel(adapter);
  }
  const names = Object.keys(registryModel(crypto)) as (keyof API)[];
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) => {
        const instance = scoped();
        return Reflect.apply(instance[name], undefined, args);
      },
    ]),
  ) as API;
}
