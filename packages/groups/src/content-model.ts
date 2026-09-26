import { canonical } from "../../core/src/protocol";
import { applyConfirmations, type Outbox } from "../../content/src/outbox";
import type { DisplayObject } from "../../content/src/types";
import type { GroupLedger } from "./ledger";

export interface GroupMutation {
  author: string;
  expires: number;
  created: number;
  eventId: string;
  deleted?: boolean;
  text?: string;
}
export interface GroupContentState {
  mutations: Record<string, GroupMutation>;
  outbox?: Outbox;
}
/** Internal policy after complete envelope/decryption/schema verification. The
 * caller owns one authenticated transaction and commits bytes with these facts.
 * A projected object supplied by an RPC must never reach this boundary. */
export function observeGroupContent(
  ledger: Pick<GroupLedger, "accepted" | "consider" | "held">,
  object: DisplayObject,
  bytes: number,
  state: GroupContentState,
  protectedIds: ReadonlySet<string>,
  now = Date.now(),
) {
  const previousAdmission = ledger.accepted(object.id);
  if (previousAdmission && previousAdmission.expires !== object.expires)
    throw new Error("A expiração da admissão não corresponde ao conteúdo");
  const { decision, held: retained } = ledger.consider(
    {
      id: object.id,
      kind: object.kind,
      author: object.author,
      readers: object.readers,
      public: object.public,
      content: object.content,
    },
    object.expires,
    bytes,
    protectedIds,
    now,
  );
  let changed = false;
  if (decision.status === "accepted") {
    if (object.kind === "edit" || object.kind === "delete") {
      const target = ledger.accepted(object.content.target as string);
      if (!target || target.context.author !== object.author.id)
        throw new Error("Alvo de alteração sem contexto autenticado");
      const previous = state.mutations[target.context.id];
      if (previous && previous.author !== target.context.author)
        throw new Error("Autoria do histórico de alterações não coincide");
      if (
        !previous ||
        object.created > previous.created ||
        (object.created === previous.created && object.id > previous.eventId) ||
        (object.kind === "delete" && !previous.deleted)
      ) {
        state.mutations[target.context.id] = {
          author: target.context.author,
          expires: target.expires,
          created: object.created,
          eventId: object.id,
          ...(previous?.deleted || object.kind === "delete"
            ? { deleted: true }
            : { text: object.content.text ?? "" }),
        };
        changed = true;
      }
    }
    if (state.outbox && ["delivery", "receipt"].includes(object.kind)) {
      const target = ledger.accepted(object.content.target as string);
      const entry = Object.values(state.outbox).find(
        (entry) => entry.id === object.content.target,
      );
      if (
        entry &&
        (!target ||
          entry.author !== target.context.author ||
          entry.conversation !== target.context.groupId ||
          entry.expires !== target.expires ||
          entry.groupEpoch !== target.context.epochId ||
          canonical(
            [entry.author, ...Object.keys(entry.confirmations)].sort(),
          ) !== canonical(target.context.readers))
      )
        throw new Error(
          "A confirmação não corresponde à intenção de grupo retida",
        );
      changed = applyConfirmations(state.outbox, [object], now) || changed;
    }
  }
  const held = ledger.held().filter((entry) => entry.expires > now);
  return { decision, retained, changed, held };
}
