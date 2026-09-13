import {
  canonical,
  createBundle,
  decryptBundle,
  verifyBundle,
  type Identity,
  type ContentStore,
  type Bundle,
  type Manifest,
} from "../../../packages/core/src/index.js";
import type { ProfileDatabase } from "../../../packages/profile/src/database.js";
import { readProfileState } from "../../../packages/profile/src/state.js";
import { GroupLedger } from "../../../packages/groups/src/ledger.js";
import {
  GroupAccess,
  hasGroupBinding,
  parseGroupBinding,
} from "../../../packages/groups/src/access.js";
import { validateContent } from "./content-validation.js";
import type { Content } from "./node.js";

export const currentGroupEvent = (kind: string) =>
  ["edit", "reaction", "comment"].includes(kind);

/** The original bytes and authenticated admission establish the target. The
 * caller cannot supply a historical context, reader key or replacement card. */
export function commitGroupEvent(
  database: ProfileDatabase,
  identity: Identity,
  privateDigest: string,
  store: ContentStore,
  input: Content,
  recipients: string[] | "public",
  blocked: readonly string[],
  ttlMs?: number,
) {
  validateContent(input);
  if (
    ttlMs !== undefined &&
    (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 365 * 86400_000)
  )
    throw new Error("Prazo inválido");
  if (
    recipients !== "public" &&
    (!Array.isArray(recipients) ||
      recipients.length > 64 ||
      recipients.some(
        (id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id),
      ))
  )
    throw new Error("Destinatários inválidos");
  const binding = parseGroupBinding(input);
  if (
    (!currentGroupEvent(input.type) && input.type !== "delete") ||
    recipients === "public"
  )
    throw new Error("Evento privado de grupo inválido");
  const historical = input.type === "delete";
  if (binding.groupAudience !== (historical ? "historical" : "target"))
    throw new Error("Audiência de evento inválida");
  const allowedFields = [
    "type",
    "target",
    "conversation",
    "targetEpoch",
    "groupAudience",
    ...(historical
      ? []
      : [
          "groupEpoch",
          ...(input.type === "reaction" ? ["emoji", "value"] : ["text"]),
        ]),
  ];
  if (
    Object.keys(input).some((key) => !allowedFields.includes(key)) ||
    (!historical && input.type !== "reaction" && !input.text?.trim()) ||
    (input.type === "reaction" &&
      (!input.emoji?.trim() || typeof input.value !== "boolean"))
  )
    throw new Error("Campos do evento de grupo inválidos");
  const original = store.get(input.target!, false),
    targetContent = decryptBundle(original, identity) as Content;
  validateContent(targetContent);
  const targetBinding = parseGroupBinding(targetContent),
    originalReaders = original.manifest.keys.map((key) => key.reader).sort();
  if (
    original.manifest.publicKey ||
    original.manifest.kind !== "message" ||
    targetContent.type !== "message" ||
    targetBinding.conversation !== binding.conversation ||
    targetBinding.groupEpoch !== binding.targetEpoch ||
    !originalReaders.includes(identity.public.id) ||
    ((historical || input.type === "edit") &&
      original.manifest.author.id !== identity.public.id)
  )
    throw new Error("Sem autoridade para alterar este alvo de grupo");
  const protectedIds = new Set(store.list().map((manifest) => manifest.id));
  return database.transaction((tx) => {
    if (readProfileState(tx)?.digest !== privateDigest)
      throw new Error("O estado privado mudou antes do evento");
    return GroupLedger.run(tx, identity, (ledger, registry) => {
      const target = ledger.accepted(original.manifest.id);
      if (
        !target ||
        target.context.kind !== "message" ||
        target.context.author !== original.manifest.author.id ||
        target.context.groupId !== binding.conversation ||
        target.context.epochId !== binding.targetEpoch ||
        target.expires !== original.manifest.expires ||
        canonical(target.context.readers) !== canonical(originalReaders)
      )
        throw new Error("O evento exige um alvo localmente admitido");
      const epoch = historical ? binding.targetEpoch! : binding.groupEpoch!;
      if (!historical) {
        const state = registry.state(binding.conversation);
        if (state.status !== "active" || state.head?.id !== epoch)
          throw new Error(
            "O grupo mudou. Reveja a audiência antes de publicar.",
          );
      }
      const snapshot = registry.privateState(binding.conversation, epoch);
      if (!snapshot)
        throw new Error("Falta confirmar o estado privado do grupo");
      const cards = snapshot.members.filter((card) =>
        originalReaders.includes(card.id),
      );
      const readers = cards.map((card) => card.id).sort();
      if (
        !readers.includes(identity.public.id) ||
        readers.some((id) => blocked.includes(id)) ||
        canonical(readers) !==
          canonical([...new Set([...recipients, identity.public.id])].sort())
      )
        throw new Error("Destinatários diferentes da audiência autorizada");
      const remaining = original.manifest.expires - Date.now();
      if (remaining <= 0) throw new Error("O conteúdo original expirou");
      const bundle = createBundle(
        identity,
        input.type,
        structuredClone(input),
        cards,
        Math.max(1000, Math.min(ttlMs ?? remaining, remaining)),
      );
      verifyBundle(bundle);
      const verified = decryptBundle(bundle, identity) as Content;
      validateContent(verified);
      if (canonical(verified) !== canonical(input))
        throw new Error("Evento assinado incoerente");
      const admission = ledger.consider(
        {
          id: bundle.manifest.id,
          kind: input.type,
          author: identity.public,
          readers,
          public: false,
          content: verified,
        },
        bundle.manifest.expires,
        Buffer.byteLength(canonical(bundle)),
        protectedIds,
      );
      if (admission.decision.status !== "accepted")
        throw new Error("Autoridade do evento não confirmada");
      return bundle;
    }).value;
  });
}

