import { siteResourceBlocks } from "../../content/src/site";
import {
  matchSiteResource,
  resourceScopeCoversSite,
} from "../../content/src/site-resource";
import type { Bundle } from "../../core/src/protocol";
import { parseSiteResource } from "../../content/src/site-resource";
import { decryptBundle } from "./crypto";
export async function inspectPublicResource(bundle: Bundle) {
  if (
    bundle.manifest.kind === "site-resource" &&
    bundle.manifest.publicKey !== null
  )
    parseSiteResource(await decryptBundle(bundle));
}

export async function validateSiteResources(
  request: {
    payload: import("../../sites/src/content").SitePayload;
    context: {
      readers: import("../../core/src/protocol").PublicIdentity[] | "public";
    };
  },
  profile: import("./profile").BrowserProfile,
  blocked: readonly string[],
  withdrawn: Record<string, string> = {},
) {
  const readers =
    request.context.readers === "public"
      ? "public"
      : request.context.readers.map((card) => card.id).sort();
  const seen = new Set<string>();
  for (const { reference } of siteResourceBlocks(request.payload.site)) {
    if (seen.has(reference.bundleId)) continue;
    seen.add(reference.bundleId);
    if (withdrawn[reference.bundleId] === reference.authorId)
      throw Error(
        "O autor retirou um recurso deste site. Remove ou substitui a referência.",
      );
    if (blocked.includes(reference.authorId))
      throw Error("Autor do recurso bloqueado");
    const bundle = await profile.getBundle(reference.bundleId);
    matchSiteResource(reference, await profile.decrypt(bundle), {
      id: bundle.manifest.id,
      authorId: bundle.manifest.author.id,
      kind: bundle.manifest.kind,
    });
    const scope =
      bundle.manifest.publicKey !== null
        ? "public"
        : bundle.manifest.keys.map((k) => k.reader).sort();
    if (!resourceScopeCoversSite(readers, scope))
      throw Error("Um recurso não permite todos os leitores deste site");
  }
}
