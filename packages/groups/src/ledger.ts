import { canonical, type Identity } from "../../core/src/index.js";
import {
  GroupAccess,
  type AcceptedGroupContext,
  type GroupContentCandidate,
  type GroupDecision,
} from "./access.js";
import { GroupRegistry } from "./registry.js";
import {
  RegistryCapacityError,
  RegistryIntegrityError,
  type RegistryTransaction,
} from "./storage.js";

export const GROUP_LEDGER_LIMITS = Object.freeze({
  accepted: 4096,
  held: 128,
  heldBytes: 16 * 1024 ** 2,
  stops: 256,
  stopBytes: 128 * 1024,
  lossBytes: 512,
});
const HISTORY = "group-history:",
  HELD = "group-held:",
  STOP = "group-access:stops",
  CLOCK = "group-access:clock",
  LOSSES = "group-access:losses";
const address = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(message);
}
function exact(value: any, keys: string[]) {
  insist(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
    "Campos do registo de acesso inválidos",
  );
}
function decode(bytes: Buffer, limit: number): any {
  try {
    insist(bytes.length <= limit, "Registo de acesso excessivo");
    const value = JSON.parse(bytes.toString());
    insist(
      Buffer.from(canonical(value)).equals(bytes),
      "Registo de acesso não canónico",
    );
    return value;
  } catch (error) {
    if (error instanceof RegistryIntegrityError) throw error;
    throw new RegistryIntegrityError("Registo de acesso ilegível");
  }
}
export interface HistoryRecord {
  version: 1;
  context: AcceptedGroupContext;
  observed: number;
  expires: number;
}
export interface HeldRecord {
  version: 1;
  id: string;
  groupId: string;
  epochId: string;
  status: "quarantine" | "awaiting-proof";
  reason: string;
  observed: number;
  expires: number;
  bytes: number;
}
export interface StopRecord {
  version: 1;
  operationId: string;
  id: string;
  groupId: string;
  epochId: string;
  reason: string;
  observed: number;
}
export interface LedgerLosses {
  historyRetired: number;
  historyRefused: number;
  holdRefused: number;
  holdExpired: number;
  stopRetired: number;
}
const terminalReasons = new Set([
  "group-left",
  "group-closed",
  "group-forked",
  "group-epoch-changed",
  "group-card-changed",
  "group-invalid-original-author",
]);
function context(value: any): AcceptedGroupContext {
  exact(value, ["id", "groupId", "epochId", "author", "kind", "readers"]);
  insist(
    [value.id, value.groupId, value.epochId, value.author].every(address) &&
      [
        "message",
        "edit",
        "comment",
        "reaction",
        "receipt",
        "delivery",
        "delete",
      ].includes(value.kind) &&
      Array.isArray(value.readers) &&
      value.readers.length > 0 &&
      value.readers.length <= 64 &&
      value.readers.every(address) &&
      value.readers.includes(value.author) &&
      new Set(value.readers).size === value.readers.length &&
      canonical([...value.readers].sort()) === canonical(value.readers),
    "Contexto de admissão inválido",
  );
  return value;
}

/** A scoped ledger only accepts policy-produced contexts. Callers supply verified
 * decrypted candidates, actual payload byte counts and protected retained IDs.
 * Neither an HTTP request nor a carrier may provide an accepted-history record. */