export function localGroupEvents(
  store: ContentStore,
  identity: Identity,
  manifests: readonly Manifest[] = store.list(),
) {
  const events: { bundle: Bundle; content: Content }[] = [];
  for (const manifest of manifests) {
    if (
      manifest.author.id !== identity.public.id ||
      manifest.publicKey ||
      !currentGroupEvent(manifest.kind)
    )
      continue;
    try {
      const bundle = store.get(manifest.id, false),
        content = decryptBundle(bundle, identity) as Content;
      validateContent(content);
      if (content.type === manifest.kind && hasGroupBinding(content)) {
        parseGroupBinding(content);
        events.push({ bundle, content });
      }
    } catch {
      /* Missing/corrupt bytes cannot grant permission to a queued copy. */
    }
  }
  return events;
}

export function groupEventSeeds(
  ledger: GroupLedger,
  events: ReturnType<typeof localGroupEvents>,
  blocked: readonly string[],
  access: GroupAccess,
) {
  const allowed = new Set<string>();
  for (const { bundle, content } of events) {
    const manifest = bundle.manifest,
      accepted = ledger.accepted(manifest.id);
    const readers = manifest.keys.map((key) => key.reader).sort();
    if (
      !accepted ||
      accepted.context.kind !== manifest.kind ||
      accepted.context.author !== manifest.author.id ||
      accepted.context.groupId !== content.conversation ||
      accepted.context.epochId !== content.groupEpoch ||
      accepted.expires !== manifest.expires ||
      canonical(accepted.context.readers) !== canonical(readers) ||
      readers.some((id) => blocked.includes(id))
    )
      continue;
    const target = ledger.accepted(content.target!);
    const decision = access.decide(
      {
        id: manifest.id,
        kind: manifest.kind,
        author: manifest.author,
        readers,
        public: false,
        content,
      },
      accepted.context,
      target?.context,
    );
    if (
      decision.status === "accepted" &&
      ledger.retryAuthority(content.conversation!, content.groupEpoch!).allowed
    )
      allowed.add(manifest.id);
  }
  return allowed;
}
