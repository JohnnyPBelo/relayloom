import { groupOutboxReservations } from "./group-outbox.js";
import {
  canonical,
  decryptBundle,
  type ContentStore,
  type Identity,
} from "../../../packages/core/src/index.js";
import type { ProfileDatabase } from "../../../packages/profile/src/database.js";
import {
  readProfileState,
  writeProfileState,
} from "../../../packages/profile/src/state.js";
import {
  GroupLedger,
  type HeldRecord,
} from "../../../packages/groups/src/ledger.js";
import {
  hasGroupBinding,
  GroupAccess,
  parseGroupBinding,
  type GroupDecision,
} from "../../../packages/groups/src/access.js";
import type { Content, DisplayObject } from "./node.js";
import type { PrivateState } from "./local-state.js";
import { applyConfirmations } from "./outbox.js";
import { validateContent } from "./content-validation.js";

export interface GroupObservationResult {
  decision: GroupDecision;
  held: HeldRecord[];
  state: PrivateState;
  digest: string;
}

// Inventory verification precedes reconciliation. Actual changes still use the
// store's validation and conservative failure handling; unchanged flags do not
// trigger another full read of every quarantined payload on each UI poll.
export function reconcileGroupReservations(store: ContentStore, ids: string[]) {
  const selected = [...new Set(ids)].sort();
  if (canonical(selected) !== canonical(store.reservations()))
    store.setReservations(selected);
}

/** Immutable summaries here come only from the runtime's verified store/cache,
 * after full-schema validation. This read scope cannot grant a first admission:
 * new or changing dispositions still go through observeGroupObject's byte and
 * commit boundary. Its authority cache expires with this single snapshot. */
export function inspectGroupObjects(
  database: ProfileDatabase,
  identity: Identity,
  privateDigest: string,
  objects: readonly DisplayObject[],
  now = Date.now(),
) {
  return database.transaction((tx) => {
    if (readProfileState(tx)?.digest !== privateDigest)
      throw new Error("O estado privado mudou antes da observação");
    return GroupLedger.run(tx, identity, (ledger, registry) => {
      const access = new GroupAccess(registry, identity.public);
      const held = ledger.held().filter((entry) => entry.expires > now);
      const holds = new Map(held.map((entry) => [entry.id, entry]));
      const results = new Map<
        string,
        { decision: GroupDecision; stable: boolean }
      >();
      for (const object of objects) {
        if (object.expires <= now) {
          results.set(object.id, {
            decision: { status: "invalid", reason: "expired-content" },
            stable: true,
          });
          continue;
        }
        const previous = ledger.accepted(object.id);
        if (previous && previous.expires !== object.expires)
          throw new Error(
            "A expiração da admissão não corresponde ao conteúdo",
          );
        const targetId =
          object.kind === "message"
            ? object.content.replyTo
            : object.content.target;
        const target =
          typeof targetId === "string" ? ledger.accepted(targetId) : null;
        const decision = access.decide(
          object,
          previous?.context,
          target?.context,
        );
        const hold = holds.get(object.id);
        if (
          hold &&
          (hold.groupId !== object.content.conversation ||
            hold.epochId !==
              (object.content.groupEpoch ?? object.content.targetEpoch) ||
            hold.expires !== object.expires)
        )
          throw new Error("A quarentena não corresponde ao conteúdo imutável");
        const stable =
          decision.status === "invalid" ||
          (!!previous && !hold && decision.status === "accepted") ||
          (!!hold &&
            ["quarantine", "awaiting-proof"].includes(decision.status));
        results.set(object.id, { decision, stable });
      }
      return { results, held };
    }).value;
  });
}

/** Admission starts from verified stored bytes, never a caller-supplied display
 * summary or historical context. The whole decrypted schema is checked before
 * any projection can discard fields. */
export function observeGroupObject(
  database: ProfileDatabase,
  identity: Identity,
  privateDigest: string,
  state: PrivateState,
  store: ContentStore,
  id: string,
  protectedIds: ReadonlySet<string>,
  now = Date.now(),
): GroupObservationResult {
  const bundle = store.get(id, false);
  const content = decryptBundle(bundle, identity) as Content;
  validateContent(content);
  if (content.type !== bundle.manifest.kind || !hasGroupBinding(content))
    throw new Error("Falta a ligação de grupo válida");
  parseGroupBinding(content);
  const object: DisplayObject = {
    id,
    kind: bundle.manifest.kind,
    author: bundle.manifest.author,
    readers: bundle.manifest.keys.map((key) => key.reader),
    public: !!bundle.manifest.publicKey,
    created: bundle.manifest.created,
    expires: bundle.manifest.expires,
    pinned: store.isPinned(id),
    content,
  };
  const bytes = Buffer.byteLength(canonical(bundle));
  const available = new Set(store.list().map((manifest) => manifest.id));
  const beforeReservations = store
    .reservations()
    .filter((id) => available.has(id));
  const next = structuredClone(state);
  const result = database.transaction((tx) => {
    if (readProfileState(tx)?.digest !== privateDigest)
      throw new Error("O estado privado mudou antes da admissão");
    return GroupLedger.run(tx, identity, (ledger) => {
      const previousAdmission = ledger.accepted(id);
      if (previousAdmission && previousAdmission.expires !== object.expires)
        throw new Error("A expiração da admissão não corresponde ao conteúdo");
      const { decision } = ledger.consider(
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
          const previous = next.mutations[target.context.id];
          if (previous && previous.author !== target.context.author)
            throw new Error("Autoria do histórico de alterações não coincide");
          if (
            !previous ||
            object.created > previous.created ||
            (object.created === previous.created &&
              object.id > previous.eventId) ||
            (object.kind === "delete" && !previous.deleted)
          ) {
            next.mutations[target.context.id] = {
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
        if (next.outbox && ["delivery", "receipt"].includes(object.kind)) {
          const target = ledger.accepted(object.content.target as string);
          const entry = Object.values(next.outbox).find(
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
          changed = applyConfirmations(next.outbox, [object], now) || changed;
        }
      }
      const held = ledger.held().filter((entry) => entry.expires > now);
      const desired = [
        ...groupOutboxReservations(next.outbox, now).filter(
          (id) => available.has(id) && store.has(id),
        ),
        ...held
          .filter((entry) => available.has(entry.id) && store.has(entry.id))
          .map((entry) => entry.id),
      ];
      // Add protection before SQL commits; release prior reservations only
      // afterwards. This transaction considers one candidate, so a live hold
      // cannot be replaced by another whole provisional quarantine set.
      reconcileGroupReservations(store, [
        ...new Set([...beforeReservations, ...desired]),
      ]);
      const digest = changed
        ? writeProfileState(tx, Buffer.from(canonical(next)), privateDigest)
        : privateDigest;
      return { decision, held, state: changed ? next : state, digest };
    }).value;
  });
  // Failure here yields no successful display/receipt response. Authenticated
  // admission may have committed; the caller reopens before the next attempt.
  reconcileGroupReservations(store, [
    ...groupOutboxReservations(result.state.outbox, now).filter(
      (id) => available.has(id) && store.has(id),
    ),
    ...result.held
      .filter((entry) => available.has(entry.id) && store.has(entry.id))
      .map((entry) => entry.id),
  ]);
  return result;
}
