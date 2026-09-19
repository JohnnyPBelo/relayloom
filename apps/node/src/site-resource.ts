import { siteResourceBlocks } from "../../../packages/content/src/site";
import {
  matchSiteResource,
  resourceScopeCoversSite,
} from "../../../packages/content/src/site-resource";
import {
  decryptBundle,
  type Bundle,
  type Identity,
} from "../../../packages/core/src/index";
import { parseSiteResource } from "../../../packages/content/src/site-resource";
/** A verified opaque envelope can transit without its read key. Readable
 * resource bodies are checked before accepting, forwarding or serving bytes. */
export function inspectResource(bundle: Bundle, identity?: Identity) {
  if (bundle.manifest.kind !== "site-resource") return;
  if (
    bundle.manifest.publicKey === null &&
    !bundle.manifest.keys.some((k) => k.reader === identity?.public.id)
  )
    return;
  parseSiteResource(decryptBundle(bundle, identity));
}

/** New publication only; retained operation outcomes never depend on current
 * resource availability. The enclosing catalogue supplies normalized input. */
export function validateSiteResources(
  request: {
    payload: import("../../../packages/sites/src/content").SitePayload;
    context: {
      readers:
        | import("../../../packages/core/src/protocol").PublicIdentity[]
        | "public";
    };
  },
  identity: Identity,
  store: import("../../../packages/core/src/index").ContentStore,
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
    const bundle = store.get(reference.bundleId, false);
    matchSiteResource(reference, decryptBundle(bundle, identity), {
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
