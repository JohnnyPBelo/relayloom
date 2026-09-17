import {
  canonical,
  exactShape,
  type Identity,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";

export const SITE_REVISION_LIMITS = Object.freeze({
  certificateBytes: 4096,
  predecessors: 16,
  headers: 1024,
  sequence: Number.MAX_SAFE_INTEGER,
  payloadBytes: 3_500_000,
});
export interface SiteRevisionBody {
  domain: "relayloom/site-snapshot/1";
  owner: PublicIdentity;
  name: string;
  number: number;
  previous: string[];
  documentHash: string;
}
export interface SiteRevision {
  body: SiteRevisionBody;
  id: string;
  signature: string;
}
export interface SiteAddress {
  ownerId: string;
  name: string;
}
function requireThat(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function address(value: unknown): asserts value is string {
  requireThat(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Identificador de site inválido",
  );
}
function siteName(value: unknown): asserts value is string {
  requireThat(
    typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(value),
    "Nome estável de site inválido",
  );
}
function list(value: unknown, maximum: number): asserts value is unknown[] {
  requireThat(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= maximum,
    "Lista de revisões fora dos limites",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from(
        { length: value.length },
        (_, i) => descriptors[String(i)],
      ).every((d) => d && "value" in d),
    "Lista de revisões inválida",
  );
}
export function siteAddress(ownerId: string, name: string): string {
  address(ownerId);
  siteName(name);
  return "relayloom:site:" + ownerId + "/" + name;
}
export function parseSiteAddress(value: unknown): SiteAddress {
  requireThat(
    typeof value === "string" && value.length <= 120,
    "Endereço de site inválido",
  );
  const match = /^relayloom:site:([a-f0-9]{64})\/([a-z][a-z0-9-]{0,39})$/.exec(
    value,
  );
  requireThat(match, "Endereço de site inválido");
  return { ownerId: match[1], name: match[2] };
}

/** Every revision authorises a complete snapshot, not a patch requiring lost
 * ancestors. Previous IDs retain verifiable history when available. The owner
 * explicitly supersedes lower-numbered snapshots; no wall clock grants authority.
 * Storage/adoption, operation idempotence and stale-draft CAS are separate layers. */
export function createSiteRevisionProtocol(crypto: CertificateCrypto) {
  const encoder = new TextEncoder();
  function bounded(value: unknown, maximum: number) {
    const text = canonical(value);
    requireThat(
      encoder.encode(text).length <= maximum,
      "Revisão de site demasiado grande",
    );
    return text;
  }
  function body(value: unknown): asserts value is SiteRevisionBody {
    requireThat(
      exactShape(value, [
        "domain",
        "owner",
        "name",
        "number",
        "previous",
        "documentHash",
      ]),
      "Campos da revisão inválidos",
    );
    const candidate = value as SiteRevisionBody;
    requireThat(
      candidate.domain === "relayloom/site-snapshot/1",
      "Domínio de assinatura de site inválido",
    );
    requireThat(
      crypto.validateIdentity(candidate.owner),
      "Proprietário de site inválido",
    );
    siteName(candidate.name);
    requireThat(
      Number.isSafeInteger(candidate.number) &&
        candidate.number >= 1 &&
        candidate.number <= SITE_REVISION_LIMITS.sequence,
      "Número de revisão inválido",
    );
    address(candidate.documentHash);
    list(candidate.previous, SITE_REVISION_LIMITS.predecessors);
    for (const id of candidate.previous) address(id);
    requireThat(
      candidate.previous.every(
        (id, i) => i === 0 || candidate.previous[i - 1] < id,
      ),
      "Antecessores de site não canónicos",
    );
    requireThat(
      candidate.number !== 1 || candidate.previous.length === 0,
      "A primeira revisão não tem antecessores",
    );
    bounded(candidate, SITE_REVISION_LIMITS.certificateBytes);
  }
  function signature(value: unknown): Uint8Array {
    requireThat(
      typeof value === "string" && value.length === 88,
      "Assinatura de revisão inválida",
    );
    const bytes = Uint8Array.from(atob(value), (character) =>
      character.charCodeAt(0),
    );
    requireThat(
      bytes.length === 64 && btoa(String.fromCharCode(...bytes)) === value,
      "Assinatura de revisão não canónica",
    );
    return bytes;
  }
  function verifyRevision(value: unknown): SiteRevision {
    requireThat(
      exactShape(value, ["body", "id", "signature"]),
      "Certificado de site inválido",
    );
    const revision = value as SiteRevision;
    body(revision.body);
    address(revision.id);
    const signed = bounded(
      revision.body,
      SITE_REVISION_LIMITS.certificateBytes,
    );
    requireThat(
      revision.id === crypto.hash(signed),
      "Hash da revisão não coincide",
    );
    requireThat(
      crypto.verify(revision.body.owner, signed, signature(revision.signature)),
      "Assinatura de site inválida",
    );
    requireThat(
      !revision.body.previous.includes(revision.id),
      "Revisão de site circular",
    );
    bounded(revision, SITE_REVISION_LIMITS.certificateBytes);
    return revision;
  }
  function createRevision(
    identity: Identity,
    name: string,
    number: number,
    previous: string[],
    documentHash: string,
  ): SiteRevision {
    list(previous, SITE_REVISION_LIMITS.predecessors);
    const value: SiteRevisionBody = {
      domain: "relayloom/site-snapshot/1",
      owner: identity.public,
      name,
      number,
      previous: [...previous],
      documentHash,
    };
    body(value);
    value.owner = structuredClone(value.owner);
    const text = bounded(value, SITE_REVISION_LIMITS.certificateBytes);
    const result: SiteRevision = {
      body: value,
      id: crypto.hash(text),
      signature: crypto.sign(identity, text),
    };
    verifyRevision(result);
    return result;
  }
  function createSuccessor(
    identity: Identity,
    name: string,
    parents: SiteRevision[],
    documentHash: string,
  ) {
    siteName(name);
    list(parents, SITE_REVISION_LIMITS.predecessors);
    for (const parent of parents) {
      verifyRevision(parent);
      requireThat(
        parent.body.owner.id === identity.public.id &&
          parent.body.name === name,
        "Antecessor de outro proprietário ou site",
      );
    }
    const number =
      Math.max(0, ...parents.map((parent) => parent.body.number)) + 1;
    return createRevision(
      identity,
      name,
      number,
      [...new Set(parents.map((parent) => parent.id))].sort(),
      documentHash,
    );
  }
  /** Hash only a fully validated complete authored payload. Resource/schema
   * validation must happen before calling this helper or rendering the payload. */
  function documentHash(payload: unknown) {
    return crypto.hash(
      bounded(
        { domain: "relayloom/site-document/1", payload },
        SITE_REVISION_LIMITS.payloadBytes,
      ),
    );
  }
  function verifySnapshot(
    value: unknown,
    payload: unknown,
    ownerId: string,
    name: string,
  ): SiteRevision {
    address(ownerId);
    siteName(name);
    const revision = verifyRevision(value);
    requireThat(
      revision.body.owner.id === ownerId && revision.body.name === name,
      "A revisão pertence a outro site",
    );
    requireThat(
      revision.body.documentHash === documentHash(payload),
      "O documento não corresponde à revisão assinada",
    );
    return revision;
  }
  function historyLink(child: SiteRevision, parent: SiteRevision) {
    requireThat(
      child.body.owner.id === parent.body.owner.id &&
        child.body.name === parent.body.name &&
        parent.body.number < child.body.number &&
        child.body.previous.includes(parent.id),
      "Ligação de histórico inválida",
    );
  }
  function verifyHistoryLink(child: SiteRevision, parent: SiteRevision) {
    verifyRevision(child);
    verifyRevision(parent);
    historyLink(child, parent);
  }
  /** Inputs include persisted verified headers whose payload may have been
   * evicted. A missing newer payload must never silently reveal an older version.
   * A head classification alone is not permission to render: verifySnapshot binds
   * the actual payload, and the application must also verify its transport bundle. */
  function classifyRevisions(ownerId: string, name: string, values: unknown) {
    address(ownerId);
    siteName(name);
    list(values, SITE_REVISION_LIMITS.headers);
    const revisions = new Map<string, SiteRevision>();
    for (const value of values) {
      const revision = verifyRevision(value);
      requireThat(
        revision.body.owner.id === ownerId && revision.body.name === name,
        "Histórico de outro site",
      );
      revisions.set(revision.id, revision);
    }
    for (const revision of revisions.values())
      for (const id of revision.body.previous) {
        const parent = revisions.get(id);
        if (parent) historyLink(revision, parent);
      }
    if (!revisions.size)
      return {
        status: "empty" as const,
        number: 0,
        heads: [] as SiteRevision[],
        missingHistory: [] as string[],
      };
    const number = Math.max(
      ...[...revisions.values()].map((r) => r.body.number),
    );
    const heads = [...revisions.values()]
      .filter((r) => r.body.number === number)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const missing = new Set<string>(),
      seen = new Set<string>(),
      queue = [...heads];
    while (queue.length) {
      const revision = queue.pop()!;
      if (seen.has(revision.id)) continue;
      seen.add(revision.id);
      for (const id of revision.body.previous) {
        const parent = revisions.get(id);
        if (parent) queue.push(parent);
        else missing.add(id);
      }
    }
    return {
      status: heads.length === 1 ? ("head" as const) : ("conflict" as const),
      number,
      heads,
      missingHistory: [...missing].sort(),
    };
  }
  return {
    createRevision,
    createSuccessor,
    verifyRevision,
    documentHash,
    verifySnapshot,
    verifyHistoryLink,
    classifyRevisions,
  };
}
