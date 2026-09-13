import { canonical } from "../../../packages/core/src/index.js";
import type {
  GroupLedger,
  StopRecord,
} from "../../../packages/groups/src/ledger.js";
import type { Outbox } from "./outbox.js";

export interface GroupRetry {
  allowed: boolean;
  reason: string;
  stop: StopRecord | null;
  seedAllowed?: boolean;
}

/** Called inside the SAME transaction as a membership change. The stop uses
 * checkpoint capacity; this deliberately does not write the private document.
 * The mirror is normalized in a caller-owned copy only after commit succeeds. */
export function reconcileGroupOutbox(ledger: GroupLedger, outbox: Outbox = {}) {
  const decisions = new Map<string, GroupRetry>();
  for (const entry of Object.values(outbox)) {
    const previous = ledger.stop(entry.operationId);
    if (!entry.groupEpoch) {
      if (previous) throw new Error("Paragem associada a um envio sem época");
      continue;
    }
    if (entry.groupStopped && !previous)
      throw new Error("Envio parado sem paragem autenticada");
    const accepted = ledger.accepted(entry.id);
    if (
      accepted &&
      (accepted.context.kind !== "message" ||
        accepted.context.author !== entry.author ||
        accepted.context.groupId !== entry.conversation ||
        accepted.context.epochId !== entry.groupEpoch ||
        accepted.expires !== entry.expires ||
        canonical(accepted.context.readers) !==
          canonical([entry.author, ...Object.keys(entry.confirmations)].sort()))
    )
      throw new Error("Admissão não corresponde à intenção de envio");
    // Expiry/unavailability do not erase an unfinished operation's immutable
    // stop context. Complete delivery facts remain complete in the projection.
    const unfinished = Object.values(entry.confirmations).some(
      (c) => c.receivedAt === undefined && c.readAt === undefined,
    );
    const decision = ledger.reconcileRetry(
      {
        operationId: entry.operationId,
        id: entry.id,
        groupId: entry.conversation,
        epochId: entry.groupEpoch,
      },
      unfinished,
    );
    decisions.set(entry.operationId, {
      ...decision,
      allowed: decision.allowed && !!accepted,
      reason:
        decision.allowed && !accepted
          ? "group-history-unavailable"
          : decision.reason,
      seedAllowed:
        !!accepted &&
        !decision.stop &&
        ledger.retryAuthority(entry.conversation, entry.groupEpoch).allowed,
    });
    entry.groupStopped = decision.stop !== null;
  }
  return decisions;
}

/** Held objects and pending group sends share the physical reservation set.
 * Pause for unavailable authority keeps bytes; only a durable stop releases it. */
export function groupOutboxReservations(outbox: Outbox = {}, now = Date.now()) {
  return Object.values(outbox)
    .filter(
      (e) =>
        e.groupEpoch &&
        !e.groupStopped &&
        e.phase !== "unavailable" &&
        e.expires > now &&
        Object.values(e.confirmations).some(
          (c) => c.receivedAt === undefined && c.readAt === undefined,
        ),
    )
    .map((e) => e.id);
}
