import type { BrowserProfile } from "./profile";
import { browserCertificateCrypto } from "./certificate-crypto";
import {
  parseContributionFormLookup,
  createContributionContextResolver,
} from "../../sites/src/contribution-context";
const resolver = createContributionContextResolver(browserCertificateCrypto);
export async function readContributionForm(
  input: unknown,
  context: {
    profile: BrowserProfile;
    ensure(): void;
    policy(
      id: string,
      authorId: string,
    ): Promise<{ blocked: readonly string[]; withdrawn: boolean }>;
  },
) {
  const q = parseContributionFormLookup(input),
    visitor = context.profile.identity,
    generation = context.profile.sessionGeneration;
  const ensure = () => {
    context.ensure();
    if (context.profile.sessionGeneration !== generation)
      throw Error("Sessão de formulário bloqueada");
  };
  ensure();
  if (!visitor) throw Error("Desbloqueia a identidade");
  const bundle = await context.profile.getBundle(q.snapshotId);
  ensure();
  const author = bundle.manifest.author.id;
  const allowed = async () => {
    const policy = await context.policy(bundle.manifest.id, author);
    ensure();
    if (policy.blocked.includes(author)) throw Error("Autor do site bloqueado");
    if (policy.withdrawn) throw Error("O autor retirou este snapshot");
  };
  await allowed();
  const plaintext = await context.profile.decrypt(bundle);
  ensure();
  const found = resolver.resolve(q, bundle, plaintext, visitor.id, Date.now());
  await allowed();
  ensure();
  // Recheck the deadline after every awaited policy read.
  if (found.context.snapshotExpires <= Date.now())
    throw Error("Snapshot expirado");
  return resolver.describe(found);
}
