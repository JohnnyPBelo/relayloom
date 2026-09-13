import {
  canonical,
  createBundle,
  decryptBundle,
  verifyBundle,
  type ContentStore,
  type Identity,
} from "../../../packages/core/src/index.js";
import type { ProfileDatabase } from "../../../packages/profile/src/database.js";
import { readProfileState } from "../../../packages/profile/src/state.js";
import { GroupLedger } from "../../../packages/groups/src/ledger.js";
import { parseGroupBinding } from "../../../packages/groups/src/access.js";
import { validateContent } from "./content-validation.js";
import type { Content } from "./node.js";

/** Authorize the minimal historical fact from actual verified original bytes
 * and local admission. No HTTP context, global contact, new audience or cached
 * display summary can grant this signature. Commit precedes storage/transport. */
export function commitGroupConfirmation(
  database: ProfileDatabase,
  identity: Identity,
  privateDigest: string,
  store: ContentStore,
  id: string,
  kind: "delivery" | "receipt",
  blocked: readonly string[],
) {
  if (!["delivery", "receipt"].includes(kind))
    throw new Error("Confirmação inválida");
  const original = store.get(id, false),
    message = decryptBundle(original, identity) as Content;
  validateContent(message);
  const binding = parseGroupBinding(message),
    readers = original.manifest.keys.map((key) => key.reader).sort();
  if (
    original.manifest.kind !== "message" ||
    message.type !== "message" ||
    !binding.groupEpoch ||
    original.manifest.publicKey ||
    original.manifest.author.id === identity.public.id ||
    !readers.includes(identity.public.id) ||
    readers.some((reader) => blocked.includes(reader))
  )
    throw new Error(
      "Esta mensagem não pode ser confirmada por esta identidade",
    );
  const cards = message.members ?? [];
  if (canonical(cards.map((card) => card.id).sort()) !== canonical(readers))
    throw new Error("Cartões da confirmação não correspondem ao original");
  const protectedIds = new Set(store.list().map((manifest) => manifest.id));
  return database.transaction((tx) => {
    if (readProfileState(tx)?.digest !== privateDigest)
      throw new Error("O estado privado mudou antes da confirmação");
    return GroupLedger.run(tx, identity, (ledger) => {
      const target = ledger.accepted(id);
      if (
        !target ||
        target.context.kind !== "message" ||
        target.context.author !== original.manifest.author.id ||
        target.context.groupId !== binding.conversation ||
        target.context.epochId !== binding.groupEpoch ||
        target.expires !== original.manifest.expires ||
        canonical(target.context.readers) !== canonical(readers)
      )
        throw new Error("A confirmação exige uma mensagem localmente admitida");
      const content: Content = {
        type: kind,
        target: id,
        conversation: binding.conversation,
        targetEpoch: binding.groupEpoch,
        groupAudience: "historical",
      };
      const bundle = createBundle(
        identity,
        kind,
        content,
        cards,
        Math.max(1000, original.manifest.expires - Date.now()),
      );
      verifyBundle(bundle);
      const verified = decryptBundle(bundle, identity) as Content;
      validateContent(verified);
      if (canonical(verified) !== canonical(content))
        throw new Error("Confirmação assinada incoerente");
      const result = ledger.consider(
        {
          id: bundle.manifest.id,
          kind,
          author: bundle.manifest.author,
          readers,
          public: false,
          content: verified,
        },
        bundle.manifest.expires,
        Buffer.byteLength(canonical(bundle)),
        protectedIds,
      );
      if (result.decision.status !== "accepted")
        throw new Error("Falta confirmar a autoridade histórica do grupo");
      return bundle;
    }).value;
  });
}
