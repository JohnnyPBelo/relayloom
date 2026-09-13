import {
  canonical,
  createBundle,
  decryptBundle,
  verifyBundle,
  type Identity,
} from "../../../packages/core/src/index.js";
import type { ProfileDatabase } from "../../../packages/profile/src/database.js";
import {
  readProfileState,
  writeProfileState,
} from "../../../packages/profile/src/state.js";
import { GroupLedger } from "../../../packages/groups/src/ledger.js";
import { parseGroupBinding } from "../../../packages/groups/src/access.js";
import type { Content } from "./node.js";
import type { PrivateState } from "./local-state.js";
import { validateContent } from "./content-validation.js";
import {
  admitOutbox,
  requireOperationId,
  outboxPreview,
  type OutboxEntry,
} from "./outbox.js";
import { reconcileGroupOutbox } from "./group-outbox.js";

/** Locally authored bytes are signed and fully verified here. The admission
 * and preparing intent commit together before the content store or network is
 * touched. This never accepts an HTTP-supplied historical context or summary.
 * A missing payload after a crash is not reconstructed from the preview. */
export function commitGroupSendIntent(
  database: ProfileDatabase,
  identity: Identity,
  state: PrivateState,
  privateDigest: string,
  operationId: string,
  fingerprint: string,
  input: Content,
  recipients: string[],
  ttlMs: number,
  blocked: readonly string[],
  protectedIds: ReadonlySet<string>,
) {
  requireOperationId(operationId);
  validateContent(input);
  const binding = parseGroupBinding(input);
  if (
    input.type !== "message" ||
    !binding.groupEpoch ||
    binding.groupAudience === "historical"
  )
    throw new Error("Esta operação exige uma mensagem de grupo");
  if (!input.text?.trim() && !input.attachments?.length)
    throw new Error("Escreva uma mensagem ou junte um anexo");
  const groupEpoch = binding.groupEpoch;
  const next = structuredClone(state);
  return database.transaction((tx) => {
    if (readProfileState(tx)?.digest !== privateDigest)
      throw new Error("O estado privado mudou antes do envio");
    return GroupLedger.run(tx, identity, (ledger, registry) => {
      reconcileGroupOutbox(ledger, next.outbox);
      if (next.outbox?.[operationId])
        throw new Error("A intenção já existe; consulte o seu estado");
      const current = registry.state(binding.conversation);
      if (current.status !== "active" || current.head?.id !== groupEpoch)
        throw new Error(
          "O grupo mudou. Reveja os destinatários antes de enviar.",
        );
      const snapshot = registry.privateState(binding.conversation, groupEpoch);
      if (!snapshot)
        throw new Error("Falta confirmar o estado privado do grupo");
      let cards = snapshot.members;
      if (binding.groupAudience === "target") {
        const target = ledger.accepted(input.replyTo!);
        if (
          !target ||
          target.context.groupId !== binding.conversation ||
          target.context.epochId !== binding.targetEpoch ||
          target.context.kind !== "message"
        )
          throw new Error(
            "A resposta exige uma mensagem de grupo já verificada",
          );
        cards = cards.filter((card) =>
          target.context.readers.includes(card.id),
        );
      }
      const ids = cards.map((card) => card.id).sort();
      if (
        ids.length < 2 ||
        !ids.includes(identity.public.id) ||
        canonical(ids) !==
          canonical([...new Set([...recipients, identity.public.id])].sort())
      )
        throw new Error(
          "Os destinatários não correspondem à audiência verificada do grupo",
        );
      if (ids.some((id) => blocked.includes(id)))
        throw new Error("Há um destinatário bloqueado");
      if (
        input.members !== undefined &&
        canonical(input.members) !== canonical(cards)
      )
        throw new Error(
          "Os cartões indicados não correspondem ao grupo verificado",
        );
      const content = { ...structuredClone(input), members: cards };
      validateContent(content);
      const bundle = createBundle(identity, "message", content, cards, ttlMs);
      verifyBundle(bundle);
      const verified = decryptBundle(bundle, identity) as Content;
      validateContent(verified);
      if (canonical(verified) !== canonical(content))
        throw new Error("O conteúdo assinado não corresponde ao envio");
      const entry: OutboxEntry = {
        operationId,
        fingerprint,
        id: bundle.manifest.id,
        author: identity.public.id,
        conversation: binding.conversation,
        groupEpoch: groupEpoch,
        groupStopped: false,
        preview: outboxPreview(
          content.text || content.attachments?.[0]?.name || "Mensagem",
        ),
        created: bundle.manifest.created,
        expires: bundle.manifest.expires,
        priority:
          content.priority ?? (content.attachments?.length ? "bulk" : "normal"),
        bytes: Buffer.byteLength(canonical(bundle)),
        phase: "preparing",
        attempts: 0,
        lastAttemptAt: 0,
        nextAttemptAt: 0,
        lastError: "",
        manualPin: false,
        confirmations: Object.fromEntries(
          ids.filter((id) => id !== identity.public.id).map((id) => [id, {}]),
        ),
      };
      next.outbox = admitOutbox(next.outbox ?? {}, entry, Date.now());
      const admission = ledger.consider(
        {
          id: entry.id,
          kind: "message",
          author: bundle.manifest.author,
          readers: bundle.manifest.keys.map((key) => key.reader),
          public: false,
          content: verified,
        },
        entry.expires,
        entry.bytes,
        new Set([
          ...protectedIds,
          ...Object.values(next.outbox).map((e) => e.id),
        ]),
      );
      if (admission.decision.status !== "accepted")
        throw new Error("A mensagem não pôde ser admitida neste grupo");
      ledger.retireStops(new Set(Object.keys(next.outbox)));
      const digest = writeProfileState(
        tx,
        Buffer.from(canonical(next)),
        privateDigest,
      );
      return { bundle, state: next, digest };
    }).value;
  });
}
