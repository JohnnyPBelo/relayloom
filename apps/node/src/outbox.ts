import type { GroupRetry } from "./group-outbox.js";
import { canonical, hash } from "../../../packages/core/src/index.js";
import type { Content, DisplayObject } from "./node.js";

export const OUTBOX_LIMITS = {
  pending: 128,
  bytes: 32 * 1024 * 1024,
  total: 256,
};
const address = /^[a-f0-9]{64}$/;
const operation =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type Confirmation = { receivedAt?: number; readAt?: number };
export interface OutboxEntry {
  operationId: string;
  fingerprint: string;
  id: string;
  author: string;
  conversation: string;
  preview: string;
  created: number;
  expires: number;
  priority: "sos" | "normal" | "bulk";
  bytes: number;
  phase: "preparing" | "ready" | "unavailable";
  attempts: number;
  lastAttemptAt: number;
  nextAttemptAt: number;
  lastError: string;
  manualPin: boolean;
  confirmations: Record<string, Confirmation>;
  groupEpoch?: string;
  /** Projection only. The authenticated ledger is the retry authority. */
  groupStopped?: boolean;
}
export type Outbox = Record<string, OutboxEntry>;

/** Keep the UTF-16 budget without cutting an astral character in half. */
export function outboxPreview(value: string): string {
  let end = Math.min(160, value.length);
  if (
    end < value.length &&
    /[\uD800-\uDBFF]/.test(value[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(value[end])
  )
    end--;
  return value.slice(0, end);
}
export type OutboxStatus =
  | "pending"
  | "received"
  | "read"
  | "expired"
  | "unavailable"
  | "blocked"
  | "superseded";
export interface OutboxItem extends Omit<
  OutboxEntry,
  "fingerprint" | "phase" | "confirmations"
> {
  status: OutboxStatus;
  groupAuthority?: GroupRetry;
  accepted: boolean;
  contentExpired: boolean;
  receivedCount: number;
  readCount: number;
  recipientCount: number;
  retained: boolean;
  recipients: ({ id: string } & Confirmation)[];
}

export function requireOperationId(value: unknown): string {
  if (typeof value !== "string" || !operation.test(value))
    throw new Error("Identificador de envio inválido");
  return value;
}
export function sendFingerprint(
  content: Content,
  recipients: string[],
  ttlMs: number,
) {
  if (
    !Array.isArray(recipients) ||
    recipients.length > 64 ||
    recipients.some((id) => typeof id !== "string" || !address.test(id))
  )
    throw new Error("Destinatários inválidos");
  return hash(
    canonical({ content, recipients: [...new Set(recipients)].sort(), ttlMs }),
  );
}
export function isPending(entry: OutboxEntry, now: number): boolean {
  return (
    !entry.groupStopped &&
    entry.phase !== "unavailable" &&
    entry.expires > now &&
    Object.values(entry.confirmations).some(
      (c) => c.receivedAt === undefined && c.readAt === undefined,
    )
  );
}
export function outboxItem(
  entry: OutboxEntry,
  now: number,
  blocked: string[],
  available = true,
  groupAuthority?: GroupRetry,
): OutboxItem {
  const { fingerprint: _fingerprint, phase, confirmations, ...fields } = entry;
  const recipients = Object.entries(confirmations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, c]) => ({
      id,
      ...c,
    }));
  const readCount = recipients.filter((c) => c.readAt !== undefined).length;
  const receivedCount = recipients.filter(
    (c) => c.receivedAt !== undefined || c.readAt !== undefined,
  ).length;
  const contentExpired = entry.expires <= now;
  const status: OutboxStatus =
    readCount === recipients.length
      ? "read"
      : receivedCount === recipients.length
        ? "received"
        : entry.groupStopped
          ? "superseded"
          : contentExpired
            ? "expired"
            : phase === "unavailable"
              ? "unavailable"
              : recipients.some((c) => blocked.includes(c.id))
                ? "blocked"
                : "pending";
  const retained = available && !contentExpired;
  return {
    ...structuredClone(fields),
    status,
    ...(entry.groupEpoch && groupAuthority
      ? { groupAuthority: structuredClone(groupAuthority) }
      : {}),
    contentExpired,
    accepted: phase === "ready" && retained,
    receivedCount,
    readCount,
    recipientCount: recipients.length,
    retained,
    recipients,
  };
}

