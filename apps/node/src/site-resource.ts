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
