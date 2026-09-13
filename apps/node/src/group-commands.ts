import type { Identity } from "../../../packages/core/src/index.js";
import type { ProfileDatabase } from "../../../packages/profile/src/database.js";
import { readProfileState } from "../../../packages/profile/src/state.js";
import { GroupLedger } from "../../../packages/groups/src/ledger.js";
import type { GroupOperationResult } from "../../../packages/groups/src/registry.js";
import type {
  GroupAnchor,
  GroupConsent,
  GroupEpoch,
  GroupInvitation,
  GroupSnapshot,
} from "../../../packages/groups/src/certificates.js";
import type { PublicIdentity } from "../../../packages/core/src/index.js";

export type GroupCommand =
  | { action: "list" }
  | { action: "state"; groupId: string }
  | { action: "operation"; operationId: string }
  | { action: "create"; operationId: string; title: string }
  | {
      action: "invite";
      operationId: string;
      groupId: string;
      expected: string;
      card: PublicIdentity;
    }
  | {
      action: "remember";
      operationId: string;
      anchor: GroupAnchor;
      parent: GroupEpoch;
      invitation: GroupInvitation;
    }
  | {
      action: "accept" | "close";
      operationId: string;
      groupId: string;
      expected: string;
    }
  | { action: "leave"; operationId: string; groupId: string }
  | {
      action: "commit";
      operationId: string;
      groupId: string;
      expected: string;
      title: string;
      members: PublicIdentity[];
      joins: GroupConsent[];
    }
  | { action: "headers"; groupId: string; headers: GroupEpoch[] }
  | {
      action: "snapshot";
      groupId: string;
      epochId: string;
      snapshot: GroupSnapshot;
    }
  | { action: "resume"; groupId: string }
  | { action: "proofs"; groupId: string; from: number; count?: number }
  | { action: "private-state"; groupId: string; epochId: string };

/** The authenticated application API owns this command boundary. Signing
 * checks/CAS happen inside the existing profile transaction. No network bytes
 * or successful response leave this function before the outer commit. */
export function executeGroupCommand(
  database: ProfileDatabase,
  identity: Identity,
  privateDigest: string,
  command: GroupCommand,
  reconcile?: (ledger: GroupLedger) => void,
) {
  if (!command || typeof command !== "object" || Array.isArray(command))
    throw new Error("Comando de grupo inválido");
  return database.transaction((tx) => {
    if (readProfileState(tx)?.digest !== privateDigest)
      throw new Error(
        "O estado privado mudou; volte a lê-lo antes de gerir o grupo",
      );
    return GroupLedger.run(tx, identity, (ledger, g) => {
      const response = (() => {
        let result: unknown;
        switch (command.action) {
          case "list":
            return {
              groups: g.list(),
              limits: { groups: 64, operations: 256 },
              management: true,
              messaging: false,
            };
          case "state":
            return { group: g.state(command.groupId) };
          case "operation":
            return { operation: g.operationStatus(command.operationId) };
          case "create":
            result = g.create(command.operationId, command.title);
            break;
          case "invite":
            result = g.invite(
              command.operationId,
              command.groupId,
              command.expected,
              command.card,
            );
            break;
          case "remember":
            result = g.rememberInvitation(
              command.operationId,
              command.anchor,
              command.parent,
              command.invitation,
            );
            break;
          case "accept":
            result = g.accept(
              command.operationId,
              command.groupId,
              command.expected,
            );
            break;
          case "commit":
            result = g.commit(
              command.operationId,
              command.groupId,
              command.expected,
              {
                title: command.title,
                members: command.members,
                joins: command.joins,
              },
            );
            break;
          case "close":
            result = g.close(
              command.operationId,
              command.groupId,
              command.expected,
            );
            break;
          case "leave":
            result = g.leave(command.operationId, command.groupId);
            break;
          case "headers":
            return {
              observation: g.observeHeaders(command.groupId, command.headers),
            };
          case "snapshot":
            return {
              group: g.observeSnapshot(
                command.groupId,
                command.epochId,
                command.snapshot,
              ),
            };
          case "resume":
            return { group: g.resumeCapacity(command.groupId) };
          case "proofs":
            return {
              anchor: g.anchor(command.groupId),
              headers: g.proofs(command.groupId, command.from, command.count),
            };
          case "private-state":
            return {
              snapshot: g.privateState(command.groupId, command.epochId),
            };
          default:
            throw new Error("Acção de grupo desconhecida");
        }
        return {
          operation: result,
          group: g.state((result as GroupOperationResult).groupId),
        };
      })();
      reconcile?.(ledger);
      return response;
    }).value;
  });
}
