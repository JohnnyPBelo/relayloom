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
