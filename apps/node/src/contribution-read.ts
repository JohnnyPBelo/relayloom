import {
  decryptBundle,
  type Identity,
  type ContentStore,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import {
  parseContributionFormLookup,
  createContributionContextResolver,
} from "../../../packages/sites/src/contribution-context";
const resolver = createContributionContextResolver(nodeCertificateCrypto);
export function readContributionForm(
  input: unknown,
  context: {
    identity: Identity;
    store: ContentStore;
    blocked(): readonly string[];
    withdrawn(id: string, authorId: string): boolean;
  },
) {
  const q = parseContributionFormLookup(input),
    bundle = context.store.get(q.snapshotId, false),
    owner = bundle.manifest.author.id;
  if (context.blocked().includes(owner)) throw Error("Autor do site bloqueado");
  if (context.withdrawn(bundle.manifest.id, owner))
    throw Error("O autor retirou este snapshot");
  const plaintext = decryptBundle(bundle, context.identity);
  const found = resolver.resolve(
    q,
    bundle,
    plaintext,
    context.identity.public.id,
    Date.now(),
  );
  return resolver.describe(found);
}