export class GroupLedger {
  private stopSnapshot?: { generation: number; entries: StopRecord[] };
  private constructor(
    private readonly tx: RegistryTransaction,
    private readonly registry: GroupRegistry,
    private readonly access: GroupAccess,
  ) {
    registry.assertScope();
    const counts = [
      tx.keys(HISTORY).length,
      tx.keys(HELD).length,
      this.stops().length,
    ];
    insist(
      counts[0] <= GROUP_LEDGER_LIMITS.accepted &&
        counts[1] <= GROUP_LEDGER_LIMITS.held &&
        counts[2] <= GROUP_LEDGER_LIMITS.stops,
      "Limites persistidos de acesso inválidos",
    );
    const clock = this.read(CLOCK, 256);
    if (clock) {
      exact(clock, ["version", "sequence"]);
      insist(
        clock.version === 1 &&
          Number.isSafeInteger(clock.sequence) &&
          clock.sequence >= 0,
        "Sequência de acesso inválida",
      );
    } else
      insist(
        counts.every((count) => count === 0),
        "Registos de acesso sem sequência",
      );
    this.losses();
  }
  static run<T>(
    tx: RegistryTransaction,
    identity: Identity,
    callback: (ledger: GroupLedger, registry: GroupRegistry) => T,
  ) {
    return GroupRegistry.inTransaction(tx, identity, (registry) =>
      callback(
        new GroupLedger(
          tx,
          registry,
          new GroupAccess(registry, identity.public),
        ),
        registry,
      ),
    );
  }
  private read(key: string, maximum: number) {
    this.registry.assertScope();
    const bytes = this.tx.get(key);
    return bytes ? decode(bytes, maximum) : null;
  }
  losses(): LedgerLosses {
    const value = this.read(LOSSES, GROUP_LEDGER_LIMITS.lossBytes);
    if (!value)
      return {
        historyRetired: 0,
        historyRefused: 0,
        holdRefused: 0,
        holdExpired: 0,
        stopRetired: 0,
      };
    exact(value, [
      "version",
      "historyRetired",
      "historyRefused",
      "holdRefused",
      "holdExpired",
      "stopRetired",
    ]);
    const { version, ...counts } = value;
    insist(
      version === 1 &&
        Object.values(counts).every(
          (v) => Number.isSafeInteger(v) && (v as number) >= 0,
        ),
      "Contadores de acesso inválidos",
    );
    return counts as unknown as LedgerLosses;
  }
  private loss(kind: keyof LedgerLosses, count = 1) {
    const value = this.losses();
    value[kind] = Math.min(Number.MAX_SAFE_INTEGER, value[kind] + count);
    this.tx.put(
      LOSSES,
      Buffer.from(canonical({ version: 1, ...value })),
      "checkpoint",
    );
  }
  private next(): number {
    const current = this.read(CLOCK, 256);
    if (current) {
      exact(current, ["version", "sequence"]);
      insist(
        current.version === 1 &&
          Number.isSafeInteger(current.sequence) &&
          current.sequence >= 0,
        "Sequência de acesso inválida",
      );
    } else
      insist(
        !this.tx.keys(HISTORY).length &&
          !this.tx.keys(HELD).length &&
          !this.tx.keys(STOP).length,
        "Registos de acesso sem sequência",
      );
    const sequence = (current?.sequence ?? 0) + 1;
    insist(Number.isSafeInteger(sequence), "Sequência de acesso esgotada");
    this.tx.put(
      CLOCK,
      Buffer.from(canonical({ version: 1, sequence })),
      "checkpoint",
    );
    return sequence;
  }
  accepted(id: string): HistoryRecord | null {
    insist(address(id), "Identificador de admissão inválido");
    const value = this.read(HISTORY + id, 8192);
    if (!value) return null;
    exact(value, ["version", "context", "observed", "expires"]);
    context(value.context);
    insist(
      value.version === 1 &&
        value.context.id === id &&
        Number.isSafeInteger(value.observed) &&
        value.observed > 0 &&
        Number.isSafeInteger(value.expires) &&
        value.expires > 0,
      "Admissão persistida inválida",
    );
    return structuredClone(value);
  }
  held(): HeldRecord[] {
    this.registry.assertScope();
    const keys = this.tx.keys(HELD);
    insist(
      keys.length <= GROUP_LEDGER_LIMITS.held,
      "Limite de quarentena inválido",
    );
    const values = keys.map((key) => {
      const value = this.read(key, 2048);
      exact(value, [
        "version",
        "id",
        "groupId",
        "epochId",
        "status",
        "reason",
        "observed",
        "expires",
        "bytes",
      ]);
      insist(
        value.version === 1 &&
          key === HELD + value.id &&
          [value.id, value.groupId, value.epochId].every(address) &&
          ["quarantine", "awaiting-proof"].includes(value.status) &&
          typeof value.reason === "string" &&
          value.reason.length <= 100 &&
          Number.isSafeInteger(value.observed) &&
          value.observed > 0 &&
          Number.isSafeInteger(value.expires) &&
          value.expires > 0 &&
          Number.isSafeInteger(value.bytes) &&
          value.bytes > 0 &&
          value.bytes <= 6 * 1024 ** 2,
        "Quarentena persistida inválida",
      );
      return value as HeldRecord;
    });
    insist(
      values.reduce((n, v) => n + v.bytes, 0) <= GROUP_LEDGER_LIMITS.heldBytes,
      "Orçamento de quarentena inválido",
    );
    return values;
  }
  private retainHeld(
    candidate: GroupContentCandidate,
    decision: Extract<
      GroupDecision,
      { status: "quarantine" | "awaiting-proof" | "invalid" }
    >,
    expires: number,
    bytes: number,
    now: number,
  ): boolean {
    if (decision.status === "invalid") return false;
    const values = this.held();
    const existing = values.find((v) => v.id === candidate.id);
    if (existing) {
      insist(
        existing.groupId === candidate.content.conversation &&
          existing.epochId ===
            (candidate.content.groupEpoch ?? candidate.content.targetEpoch) &&
          existing.bytes === bytes &&
          existing.expires === expires,
        "Quarentena não corresponde ao conteúdo imutável",
      );
      // Retain the first observation. Current disposition is returned by
      // consider(); a restrictive update must not depend on growing this row.
      return true;
    }
    const expired = values.filter((v) => v.expires <= now);
    for (const value of expired) this.tx.delete(HELD + value.id);
    if (expired.length) this.loss("holdExpired", expired.length);
    const live = values.filter((v) => v.expires > now);
    if (
      live.length >= GROUP_LEDGER_LIMITS.held ||
      live.reduce((n, v) => n + v.bytes, 0) + bytes >
        GROUP_LEDGER_LIMITS.heldBytes
    ) {
      this.loss("holdRefused");
      return false;
    }
    const groupId = candidate.content.conversation,
      epochId = candidate.content.groupEpoch ?? candidate.content.targetEpoch;
    if (!address(groupId) || !address(epochId)) return false;
    const record: HeldRecord = {
      version: 1,
      id: candidate.id,
      groupId,
      epochId,
      status: decision.status,
      reason: decision.reason,
      observed: this.next(),
      expires,
      bytes,
    };
    try {
      this.tx.put(HELD + candidate.id, Buffer.from(canonical(record)));
      return true;
    } catch (error) {
      if (error instanceof RegistryCapacityError) {
        this.loss("holdRefused");
        return false;
      }
      throw error;
    }
  }
  consider(
    candidate: GroupContentCandidate,
    expires: number,
    bytes: number,
    protectedIds: ReadonlySet<string>,
    now = Date.now(),
  ): { decision: GroupDecision; held: boolean } {
    if (
      !Number.isSafeInteger(expires) ||
      expires <= now ||
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > 6 * 1024 ** 2
    )
      throw new Error("Conteúdo de acesso fora dos limites");
    const previous = this.accepted(candidate.id);
    const targetId =
      candidate.kind === "message"
        ? candidate.content.replyTo
        : candidate.content.target;
    const target = address(targetId) ? this.accepted(targetId) : null;
    let decision = this.access.decide(
      candidate,
      previous?.context,
      target?.context,
    );
    if (decision.status === "accepted") {
      if (!previous) {
        let retire: string | undefined;
        const keys = this.tx.keys(HISTORY);
        insist(
          keys.length <= GROUP_LEDGER_LIMITS.accepted,
          "Limite de histórico inválido",
        );
        if (keys.length === GROUP_LEDGER_LIMITS.accepted) {
          const removable = keys
            .map((key) => this.accepted(key.slice(HISTORY.length))!)
            .filter(
              (value) =>
                !protectedIds.has(value.context.id) &&
                value.context.id !== targetId,
            )
            .sort(
              (a, b) =>
                a.observed - b.observed ||
                a.context.id.localeCompare(b.context.id),
            );
          if (!removable.length)
            decision = {
              status: "quarantine",
              reason: "accepted-history-capacity",
            };
          else retire = removable[0].context.id;
        }
        if (decision.status === "accepted") {
          const record: HistoryRecord = {
            version: 1,
            context: decision.context,
            observed: this.next(),
            expires,
          };
          try {
            this.tx.put(HISTORY + candidate.id, Buffer.from(canonical(record)));
          } catch (error) {
            if (!(error instanceof RegistryCapacityError)) throw error;
            decision = {
              status: "quarantine",
              reason: "accepted-history-capacity",
            };
          }
          if (decision.status === "accepted" && retire) {
            this.tx.delete(HISTORY + retire);
            this.loss("historyRetired");
          }
        }
      }
      if (decision.status === "accepted") {
        this.tx.delete(HELD + candidate.id);
        return { decision, held: false };
      }
      this.loss("historyRefused");
    }
    return {
      decision,
      held: this.retainHeld(candidate, decision, expires, bytes, now),
    };
  }
  private stops(): StopRecord[] {
    const generation = this.registry.assertScope();
    if (this.stopSnapshot?.generation === generation)
      return this.stopSnapshot.entries;
    const container = this.read(STOP, GROUP_LEDGER_LIMITS.stopBytes);
    if (!container) {
      this.stopSnapshot = { generation, entries: [] };
      return this.stopSnapshot.entries;
    }
    exact(container, ["version", "entries"]);
    insist(
      container.version === 1 &&
        Array.isArray(container.entries) &&
        container.entries.length <= GROUP_LEDGER_LIMITS.stops,
      "Limite de paragens inválido",
    );
    const ids = new Set<string>();
    for (const value of container.entries) {
      exact(value, [
        "version",
        "operationId",
        "id",
        "groupId",
        "epochId",
        "reason",
        "observed",
      ]);
      insist(
        value.version === 1 &&
          uuid(value.operationId) &&
          !ids.has(value.operationId) &&
          [value.id, value.groupId, value.epochId].every(address) &&
          terminalReasons.has(value.reason) &&
          Number.isSafeInteger(value.observed) &&
          value.observed > 0,
        "Paragem de envio inválida",
      );
      ids.add(value.operationId);
    }
    this.stopSnapshot = { generation, entries: container.entries };
    return this.stopSnapshot.entries;
  }
  private writeStops(entries: StopRecord[]) {
    const bytes = Buffer.from(canonical({ version: 1, entries }));
    if (bytes.length > GROUP_LEDGER_LIMITS.stopBytes)
      throw new RegistryCapacityError("Limite de bytes das paragens");
    if (entries.length) this.tx.put(STOP, bytes, "checkpoint");
    else this.tx.delete(STOP);
    // Only internally constructed, validated stops reach this writer. Keep an
    // owned copy; the returned StopRecord must not mutate this read snapshot.
    this.stopSnapshot = {
      generation: this.registry.assertScope(),
      entries: structuredClone(entries),
    };
  }
  stop(operationId: string): StopRecord | null {
    insist(uuid(operationId), "Identificador de envio inválido");
    return structuredClone(
      this.stops().find((value) => value.operationId === operationId) ?? null,
    );
  }
  reconcileRetry(
    entry: {
      operationId: string;
      id: string;
      groupId: string;
      epochId: string;
    },
    unfinished: boolean,
  ): { allowed: boolean; reason: string; stop: StopRecord | null } {
    const previous = this.stop(entry.operationId);
    if (previous) {
      insist(
        previous.id === entry.id &&
          previous.groupId === entry.groupId &&
          previous.epochId === entry.epochId,
        "Paragem não corresponde ao envio imutável",
      );
      return { allowed: false, reason: previous.reason, stop: previous };
    }
    if (!unfinished) return { allowed: false, reason: "completed", stop: null };
    const decision = this.access.retry(entry.groupId, entry.epochId);
    if (!decision.terminal)
      return { allowed: decision.allowed, reason: decision.reason, stop: null };
    const stops = this.stops();
    if (stops.length >= GROUP_LEDGER_LIMITS.stops)
      throw new RegistryCapacityError("Limite de paragens de envio");
    insist(
      [entry.id, entry.groupId, entry.epochId].every(address),
      "Contexto de envio inválido",
    );
    const stop: StopRecord = {
      version: 1,
      ...entry,
      reason: decision.reason,
      observed: this.next(),
    };
    this.writeStops([...stops, stop]);
    return { allowed: false, reason: stop.reason, stop };
  }
  /** Fresh read-only authority for serving an already completed local send.
   * Completion is not permission to seed into an incompatible later epoch. */
  retryAuthority(groupId: string, epochId: string) {
    this.registry.assertScope();
    return this.access.retry(groupId, epochId);
  }
  retireStops(retainedOperationIds: ReadonlySet<string>) {
    this.registry.assertScope();
    const before = this.stops(),
      after = before.filter((stop) =>
        retainedOperationIds.has(stop.operationId),
      );
    if (after.length !== before.length) {
      this.writeStops(after);
      this.loss("stopRetired", before.length - after.length);
    }
  }
  accounting() {
    const held = this.held();
    return {
      accepted: this.tx.keys(HISTORY).length,
      held: held.length,
      heldBytes: held.reduce((n, v) => n + v.bytes, 0),
      stops: this.stops().length,
      losses: this.losses(),
      limits: GROUP_LEDGER_LIMITS,
      storage: this.tx.accounting(),
    };
  }
}
