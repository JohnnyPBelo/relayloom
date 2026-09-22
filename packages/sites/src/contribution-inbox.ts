import {
  createReceiptOperations,
  RECEIPT_STORAGE_LIMITS,
  type ReceiptOperation,
} from "./contribution-receipt-operations";
import {
  canonical,
  exactShape,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { parseSiteAddress } from "./protocol";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type ContributionTarget,
} from "./contribution-protocol";

export const CONTRIBUTION_INBOX_LIMITS = Object.freeze({
  entries: 256,
  pending: 64,
  pendingPerContributor: 32,
  conflicts: 4,
  recordBytes: 1024 * 1024,
  proofBytes: 6 * 1024 * 1024 + 16384,
  totalProofBytes: 32 * 1024 * 1024,
  retentionMs: 30 * 86400_000,
});
export interface ContributionInboxProof {
  bundleId: string;
  envelopeHash: string;
  digest: string;
  bytes: number;
}
export interface ContributionInboxEntry {
  id: string;
  contributorId: string;
  operationId: string;
  target: ContributionTarget;
  created: number;
  expires: number;
  observedAt: number;
  retainUntil: number;
  phase: "missing-source" | "verified-candidate" | "expired" | "dismissed";
  dismissedAt?: number;
  receipt?: ReceiptOperation;
  verifiedAt: number | null;
  expiredAt: number | null;
  proof: ContributionInboxProof | null;
  conflicts: { id: string; expires: number }[];
  conflictOverflow: boolean;
}
export interface ContributionInboxRecord {
  domain: "relayloom/contribution-inbox/1";
  ownerId: string;
  revision: number;
  entries: ContributionInboxEntry[];
}
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const clock = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
const retain = (expires: number) =>
  Math.min(
    Number.MAX_SAFE_INTEGER,
    expires + CONTRIBUTION_INBOX_LIMITS.retentionMs,
  );
const size = (v: unknown) => new TextEncoder().encode(canonical(v)).length;
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error("Inbox de propostas inválida: " + message);
}
function descriptor(value: unknown): asserts value is ContributionInboxProof {
  insist(
    exactShape(value, ["bundleId", "envelopeHash", "digest", "bytes"]),
    "campos da prova",
  );
  const p = value as ContributionInboxProof;
  insist(
    id(p.bundleId) &&
      id(p.envelopeHash) &&
      id(p.digest) &&
      clock(p.bytes) &&
      p.bytes > 0 &&
      p.bytes <= CONTRIBUTION_INBOX_LIMITS.proofBytes,
    "prova ou orçamento",
  );
}

/** Local inbox transitions, never wire authority or owner approval. Catalogues
 * must authenticate the envelope/source and persist their exact bytes together
 * with this record using the signing-owned private transaction. */
