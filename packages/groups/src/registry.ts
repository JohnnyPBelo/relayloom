import { createPublicKey, randomBytes, verify } from "node:crypto";
import {
  canonical,
  hash,
  validateIdentity,
  type Identity,
  type PublicIdentity,
} from "../../core/src/index.js";
import {
  acceptGroupInvitation,
  closeAnchoredGroup,
  createAnchoredGroup,
  createGroupInvitation,
  createGroupLeave,
  createGroupSuccessor,
  memberCardHash,
  verifyGroupAnchor,
  verifyGroupConsent,
  verifyGroupEpoch,
  verifyGroupEpochLink,
  verifyGroupInvitation,
  verifyGroupLeave,
  verifyGroupSnapshot,
  verifyGroupSnapshotTransition,
  type GroupAnchor,
  type GroupConsent,
  type GroupEpoch,
  type GroupInvitation,
  type GroupLeave,
  type GroupSnapshot,
} from "./certificates.js";
import {
  ProtectedGroupStore,
  RegistryCapacityError,
  RegistryIntegrityError,
  type RegistryTransaction,
} from "./storage.js";

export const AUTHORITY_LIMITS = Object.freeze({
  groups: 64,
  operations: 256,
  page: 16,
  pageBytes: 256 * 1024,
  // 64 checkpoints + up to 256 stop operations, including encrypted index/row
  // overhead, fit the four MiB reserve independently of ordinary proof data.
  checkpointBytes: 52 * 1024,
  operationBytes: 2 * 1024,
});
export type GroupStopEvidence =
  | { reason: "forked"; first: GroupEpoch; second: GroupEpoch }
  | {
      reason: "capacity";
      resource: "header" | "snapshot";
      observed: GroupEpoch;
    };
interface GroupRecord {
  version: 1;
  anchor: GroupAnchor;
  head: GroupEpoch | null;
  label: string | null;
  everJoined: boolean;
  admitted: { cardHash: string; epochId: string } | null;
  checkedThrough: number | null;
  invitation: GroupInvitation | null;
  invitationParent: GroupEpoch | null;
  invitationCard: PublicIdentity | null;
  consent: GroupConsent | null;
  left: {
    epochId: string | null;
    nonce: string;
    request: GroupLeave | null;
    card: PublicIdentity | null;
  } | null;
  frozen: GroupStopEvidence | null;
}
export interface GroupAuthorityView {
  id: string;
  creator: PublicIdentity;
  title: string | null;
  head: GroupEpoch | null;
  status:
    | "awaiting-proof"
    | "joining"
    | "removed"
    | "left"
    | "card-changed"
    | "awaiting-snapshot"
    | "active"
    | "closed"
    | "forked"
    | "capacity";
  pendingConsent: string | null;
  locallyLeft: boolean;
  stopEvidence: { id: string; number: number }[];
}
export interface GroupOperationResult {
  groupId: string;
  epochId: string | null;
  certificate: GroupInvitation | GroupConsent | GroupLeave | null;
}
interface Operation {
  version: 1;
  id: string;
  kind: string;
  fingerprint: string;
  sequence: number;
  result: GroupOperationResult;
}
const address = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const operationID = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );
const key = (id: string) => "group:" + id;
const headerKey = (id: string, number: number) =>
  `epoch:${id}:${String(number).padStart(4, "0")}`;
const snapshotKey = (id: string, digest: string) => `snapshot:${id}:${digest}`;
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function exact(value: any, keys: string[]) {
  requireThat(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
    "Campos de autoridade inválidos",
  );
}
function decode(bytes: Buffer): any {
  const value = JSON.parse(bytes.toString("utf8"));
  requireThat(
    Buffer.from(canonical(value)).equals(bytes),
    "Metadados de autoridade não canónicos",
  );
  return value;
}
class InvalidGroupProofError extends Error {}
function incomingProof<T>(verify: () => T): T {
  try {
    return verify();
  } catch (error) {
    throw new InvalidGroupProofError((error as Error).message);
  }
}

export interface GroupProofRejection {
  groupId: string;
  accepted: number;
  message: string;
}