/** Restored metadata is authenticated, but still must fit this runtime's schema. */
export function validateOutbox(
  value: unknown,
  owner: string,
  now = Date.now(),
): Outbox {
  const object = (v: unknown): v is Record<string, any> =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).length > OUTBOX_LIMITS.total)
    throw new Error("Estado de envios inválido");
  const result: Outbox = {};
  const ids = new Set<string>();
  const numeric = [
    "created",
    "expires",
    "bytes",
    "attempts",
    "lastAttemptAt",
    "nextAttemptAt",
  ];
  const keys = [
    "operationId",
    "fingerprint",
    "id",
    "author",
    "conversation",
    "preview",
    "created",
    "expires",
    "priority",
    "bytes",
    "phase",
    "attempts",
    "lastAttemptAt",
    "nextAttemptAt",
    "lastError",
    "manualPin",
    "confirmations",
  ];
  for (const [op, e] of Object.entries(value)) {
    requireOperationId(op);
    const grouped =
      object(e) &&
      (Object.hasOwn(e, "groupEpoch") || Object.hasOwn(e, "groupStopped"));
    const fields = grouped ? [...keys, "groupEpoch", "groupStopped"] : keys;
    if (
      !object(e) ||
      Object.keys(e).length !== fields.length ||
      fields.some((k) => !Object.hasOwn(e, k)) ||
      (grouped &&
        (typeof e.groupEpoch !== "string" ||
          !address.test(e.groupEpoch) ||
          typeof e.groupStopped !== "boolean" ||
          !address.test(e.conversation))) ||
      e.operationId !== op ||
      e.author !== owner ||
      !address.test(e.id) ||
      !address.test(e.fingerprint) ||
      ids.has(e.id) ||
      typeof e.conversation !== "string" ||
      e.conversation.length > 256 ||
      !e.conversation ||
      typeof e.preview !== "string" ||
      e.preview.length > 160 ||
      typeof e.lastError !== "string" ||
      e.lastError.length > 200 ||
      typeof e.manualPin !== "boolean" ||
      !["sos", "normal", "bulk"].includes(e.priority) ||
      !["preparing", "ready", "unavailable"].includes(e.phase) ||
      numeric.some((k) => !Number.isSafeInteger(e[k]) || e[k] < 0) ||
      e.bytes < 1 ||
      e.bytes > 6 * 1024 * 1024 ||
      e.expires <= e.created ||
      e.attempts > 1_000_000 ||
      !object(e.confirmations)
    )
      throw new Error("Registo de envio inválido");
    const readers = Object.entries(e.confirmations);
    if (!readers.length || readers.length > 63)
      throw new Error("Confirmações de envio inválidas");
    for (const [id, c] of readers) {
      if (
        !address.test(id) ||
        id === owner ||
        !object(c) ||
        Object.keys(c).some((k) => !["receivedAt", "readAt"].includes(k)) ||
        Object.values(c).some(
          (t) => !Number.isSafeInteger(t) || (t as number) < 0,
        ) ||
        (c.readAt !== undefined && c.receivedAt === undefined)
      )
        throw new Error("Confirmação de destinatário inválida");
    }
    ids.add(e.id);
    result[op] = structuredClone(e as OutboxEntry);
  }
  const pending = Object.values(result).filter((e) => isPending(e, now));
  if (
    pending.length > OUTBOX_LIMITS.pending ||
    pending.reduce((total, e) => total + e.bytes, 0) > OUTBOX_LIMITS.bytes
  )
    throw new Error("Reserva de envios excede o limite");
  return result;
}

export function admitOutbox(
  current: Outbox,
  entry: OutboxEntry,
  now: number,
): Outbox {
  const next = structuredClone(current);
  const pending = Object.values(next).filter((e) => isPending(e, now));
  if (
    pending.length >= OUTBOX_LIMITS.pending ||
    pending.reduce((n, e) => n + e.bytes, 0) + entry.bytes > OUTBOX_LIMITS.bytes
  )
    throw new Error(
      "Reserva de envios cheia. Aguarde confirmações ou expiração antes de enviar mais.",
    );
  const terminals = Object.values(next)
    .filter((e) => !isPending(e, now))
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  while (Object.keys(next).length >= OUTBOX_LIMITS.total && terminals.length)
    delete next[terminals.shift()!.operationId];
  if (Object.keys(next).length >= OUTBOX_LIMITS.total)
    throw new Error("Limite de registos de envio");
  next[entry.operationId] = entry;
  return next;
}

/** Input must already have passed signature, original-target and reader ACL checks. */
export function applyConfirmations(
  outbox: Outbox,
  accepted: DisplayObject[],
  now: number,
): boolean {
  let changed = false;
  const byId = new Map(Object.values(outbox).map((e) => [e.id, e]));
  for (const event of accepted) {
    if (event.kind !== "delivery" && event.kind !== "receipt") continue;
    const entry = byId.get(event.content.target ?? "");
    const confirmation = entry?.confirmations[event.author.id];
    if (!entry || !confirmation || entry.author === event.author.id) continue;
    if (confirmation.receivedAt === undefined) {
      confirmation.receivedAt = now;
      changed = true;
    }
    if (event.kind === "receipt" && confirmation.readAt === undefined) {
      confirmation.readAt = now;
      changed = true;
    }
  }
  return changed;
}