export function createContributionInboxProtocol(crypto: CertificateCrypto) {
  const certificates = createSiteContributionProtocol(crypto),
    receipts = createReceiptOperations(crypto);
  function validate(input: unknown, ownerId: string): ContributionInboxRecord {
    insist(
      id(ownerId) &&
        exactShape(input, ["domain", "ownerId", "revision", "entries"]),
      "campos",
    );
    const r = input as ContributionInboxRecord;
    insist(
      r.domain === "relayloom/contribution-inbox/1" &&
        r.ownerId === ownerId &&
        clock(r.revision),
      "dono ou revisão",
    );
    insist(
      Array.isArray(r.entries) &&
        r.entries.length <= CONTRIBUTION_INBOX_LIMITS.entries,
      "entradas",
    );
    const ids = new Set<string>(),
      allCertificates = new Set<string>(),
      operations = new Set<string>(),
      authors = new Map<string, number>();
    let receiptBytes = 0;
    let bytes = 0,
      pending = 0;
    for (const e of r.entries) {
      insist(
        exactShape(e, [
          ...(Object.hasOwn(e, "dismissedAt") ? ["dismissedAt"] : []),
          ...(Object.hasOwn(e, "receipt") ? ["receipt"] : []),
          "id",
          "contributorId",
          "operationId",
          "target",
          "created",
          "expires",
          "observedAt",
          "retainUntil",
          "phase",
          "verifiedAt",
          "expiredAt",
          "proof",
          "conflicts",
          "conflictOverflow",
        ]),
        "campos da entrada",
      );
      insist(
        id(e.id) && id(e.contributorId) && uuid(e.operationId),
        "certificado ou operação",
      );
      insist(
        !ids.has(e.id) &&
          !allCertificates.has(e.id) &&
          !operations.has(e.contributorId + ":" + e.operationId),
        "entrada repetida",
      );
      ids.add(e.id);
      allCertificates.add(e.id);
      operations.add(e.contributorId + ":" + e.operationId);
      insist(
        exactShape(e.target, [
          "site",
          "snapshotId",
          "revisionId",
          "pageId",
          "formId",
        ]),
        "destino",
      );
      insist(
        parseSiteAddress(e.target.site).ownerId === ownerId &&
          id(e.target.snapshotId) &&
          id(e.target.revisionId) &&
          [e.target.pageId, e.target.formId].every(
            (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v),
          ),
        "dono ou referência da fonte",
      );
      insist(
        clock(e.created) &&
          clock(e.expires) &&
          e.expires > e.created &&
          e.expires - e.created <= SITE_CONTRIBUTION_LIMITS.lifetimeMs &&
          clock(e.observedAt) &&
          e.observedAt < e.expires &&
          e.created - e.observedAt <= SITE_CONTRIBUTION_LIMITS.clockSkewMs,
        "prazo observado",
      );
      insist(
        [
          "missing-source",
          "verified-candidate",
          "expired",
          "dismissed",
        ].includes(e.phase),
        "fase",
      );
      insist(
        e.verifiedAt === null ||
          (clock(e.verifiedAt) &&
            e.verifiedAt >= e.observedAt &&
            e.verifiedAt < e.expires),
        "verificação histórica",
      );
      if (e.phase === "missing-source")
        insist(e.verifiedAt === null, "fonte ainda não verificada");
      if (e.phase === "verified-candidate")
        insist(e.verifiedAt !== null, "verificação em falta");
      insist(
        e.phase === "dismissed"
          ? clock(e.dismissedAt) &&
              e.dismissedAt >= e.observedAt &&
              e.dismissedAt >= (e.verifiedAt ?? 0) &&
              e.dismissedAt < e.expires &&
              e.proof === null &&
              e.expiredAt === null
          : !Object.hasOwn(e, "dismissedAt"),
        "descarte local",
      );
      if (e.phase === "dismissed") {
        // A terminal tombstone consumes metadata, never pending/proof quota.
      } else if (e.phase === "expired") {
        insist(
          e.proof === null && clock(e.expiredAt) && e.expiredAt >= e.expires,
          "expiração sem limpeza",
        );
      } else {
        insist(e.expiredAt === null, "entrada activa expirada");
        descriptor(e.proof);
        pending++;
        bytes += e.proof.bytes;
        authors.set(e.contributorId, (authors.get(e.contributorId) ?? 0) + 1);
      }
      if (Object.hasOwn(e, "receipt")) {
        const receipt = receipts.validate(e.receipt, ownerId, e);
        receiptBytes += receipt.stage?.bytes ?? 0;
      }
      insist(
        Array.isArray(e.conflicts) &&
          e.conflicts.length <= CONTRIBUTION_INBOX_LIMITS.conflicts &&
          typeof e.conflictOverflow === "boolean" &&
          (!e.conflictOverflow ||
            e.conflicts.length === CONTRIBUTION_INBOX_LIMITS.conflicts),
        "conflitos",
      );
      const conflicts = new Set<string>();
      let maximumExpiry = e.expires;
      for (const c of e.conflicts) {
        insist(
          exactShape(c, ["id", "expires"]) &&
            id(c.id) &&
            c.id !== e.id &&
            !conflicts.has(c.id) &&
            !allCertificates.has(c.id) &&
            clock(c.expires),
          "conflito repetido ou inválido",
        );
        conflicts.add(c.id);
        allCertificates.add(c.id);
        maximumExpiry = Math.max(maximumExpiry, c.expires);
      }
      insist(
        clock(e.retainUntil) &&
          e.retainUntil >= retain(maximumExpiry) &&
          (e.conflictOverflow || e.retainUntil === retain(maximumExpiry)),
        "retenção",
      );
    }
    insist(
      receiptBytes <= RECEIPT_STORAGE_LIMITS.totalStageBytes &&
        pending <= CONTRIBUTION_INBOX_LIMITS.pending &&
        bytes <= CONTRIBUTION_INBOX_LIMITS.totalProofBytes &&
        [...authors.values()].every(
          (n) => n <= CONTRIBUTION_INBOX_LIMITS.pendingPerContributor,
        ) &&
        size(r) <= CONTRIBUTION_INBOX_LIMITS.recordBytes,
      "quota sem expulsão de pendentes",
    );
    return JSON.parse(canonical(r));
  }
  function initial(ownerId: string) {
    return validate(
      {
        domain: "relayloom/contribution-inbox/1",
        ownerId,
        revision: 0,
        entries: [],
      },
      ownerId,
    );
  }
  function advance(r: ContributionInboxRecord) {
    insist(r.revision < Number.MAX_SAFE_INTEGER, "revisão esgotada");
    r.revision++;
    return validate(r, r.ownerId);
  }
  function checkCertificate(
    entry: ContributionInboxEntry,
    certificate: unknown,
    ownerId: string,
  ) {
    const p = certificates.verify(certificate),
      b = p.body;
    insist(
      parseSiteAddress(b.target.site).ownerId === ownerId &&
        entry.id === p.id &&
        entry.contributorId === b.contributor.id &&
        entry.operationId === b.operationId &&
        entry.created === b.created &&
        entry.expires === b.expires &&
        canonical(entry.target) === canonical(b.target),
      "certificado diferente da entrada",
    );
    return p;
  }
  function observe(
    input: unknown,
    ownerId: string,
    certificate: unknown,
    proof: unknown,
    now: number,
  ) {
    const r = validate(input, ownerId),
      p = certificates.verify(certificate),
      b = p.body;
    descriptor(proof);
    insist(
      clock(now) &&
        b.expires > now &&
        b.created - now <= SITE_CONTRIBUTION_LIMITS.clockSkewMs &&
        parseSiteAddress(b.target.site).ownerId === ownerId,
      "destinatário ou prazo de admissão",
    );
    let entry = r.entries.find(
      (e) =>
        e.contributorId === b.contributor.id && e.operationId === b.operationId,
    );
    if (entry) {
      if (entry.id === p.id) {
        checkCertificate(entry, p, ownerId);
        return { record: r, entry, outcome: "duplicate" as const };
      }
      if (entry.conflicts.some((c) => c.id === p.id))
        return { record: r, entry, outcome: "conflict" as const };
      if (entry.conflictOverflow && retain(b.expires) <= entry.retainUntil)
        return { record: r, entry, outcome: "conflict" as const };
      if (entry.conflicts.length < CONTRIBUTION_INBOX_LIMITS.conflicts)
        entry.conflicts.push({ id: p.id, expires: b.expires });
      else entry.conflictOverflow = true;
      entry.retainUntil = Math.max(entry.retainUntil, retain(b.expires));
      const record = advance(r);
      return {
        record,
        entry: record.entries.find((e) => e.id === entry!.id)!,
        outcome: "conflict" as const,
      };
    }
    entry = {
      id: p.id,
      contributorId: b.contributor.id,
      operationId: b.operationId,
      target: structuredClone(b.target),
      created: b.created,
      expires: b.expires,
      observedAt: now,
      retainUntil: retain(b.expires),
      phase: "missing-source",
      verifiedAt: null,
      expiredAt: null,
      proof: structuredClone(proof),
      conflicts: [],
      conflictOverflow: false,
    };
    r.entries.push(entry);
    const record = advance(r);
    return {
      record,
      entry: record.entries.find((e) => e.id === p.id)!,
      outcome: "new" as const,
    };
  }
  function verified(
    input: unknown,
    ownerId: string,
    certificateId: string,
    proof: unknown,
    now: number,
  ) {
    const r = validate(input, ownerId),
      entry = r.entries.find((e) => e.id === certificateId);
    descriptor(proof);
    insist(
      entry &&
        entry.proof &&
        entry.phase !== "expired" &&
        clock(now) &&
        now >= entry.observedAt &&
        now < entry.expires,
      "candidato expirado ou ausente",
    );
    insist(
      entry.proof.bundleId === proof.bundleId &&
        entry.proof.envelopeHash === proof.envelopeHash,
      "envelope original substituído",
    );
    if (entry.phase === "verified-candidate") {
      insist(
        canonical(entry.proof) === canonical(proof),
        "fonte já verificada diferente",
      );
      return { record: r, entry };
    }
    entry.phase = "verified-candidate";
    entry.verifiedAt = now;
    entry.proof = structuredClone(proof);
    const record = advance(r);
    return {
      record,
      entry: record.entries.find((e) => e.id === certificateId)!,
    };
  }
  function expire(
    input: unknown,
    ownerId: string,
    now: number,
    proofBudget = Number.MAX_SAFE_INTEGER,
  ) {
    const r = validate(input, ownerId);
    insist(clock(now) && clock(proofBudget), "relógio ou orçamento de limpeza");
    let changed = false,
      remaining = proofBudget;
    for (const e of r.entries) {
      const dueReceipt =
        e.receipt &&
        e.receipt.phase !== "expired" &&
        e.receipt.request.expires <= now;
      const cost =
        Number(e.proof !== null && e.expires <= now) +
        Number(!!dueReceipt && e.receipt!.stage !== null);
      if (cost > remaining) continue;
      remaining -= cost;
      if (
        e.receipt &&
        e.receipt.phase !== "expired" &&
        e.receipt.request.expires <= now
      ) {
        e.receipt = receipts.expire(e.receipt, ownerId, e, now);
        changed = true;
      }
      if (e.proof !== null && e.expires <= now) {
        e.phase = "expired";
        e.proof = null;
        e.expiredAt = now;
        changed = true;
      }
    }
    const before = r.entries.length;
    r.entries = r.entries.filter(
      (e) =>
        e.retainUntil > now || e.proof !== null || e.receipt?.stage != null,
    );
    return changed || before !== r.entries.length ? advance(r) : r;
  }
  function dismiss(
    input: unknown,
    ownerId: string,
    certificateId: string,
    revision: number,
    now: number,
  ) {
    const r = validate(input, ownerId),
      entry = r.entries.find((e) => e.id === certificateId);
    insist(
      clock(revision) && revision <= r.revision && clock(now),
      "revisão ou relógio",
    );
    insist(entry, "candidata ausente");
    if (entry.phase === "dismissed") return { record: r, entry };
    insist(revision === r.revision, "a inbox mudou; volta a consultar");
    insist(
      entry.proof &&
        now >= entry.observedAt &&
        now >= (entry.verifiedAt ?? 0) &&
        now < entry.expires,
      "candidata expirada ou relógio anterior",
    );
    entry.phase = "dismissed";
    entry.dismissedAt = now;
    entry.proof = null;
    const record = advance(r);
    return {
      record,
      entry: record.entries.find((e) => e.id === certificateId)!,
    };
  }
  function prepareReceipt(
    input: unknown,
    owner: PublicIdentity,
    certificate: unknown,
  ) {
    const r = validate(input, owner.id),
      p = certificates.verify(certificate),
      e = r.entries.find((e) => e.id === p.id);
    insist(
      e && e.proof && e.phase === "verified-candidate",
      "candidata não verificada",
    );
    const expected = receipts.prepare(e.receipt?.owner ?? owner, e, p);
    if (e.receipt) {
      insist(
        e.receipt.fingerprint === expected.fingerprint,
        "outra intenção de recibo",
      );
      return { record: r, entry: e };
    }
    e.receipt = expected;
    const record = advance(r);
    return { record, entry: record.entries.find((e) => e.id === p.id)! };
  }
  function updateReceipt(
    input: unknown,
    ownerId: string,
    id: string,
    receipt: unknown,
  ) {
    const r = validate(input, ownerId),
      e = r.entries.find((e) => e.id === id);
    insist(e?.receipt, "intenção de recibo em falta");
    const next = receipts.validate(receipt, ownerId, e);
    insist(
      next.fingerprint === e.receipt.fingerprint,
      "intenção de recibo substituída",
    );
    if (canonical(next) === canonical(e.receipt))
      return { record: r, entry: e };
    const old = e.receipt;
    insist(
      ["prepared:signed", "signed:queued", "queued:queued"].includes(
        old.phase + ":" + next.phase,
      ) &&
        (old.certificateId === null ||
          next.certificateId === old.certificateId),
      "transição de recibo inválida",
    );
    if (old.phase === "queued") {
      const expected = structuredClone(old);
      expected.transport!.copied = true;
      insist(
        !old.transport!.copied && canonical(next) === canonical(expected),
        "cópia reescrita",
      );
    }
    e.receipt = next;
    const record = advance(r);
    return { record, entry: record.entries.find((e) => e.id === id)! };
  }
  return {
    prepareReceipt,
    updateReceipt,
    initial,
    validate,
    observe,
    verified,
    expire,
    checkCertificate,
    dismiss,
  };
}

/** Metadata for owner-local quota management, including blocked/unreadable rows.
 * No proof, values, read keys or publication authority crosses this boundary. */
export function contributionInboxManagement(record: ContributionInboxRecord) {
  return {
    revision: record.revision,
    entries: record.entries.map((e) => ({
      id: e.id,
      contributorId: e.contributorId,
      operationId: e.operationId,
      target: structuredClone(e.target),
      phase: e.phase,
      created: e.created,
      expires: e.expires,
      retainUntil: e.retainUntil,
      verifiedAt: e.verifiedAt,
      dismissedAt: e.dismissedAt ?? null,
    })),
  };
}