/** Local authority state only. Application content admission must use the same transaction boundary. */
export class GroupRegistry {
  private readonly identity: Identity;
  private readonly cardHash: string;
  private deferredRejections?: GroupProofRejection[];
  private scopeCheck?: () => number;
  private verifiedRecords?: {
    generation: number;
    values: Map<string, GroupRecord>;
  };
  /** Runtime admission caches may only live inside the borrowed transaction. */
  assertScope() {
    requireThat(
      this.scopeCheck,
      "A operação exige uma transacção de autoridade",
    );
    return this.scopeCheck();
  }
  constructor(
    private readonly store: Pick<
      ProtectedGroupStore,
      "transaction" | "view" | "accounting"
    >,
    identity: Identity,
  ) {
    requireThat(validateIdentity(identity.public), "Identidade local inválida");
    requireThat(
      store.view((tx) => tx.indexBody().owner) === identity.public.id,
      "Registo pertence a outra identidade",
    );
    requireThat(
      store.accounting().reserveBytes === 4 * 1024 ** 2,
      "A autoridade dos grupos exige a reserva de 4 MiB",
    );
    this.identity = structuredClone(identity);
    this.cardHash = memberCardHash(identity.public);
  }
  /** Borrow one caller-owned transaction. No result authorizes transmission until
   * the outer commit succeeds. Rejected proof tails are returned as data so a
   * verified restrictive prefix and its outbox fence can commit together. */
  static inTransaction<T>(
    tx: RegistryTransaction,
    identity: Identity,
    callback: (registry: GroupRegistry) => T,
  ): { value: T; rejections: GroupProofRejection[] } {
    let active = true,
      failed = false,
      failure: unknown;
    let borrowed: GroupRegistry | undefined;
    const execute = <R>(operation: (tx: RegistryTransaction) => R): R => {
      if (!active) throw new Error("Âmbito de autoridade encerrado");
      if (failed) throw failure;
      try {
        const value = operation(tx);
        if (value && typeof (value as any).then === "function")
          throw new Error("O âmbito de autoridade exige operações síncronas");
        return value;
      } catch (error) {
        failed = true;
        failure = error;
        throw error;
      }
    };
    try {
      const registry = new GroupRegistry(
        {
          transaction: execute,
          view: execute,
          accounting: () => execute((current) => current.accounting()),
        },
        identity,
      );
      borrowed = registry;
      const rejections: GroupProofRejection[] = [];
      registry.deferredRejections = rejections;
      registry.scopeCheck = () => {
        requireThat(active, "Âmbito de autoridade encerrado");
        return tx.generation();
      };
      registry.verifiedRecords = {
        generation: tx.generation(),
        values: new Map(),
      };
      const value = callback(registry);
      if (failed) throw failure;
      if (value && typeof (value as any).then === "function")
        throw new Error("O âmbito de autoridade exige uma função síncrona");
      return { value, rejections: structuredClone(rejections) };
    } catch (error) {
      return tx.abort(
        error instanceof Error
          ? error
          : new Error("Âmbito de autoridade interrompido"),
      );
    } finally {
      active = false;
      if (borrowed) borrowed.verifiedRecords = undefined;
    }
  }
  private record(tx: RegistryTransaction, id: string): GroupRecord {
    const cache = this.verifiedRecords;
    if (!cache) return this.readRecord(tx, id);
    const generation = this.assertScope();
    if (cache.generation !== generation) {
      cache.values.clear();
      cache.generation = generation;
    }
    const saved = cache.values.get(id);
    if (saved) return structuredClone(saved);
    const record = this.readRecord(tx, id);
    // Only immutable reads in the same authenticated transaction share work.
    // Any write invalidates all entries; returned objects never alias the cache.
    // Eight bounded checkpoints retain at most 416 KiB of encoded data.
    if (
      Buffer.byteLength(canonical(record)) <= AUTHORITY_LIMITS.checkpointBytes
    ) {
      if (cache.values.size >= 8)
        cache.values.delete(cache.values.keys().next().value!);
      cache.values.set(id, structuredClone(record));
    }
    return record;
  }
  private readRecord(tx: RegistryTransaction, id: string): GroupRecord {
    requireThat(address(id), "Identificador de grupo inválido");
    const bytes = tx.get(key(id));
    requireThat(bytes, "Grupo não está registado localmente");
    try {
      const r: GroupRecord = decode(bytes);
      exact(r, [
        "version",
        "anchor",
        "head",
        "label",
        "everJoined",
        "admitted",
        "checkedThrough",
        "invitation",
        "invitationParent",
        "invitationCard",
        "consent",
        "left",
        "frozen",
      ]);
      requireThat(
        r.version === 1 &&
          verifyGroupAnchor(r.anchor).id === id &&
          typeof r.everJoined === "boolean" &&
          (r.label === null ||
            (typeof r.label === "string" && r.label.length <= 256)),
        "Checkpoint de grupo inválido",
      );
      if (r.head !== null) {
        verifyGroupEpoch(r.head, r.anchor);
        requireThat(
          this.header(tx, r, r.head.body.number)?.id === r.head.id,
          "Cabeça protegida sem cabeçalho correspondente",
        );
        if (r.head.body.state === "closed") this.parent(tx, r, r.head);
      }
      if (r.admitted !== null) {
        exact(r.admitted, ["cardHash", "epochId"]);
        requireThat(
          address(r.admitted.cardHash) &&
            address(r.admitted.epochId) &&
            r.everJoined,
          "Admissão local inválida",
        );
      }
      requireThat(
        r.admitted
          ? r.head &&
              Number.isInteger(r.checkedThrough) &&
              r.checkedThrough! >= 0 &&
              r.checkedThrough! <= r.head.body.number
          : r.checkedThrough === null,
        "Cursor de validação local inválido",
      );
      if (r.admitted) {
        const checked = this.header(tx, r, r.checkedThrough!);
        requireThat(
          checked &&
            checked.body.members.some(
              (m) =>
                m.id === this.identity.public.id &&
                m.cardHash === r.admitted!.cardHash,
            ) &&
            this.snapshot(tx, r, checked),
          "Cursor sem estado privado verificado",
        );
      }
      if (r.invitation !== null) {
        requireThat(
          r.invitationCard?.id === this.identity.public.id &&
            r.invitationParent,
          "Convite sem cartão ou antecessor",
        );
        verifyGroupInvitation(
          r.invitation,
          r.anchor,
          r.invitationParent!,
          r.invitationCard!,
        );
      } else
        requireThat(
          r.invitationParent === null && r.invitationCard === null,
          "Referências de convite sem convite",
        );
      if (r.consent !== null) {
        requireThat(
          r.consent.body.groupId === id &&
            r.invitation?.id === r.consent.body.invitationHash,
          "Consentimento local inválido",
        );
        verifyGroupConsent(
          r.consent,
          r.anchor,
          r.invitationParent!,
          r.invitationCard!,
        );
      }
      if (r.left !== null) {
        exact(r.left, ["epochId", "nonce", "request", "card"]);
        requireThat(
          (r.left.epochId === null || address(r.left.epochId)) &&
            typeof r.left.nonce === "string" &&
            Buffer.from(r.left.nonce, "base64").length === 32 &&
            Buffer.from(r.left.nonce, "base64").toString("base64") ===
              r.left.nonce,
          "Saída local inválida",
        );
        if (r.left.request !== null) {
          const parent =
            r.left.epochId && this.findEpoch(tx, r, r.left.epochId);
          requireThat(
            parent &&
              r.left.card?.id === this.identity.public.id &&
              r.left.request.body.leaveNonce === r.left.nonce,
            "Prova de saída incoerente",
          );
          verifyGroupLeave(r.left.request, r.anchor, parent!, r.left.card!);
        } else requireThat(r.left.card === null, "Cartão sem pedido de saída");
        requireThat(
          r.admitted === null,
          "Admissão posterior a uma saída local",
        );
      }
      if (r.frozen !== null) {
        if (r.frozen.reason === "forked") {
          exact(r.frozen, ["reason", "first", "second"]);
          verifyGroupEpoch(r.frozen.first, r.anchor);
          verifyGroupEpoch(r.frozen.second, r.anchor);
          requireThat(
            r.frozen.first.id !== r.frozen.second.id &&
              r.frozen.first.body.number === r.frozen.second.body.number &&
              r.frozen.first.body.previous === r.frozen.second.body.previous,
            "Prova de conflito inválida",
          );
        } else {
          exact(r.frozen, ["reason", "resource", "observed"]);
          requireThat(
            r.frozen.reason === "capacity" &&
              r.head &&
              ["header", "snapshot"].includes(r.frozen.resource),
            "Suspensão de capacidade inválida",
          );
          if (r.frozen.resource === "header")
            verifyGroupEpochLink(r.anchor, r.head!, r.frozen.observed);
          else {
            verifyGroupEpoch(r.frozen.observed, r.anchor);
            requireThat(
              this.header(tx, r, r.frozen.observed.body.number)?.id ===
                r.frozen.observed.id,
              "Suspensão de estado privado sem época retida",
            );
          }
        }
      }
      return r;
    } catch (error) {
      throw new RegistryIntegrityError(
        "Checkpoint de autoridade inválido: " + (error as Error).message,
      );
    }
  }
  private save(tx: RegistryTransaction, r: GroupRecord) {
    const bytes = Buffer.from(canonical(r));
    requireThat(
      bytes.length <= AUTHORITY_LIMITS.checkpointBytes,
      "Checkpoint de grupo excede a reserva individual",
    );
    tx.put(key(r.anchor.id), bytes, "checkpoint");
  }
  private empty(anchor: GroupAnchor): GroupRecord {
    return {
      version: 1,
      anchor,
      head: null,
      label: null,
      everJoined: false,
      admitted: null,
      checkedThrough: null,
      invitation: null,
      invitationParent: null,
      invitationCard: null,
      consent: null,
      left: null,
      frozen: null,
    };
  }
  private reserveGroup(tx: RegistryTransaction) {
    requireThat(
      tx.keys("group:").length < AUTHORITY_LIMITS.groups,
      "Limite de 64 grupos lembrados; saídas e conflitos conservam a sua protecção",
    );
  }
  private header(
    tx: RegistryTransaction,
    r: GroupRecord,
    number: number,
  ): GroupEpoch | null {
    const bytes = tx.get(headerKey(r.anchor.id, number));
    // A terminal header lives in the permanent checkpoint. Closing must remain
    // possible when ordinary proofs have exhausted their allocation.
    if (!bytes)
      return r.head?.body.state === "closed" && r.head.body.number === number
        ? structuredClone(r.head)
        : null;
    try {
      const e = verifyGroupEpoch(decode(bytes), r.anchor);
      requireThat(
        e.body.number === number,
        "Número de época armazenado não coincide",
      );
      return e;
    } catch (error) {
      throw new RegistryIntegrityError(
        "Prova de época armazenada inválida: " + (error as Error).message,
      );
    }
  }
  private parent(
    tx: RegistryTransaction,
    r: GroupRecord,
    e: GroupEpoch,
  ): GroupEpoch | null {
    if (!e.body.number) return null;
    const parent = this.header(tx, r, e.body.number - 1);
    requireThat(
      parent && parent.id === e.body.previous,
      "Falta o antecessor verificado",
    );
    verifyGroupEpochLink(r.anchor, parent, e);
    return parent;
  }
  private checkedSnapshot(
    tx: RegistryTransaction,
    r: GroupRecord,
    epoch: GroupEpoch,
    value: unknown,
  ): GroupSnapshot {
    const snapshot = verifyGroupSnapshot(value, r.anchor, epoch),
      parent = this.parent(tx, r, epoch);
    if (parent)
      verifyGroupSnapshotTransition(r.anchor, parent, epoch, snapshot);
    return snapshot;
  }
  private snapshot(
    tx: RegistryTransaction,
    r: GroupRecord,
    epoch: GroupEpoch,
  ): GroupSnapshot | null {
    const bytes = tx.get(snapshotKey(r.anchor.id, epoch.body.snapshotHash));
    if (!bytes) return null;
    try {
      return this.checkedSnapshot(tx, r, epoch, decode(bytes));
    } catch (error) {
      throw new RegistryIntegrityError(
        "Estado privado de grupo inválido: " + (error as Error).message,
      );
    }
  }
  private operation(
    tx: RegistryTransaction,
    id: string,
    kind: string,
    input: unknown,
    apply: () => GroupOperationResult,
  ): GroupOperationResult {
    requireThat(operationID(id), "Identificador de operação inválido");
    const fingerprint = hash(canonical({ kind, input })),
      opKey = "operation:" + id;
    const previous = tx.get(opKey);
    if (previous) {
      const op = this.readOperation(tx, opKey, previous);
      requireThat(
        op.version === 1 &&
          op.id === id &&
          op.kind === kind &&
          op.fingerprint === fingerprint,
        "A operação já foi usada com outro pedido",
      );
      return structuredClone(op.result);
    }
    const operations = tx.keys("operation:");
    if (operations.length >= AUTHORITY_LIMITS.operations) {
      // This scan performs no writes until every candidate is checked. Reuse
      // only the current group record in this transaction, never an operation's
      // signature/revision and never a cached authority across transactions.
      const records = new Map<string, GroupRecord>();
      const oldest = operations
        .map((k) => ({
          key: k,
          value: this.readOperation(tx, k, tx.get(k)!, records),
        }))
        .sort(
          (a, b) =>
            a.value.sequence - b.value.sequence || a.key.localeCompare(b.key),
        )[0];
      tx.delete(oldest.key); // Explicit finite deduplication; group proofs/fences are separate.
    }
    const result = apply();
    const op: Operation = {
      version: 1,
      id,
      kind,
      fingerprint,
      sequence: tx.indexBody().revision + 1,
      result,
    };
    const bytes = Buffer.from(canonical(op));
    requireThat(
      bytes.length <= AUTHORITY_LIMITS.operationBytes,
      "Operação excede a reserva individual",
    );
    tx.put(
      opKey,
      bytes,
      kind === "leave" || kind === "close" ? "checkpoint" : "data",
    );
    return structuredClone(result);
  }
  private readOperation(
    tx: RegistryTransaction,
    opKey: string,
    bytes: Buffer,
    records?: Map<string, GroupRecord>,
  ): Operation {
    try {
      requireThat(
        bytes.length <= AUTHORITY_LIMITS.operationBytes,
        "Operação demasiado grande",
      );
      const op: Operation = decode(bytes);
      exact(op, ["version", "id", "kind", "fingerprint", "sequence", "result"]);
      requireThat(
        op.version === 1 &&
          operationID(op.id) &&
          opKey === "operation:" + op.id &&
          [
            "create",
            "invite",
            "remember-invitation",
            "accept",
            "commit",
            "close",
            "leave",
          ].includes(op.kind) &&
          address(op.fingerprint) &&
          Number.isSafeInteger(op.sequence) &&
          op.sequence > 0 &&
          op.sequence ===
            tx.indexBody().entries.find((e) => e.key === opKey)?.revision,
        "Operação persistida inválida",
      );
      exact(op.result, ["groupId", "epochId", "certificate"]);
      requireThat(
        address(op.result.groupId) &&
          (op.result.epochId === null || address(op.result.epochId)),
        "Resultado persistido inválido",
      );
      const r =
          records?.get(op.result.groupId) ?? this.record(tx, op.result.groupId),
        cert = op.result.certificate;
      records?.set(op.result.groupId, r);
      if (["create", "commit", "close"].includes(op.kind))
        requireThat(
          cert === null && op.result.epochId,
          "Resultado de época inválido",
        );
      else if (cert !== null) {
        exact(cert, ["body", "id", "signature"]);
        const signer = ["invite", "remember-invitation"].includes(op.kind)
          ? r.anchor.body.creator
          : this.identity.public;
        const domain = ["invite", "remember-invitation"].includes(op.kind)
          ? "invitation"
          : op.kind === "accept"
            ? "consent"
            : "leave";
        const signature = Buffer.from(cert.signature, "base64");
        requireThat(
          cert.body.domain === `relayloom/group-${domain}/1` &&
            cert.body.groupId === op.result.groupId &&
            cert.body.parentEpochId === op.result.epochId &&
            cert.id === hash(canonical(cert.body)) &&
            signature.length === 64 &&
            signature.toString("base64") === cert.signature &&
            verify(
              null,
              Buffer.from(canonical(cert.body)),
              createPublicKey({
                key: Buffer.from(signer.signKey, "base64"),
                format: "der",
                type: "spki",
              }),
              signature,
            ),
          "Certificado de operação inválido",
        );
      } else
        requireThat(op.kind === "leave", "Certificado de operação ausente");
      return op;
    } catch (error) {
      throw new RegistryIntegrityError(
        "Operação de autoridade inválida: " + (error as Error).message,
      );
    }
  }
  private owner(r: GroupRecord, expected: string, requireChecked = true) {
    requireThat(
      r.anchor.body.creator.id === this.identity.public.id &&
        r.anchor.body.creator.signKey === this.identity.public.signKey,
      "Só o criador pode alterar os membros",
    );
    requireThat(
      !r.frozen && r.head?.body.state === "open" && r.head.id === expected,
      "Grupo suspenso, encerrado ou época desactualizada",
    );
    if (requireChecked)
      requireThat(
        r.checkedThrough === r.head!.body.number,
        "É necessário verificar todos os estados intermédios",
      );
  }
  create(id: string, title: string): GroupOperationResult {
    return this.store.transaction((tx) =>
      this.operation(tx, id, "create", { title }, () => {
        this.reserveGroup(tx);
        const g = createAnchoredGroup(this.identity, title),
          r = this.empty(g.anchor);
        r.head = g.epoch;
        r.label = g.snapshot.title;
        r.everJoined = true;
        r.admitted = { cardHash: this.cardHash, epochId: g.epoch.id };
        r.checkedThrough = 0;
        tx.put(headerKey(g.anchor.id, 0), Buffer.from(canonical(g.epoch)));
        tx.put(
          snapshotKey(g.anchor.id, g.epoch.body.snapshotHash),
          Buffer.from(canonical(g.snapshot)),
        );
        this.save(tx, r);
        return { groupId: g.anchor.id, epochId: g.epoch.id, certificate: null };
      }),
    );
  }
  invite(
    id: string,
    groupId: string,
    expected: string,
    invitee: PublicIdentity,
  ): GroupOperationResult {
    const cardHash = memberCardHash(invitee);
    return this.store.transaction((tx) =>
      this.operation(tx, id, "invite", { groupId, expected, cardHash }, () => {
        const r = this.record(tx, groupId);
        this.owner(r, expected);
        requireThat(
          !r.head!.body.members.some(
            (m) => m.id === invitee.id && m.cardHash === cardHash,
          ),
          "Este cartão já faz parte da época; confirme a saída antes de uma nova adesão",
        );
        const certificate = createGroupInvitation(
          this.identity,
          r.anchor,
          r.head!,
          invitee,
        );
        return { groupId, epochId: expected, certificate };
      }),
    );
  }
  rememberInvitation(
    id: string,
    anchorValue: GroupAnchor,
    parentValue: GroupEpoch,
    invitationValue: GroupInvitation,
  ): GroupOperationResult {
    const anchor = verifyGroupAnchor(anchorValue),
      parent = verifyGroupEpoch(parentValue, anchor);
    const invitation = verifyGroupInvitation(
      invitationValue,
      anchor,
      parent,
      this.identity.public,
    );
    return this.store.transaction((tx) =>
      this.operation(
        tx,
        id,
        "remember-invitation",
        { groupId: anchor.id, invitationId: invitation.id },
        () => {
          let r: GroupRecord;
          if (tx.get(key(anchor.id))) r = this.record(tx, anchor.id);
          else {
            this.reserveGroup(tx);
            r = this.empty(anchor);
          }
          requireThat(
            !r.frozen && r.head?.body.state !== "closed",
            "Grupo suspenso ou encerrado",
          );
          r.invitation = invitation;
          r.invitationParent = parent;
          r.invitationCard = structuredClone(this.identity.public);
          r.consent = null;
          this.save(tx, r);
          return {
            groupId: anchor.id,
            epochId: parent.id,
            certificate: invitation,
          };
        },
      ),
    );
  }
  accept(id: string, groupId: string, expected: string): GroupOperationResult {
    return this.store.transaction((tx) =>
      this.operation(tx, id, "accept", { groupId, expected }, () => {
        const r = this.record(tx, groupId);
        requireThat(
          !r.frozen &&
            r.head?.body.state === "open" &&
            r.head.id === expected &&
            r.invitation,
          "Faltam o convite ou a cadeia actual verificada",
        );
        requireThat(
          !r.head.body.members.some(
            (m) =>
              m.id === this.identity.public.id && m.cardHash === this.cardHash,
          ),
          "Este cartão ainda pertence à época; confirme a remoção antes de reentrar",
        );
        r.consent = acceptGroupInvitation(
          this.identity,
          r.anchor,
          r.head,
          r.invitation,
        );
        this.save(tx, r);
        return { groupId, epochId: expected, certificate: r.consent };
      }),
    );
  }
  commit(
    id: string,
    groupId: string,
    expected: string,
    update: { title: string; members: PublicIdentity[]; joins: GroupConsent[] },
  ): GroupOperationResult {
    requireThat(
      update &&
        Array.isArray(update.members) &&
        update.members.length >= 1 &&
        update.members.length <= 64 &&
        Array.isArray(update.joins) &&
        update.joins.length <= 64,
      "Alteração de membros fora dos limites",
    );
    const normalized = {
      title: update.title,
      members: update.members.map(memberCardHash).sort(),
      joins: update.joins.map((c) => c.id).sort(),
    };
    return this.store.transaction((tx) =>
      this.operation(
        tx,
        id,
        "commit",
        { groupId, expected, ...normalized },
        () => {
          const r = this.record(tx, groupId);
          this.owner(r, expected);
          const before = this.snapshot(tx, r, r.head!);
          requireThat(before, "Falta o estado privado da época actual");
          const next = createGroupSuccessor(
            this.identity,
            r.anchor,
            r.head!,
            before,
            update,
          );
          this.append(tx, r, next.epoch);
          requireThat(
            !r.frozen,
            "Capacidade esgotada ao preparar a alteração local",
          );
          tx.put(
            snapshotKey(groupId, next.epoch.body.snapshotHash),
            Buffer.from(canonical(next.snapshot)),
          );
          r.label = next.snapshot.title;
          this.applyOwnConsent(tx, r, next.epoch, next.snapshot);
          this.advanceChecked(tx, r);
          this.save(tx, r);
          return { groupId, epochId: next.epoch.id, certificate: null };
        },
      ),
    );
  }
  close(id: string, groupId: string, expected: string): GroupOperationResult {
    return this.store.transaction((tx) =>
      this.operation(tx, id, "close", { groupId, expected }, () => {
        const r = this.record(tx, groupId);
        this.owner(r, expected, false);
        const next = closeAnchoredGroup(this.identity, r.anchor, r.head!);
        this.append(tx, r, next);
        requireThat(
          !r.frozen,
          "Capacidade esgotada ao preparar o encerramento local",
        );
        this.advanceChecked(tx, r);
        this.save(tx, r);
        return { groupId, epochId: next.id, certificate: null };
      }),
    );
  }
  leave(id: string, groupId: string): GroupOperationResult {
    return this.store.transaction((tx) =>
      this.operation(tx, id, "leave", { groupId }, () => {
        const r = this.record(tx, groupId);
        requireThat(
          r.anchor.body.creator.id !== this.identity.public.id,
          "O criador encerra o grupo",
        );
        if (!r.left) {
          const eligible =
            r.head?.body.state === "open" &&
            r.head.body.members.some(
              (m) =>
                m.id === this.identity.public.id &&
                m.cardHash === this.cardHash,
            );
          const request = eligible
            ? createGroupLeave(this.identity, r.anchor, r.head!)
            : null;
          r.left = {
            epochId: r.head?.id ?? null,
            nonce:
              request?.body.leaveNonce ?? randomBytes(32).toString("base64"),
            request,
            card: request ? structuredClone(this.identity.public) : null,
          };
        }
        r.admitted = null;
        r.checkedThrough = null;
        r.invitation = null;
        r.invitationParent = null;
        r.invitationCard = null;
        r.consent = null;
        this.save(tx, r);
        return {
          groupId,
          epochId: r.left.epochId,
          certificate: r.left.request,
        };
      }),
    );
  }
  private append(
    tx: RegistryTransaction,
    r: GroupRecord,
    e: GroupEpoch,
  ): "adopted" | "duplicate" | "missing-proof" | "frozen" {
    const epoch = incomingProof(() => verifyGroupEpoch(e, r.anchor));
    if (r.frozen?.reason === "forked") return "frozen";
    const same =
      r.frozen?.reason === "capacity" &&
      r.frozen.observed.body.number === epoch.body.number
        ? r.frozen.observed
        : this.header(tx, r, epoch.body.number);
    if (same) {
      if (same.id === epoch.id) return "duplicate";
      const parent = epoch.body.number
        ? this.header(tx, r, epoch.body.number - 1)
        : null;
      if (epoch.body.number && (!parent || epoch.body.previous !== parent.id))
        return "missing-proof";
      if (parent)
        incomingProof(() => verifyGroupEpochLink(r.anchor, parent, epoch));
      r.frozen = { reason: "forked", first: same, second: epoch };
      return "frozen";
    }
    if (r.frozen) return "frozen";
    if (r.head) {
      if (
        epoch.body.number !== r.head.body.number + 1 ||
        epoch.body.previous !== r.head.id
      )
        return "missing-proof";
      incomingProof(() => verifyGroupEpochLink(r.anchor, r.head!, epoch));
    } else if (epoch.body.number !== 0) return "missing-proof";
    try {
      if (epoch.body.state !== "closed")
        tx.put(
          headerKey(r.anchor.id, epoch.body.number),
          Buffer.from(canonical(epoch)),
        );
    } catch (error) {
      if (!(error instanceof RegistryCapacityError) || !r.head) throw error;
      r.frozen = { reason: "capacity", resource: "header", observed: epoch };
      return "frozen";
    }
    r.head = epoch;
    if (
      r.admitted &&
      !epoch.body.members.some(
        (m) =>
          m.id === this.identity.public.id &&
          m.cardHash === r.admitted!.cardHash,
      )
    ) {
      r.admitted = null;
      r.checkedThrough = null;
    }
    return "adopted";
  }
  observeHeaders(
    groupId: string,
    values: GroupEpoch[],
  ): {
    status: GroupAuthorityView;
    accepted: number;
    missingProof: boolean;
    rejected?: string;
  } {
    requireThat(
      Array.isArray(values) &&
        values.length >= 1 &&
        values.length <= AUTHORITY_LIMITS.page,
      "Página de provas fora dos limites",
    );
    requireThat(
      Buffer.byteLength(canonical(values)) <= AUTHORITY_LIMITS.pageBytes,
      "Página de provas demasiado grande",
    );
    let rejected: InvalidGroupProofError | undefined;
    const observed = this.store.transaction((tx) => {
      const r = this.record(tx, groupId);
      const previous = canonical(r);
      let accepted = 0,
        missingProof = false;
      for (const value of values) {
        let result: ReturnType<GroupRegistry["append"]>;
        try {
          result = this.append(tx, r, value);
        } catch (error) {
          if (!(error instanceof InvalidGroupProofError)) throw error;
          rejected = error;
          break;
        }
        if (result === "adopted") accepted++;
        if (result === "missing-proof") {
          missingProof = true;
          break;
        }
        if (result === "frozen") break;
      }
      if (canonical(r) !== previous) this.save(tx, r);
      return { status: this.view(tx, r), accepted, missingProof };
    });
    // Invalid trailing network input cannot undo a verified restrictive prefix.
    // SQL/integrity failures still abort/poison through the storage boundary.
    if (rejected) {
      if (!this.deferredRejections) throw rejected;
      this.deferredRejections.push({
        groupId,
        accepted: observed.accepted,
        message: rejected.message,
      });
      return { ...observed, rejected: rejected.message };
    }
    return observed;
  }
  private applyOwnConsent(
    tx: RegistryTransaction,
    r: GroupRecord,
    epoch: GroupEpoch,
    snapshot: GroupSnapshot,
  ) {
    if (
      !r.consent ||
      !snapshot.joins.some((c) => c.id === r.consent!.id) ||
      !r.head
    )
      return;
    requireThat(
      snapshot.members.some(
        (m) =>
          m.id === this.identity.public.id &&
          memberCardHash(m) === this.cardHash,
      ),
      "Resposta de adesão não contém o cartão aceite",
    );
    const parent = this.parent(tx, r, epoch);
    requireThat(parent, "Adesão sem antecessor");
    verifyGroupConsent(r.consent, r.anchor, parent, this.identity.public);
    for (let n = epoch.body.number; n <= r.head.body.number; n++) {
      const e = this.header(tx, r, n);
      if (
        !e ||
        !e.body.members.some(
          (m) =>
            m.id === this.identity.public.id && m.cardHash === this.cardHash,
        )
      )
        return;
    }
    r.admitted = { cardHash: this.cardHash, epochId: epoch.id };
    r.checkedThrough = epoch.body.number;
    r.everJoined = true;
    r.left = null;
    r.invitation = null;
    r.invitationParent = null;
    r.invitationCard = null;
    r.consent = null;
  }
  private advanceChecked(tx: RegistryTransaction, r: GroupRecord) {
    if (!r.admitted || r.checkedThrough === null || !r.head) return;
    for (let n = r.checkedThrough + 1; n <= r.head.body.number; n++) {
      const epoch = this.header(tx, r, n);
      requireThat(epoch, "Cadeia protegida incompleta");
      const snapshot = this.snapshot(tx, r, epoch);
      if (!snapshot) break;
      r.checkedThrough = n;
      r.label = snapshot.title;
    }
  }
  observeSnapshot(
    groupId: string,
    epochId: string,
    value: GroupSnapshot,
  ): GroupAuthorityView {
    requireThat(address(epochId), "Época inválida");
    return this.store.transaction((tx) => {
      const r = this.record(tx, groupId);
      requireThat(
        !r.frozen ||
          (r.frozen.reason === "capacity" &&
            r.frozen.resource === "snapshot" &&
            r.frozen.observed.id === epochId),
        "Grupo suspenso",
      );
      const previous = canonical(r);
      const epoch = this.findEpoch(tx, r, epochId);
      requireThat(epoch, "Falta a época verificada");
      const snapshot = this.checkedSnapshot(tx, r, epoch, value);
      requireThat(
        snapshot.members.some(
          (m) =>
            m.id === this.identity.public.id &&
            memberCardHash(m) === this.cardHash,
        ),
        "O estado privado não se destina ao cartão local",
      );
      requireThat(
        r.admitted || r.consent,
        "Não existe adesão local para aceitar o estado privado",
      );
      const snapshotBytes = Buffer.from(canonical(snapshot)),
        stored = tx.get(snapshotKey(groupId, epoch.body.snapshotHash));
      if (!stored?.equals(snapshotBytes)) {
        try {
          tx.put(snapshotKey(groupId, epoch.body.snapshotHash), snapshotBytes);
        } catch (error) {
          if (!(error instanceof RegistryCapacityError)) throw error;
          r.frozen = {
            reason: "capacity",
            resource: "snapshot",
            observed: epoch,
          };
          if (canonical(r) !== previous) this.save(tx, r);
          return this.view(tx, r);
        }
      }
      r.frozen = null;
      this.applyOwnConsent(tx, r, epoch, snapshot);
      this.advanceChecked(tx, r);
      if (
        r.admitted &&
        r.head?.id === epoch.id &&
        r.checkedThrough === r.head.body.number
      )
        r.label = snapshot.title;
      if (canonical(r) !== previous) this.save(tx, r);
      return this.view(tx, r);
    });
  }
  /** Reclaim ordinary data first. A private-state stop needs the exact snapshot again. */
  resumeCapacity(groupId: string): GroupAuthorityView {
    return this.store.transaction((tx) => {
      const r = this.record(tx, groupId);
      requireThat(
        r.frozen?.reason === "capacity",
        "Não existe suspensão por capacidade",
      );
      if (r.frozen.resource === "snapshot") return this.view(tx, r);
      const previous = canonical(r),
        observed = r.frozen.observed;
      r.frozen = null;
      this.append(tx, r, observed);
      if (canonical(r) !== previous) this.save(tx, r);
      return this.view(tx, r);
    });
  }
  stopEvidence(groupId: string): GroupStopEvidence | null {
    return this.store.view((tx) =>
      structuredClone(this.record(tx, groupId).frozen),
    );
  }
  private findEpoch(
    tx: RegistryTransaction,
    r: GroupRecord,
    id: string,
  ): GroupEpoch | null {
    for (let n = 0; r.head && n <= r.head.body.number; n++) {
      const e = this.header(tx, r, n);
      if (e?.id === id) return e;
    }
    return null;
  }
  private view(tx: RegistryTransaction, r: GroupRecord): GroupAuthorityView {
    let status: GroupAuthorityView["status"];
    if (r.frozen) status = r.frozen.reason;
    else if (r.head?.body.state === "closed") status = "closed";
    else if (r.left) status = "left";
    else if (!r.head) status = "awaiting-proof";
    else if (!r.admitted)
      status = r.consent || !r.everJoined ? "joining" : "removed";
    else if (r.admitted.cardHash !== this.cardHash) status = "card-changed";
    else
      status =
        r.checkedThrough === r.head.body.number && this.snapshot(tx, r, r.head)
          ? "active"
          : "awaiting-snapshot";
    return {
      id: r.anchor.id,
      creator: structuredClone(r.anchor.body.creator),
      title: r.label,
      head: structuredClone(r.head),
      status,
      pendingConsent: r.consent?.id ?? null,
      locallyLeft: !!r.left,
      stopEvidence: (r.frozen?.reason === "forked"
        ? [r.frozen.first, r.frozen.second]
        : r.frozen?.reason === "capacity"
          ? [r.frozen.observed]
          : []
      ).map((e) => ({ id: e.id, number: e.body.number })),
    };
  }
  state(groupId: string): GroupAuthorityView {
    return this.store.view((tx) => this.view(tx, this.record(tx, groupId)));
  }
  /** Scheduler input only. This never grants admission and must be read in the
   * same authenticated transaction as any derived control publication. */
  syncState(groupId: string) {
    this.assertScope();
    return this.store.view((tx) => {
      const r = this.record(tx, groupId);
      return structuredClone({
        view: this.view(tx, r),
        anchor: r.anchor,
        invitation: r.invitation,
        invitationParent: r.invitationParent,
        invitationCard: r.invitationCard,
        consent: r.consent,
        leave: r.left?.request ?? null,
        leaveCard: r.left?.card ?? null,
        checkedThrough: r.checkedThrough,
        admitted: r.admitted,
      });
    });
  }
  operationStatus(id: string): GroupOperationResult | null {
    requireThat(operationID(id), "Identificador de operação inválido");
    return this.store.view((tx) => {
      const opKey = "operation:" + id,
        bytes = tx.get(opKey);
      return bytes
        ? structuredClone(this.readOperation(tx, opKey, bytes).result)
        : null;
    });
  }
  anchor(groupId: string): GroupAnchor {
    return this.store.view((tx) =>
      structuredClone(this.record(tx, groupId).anchor),
    );
  }
  list(): GroupAuthorityView[] {
    return this.store.view((tx) =>
      tx.keys("group:").map((k) => this.view(tx, this.record(tx, k.slice(6)))),
    );
  }
  proofs(
    groupId: string,
    from: number,
    count: number = AUTHORITY_LIMITS.page,
  ): GroupEpoch[] {
    requireThat(
      Number.isInteger(from) &&
        from >= 0 &&
        from < 1024 &&
        Number.isInteger(count) &&
        count >= 1 &&
        count <= AUTHORITY_LIMITS.page,
      "Pedido de provas fora dos limites",
    );
    return this.store.view((tx) => {
      const r = this.record(tx, groupId),
        result: GroupEpoch[] = [];
      for (
        let n = from;
        r.head && n <= r.head.body.number && result.length < count;
        n++
      ) {
        const e = this.header(tx, r, n);
        requireThat(e, "Cadeia protegida incompleta");
        if (
          Buffer.byteLength(canonical([...result, e])) >
          AUTHORITY_LIMITS.pageBytes
        )
          break;
        result.push(e);
      }
      return result;
    });
  }
  privateState(groupId: string, epochId: string): GroupSnapshot | null {
    return this.store.view((tx) => {
      const r = this.record(tx, groupId),
        epoch = this.findEpoch(tx, r, epochId);
      return epoch ? this.snapshot(tx, r, epoch) : null;
    });
  }
}
