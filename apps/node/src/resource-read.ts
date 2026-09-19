import { exactShape } from "../../../packages/core/src/protocol";
import {
  type Identity,
  type ContentStore,
  type Bundle,
  verifyBundle,
  decryptStoredBundle,
} from "../../../packages/core/src/index";
import { siteResourceBlocks } from "../../../packages/content/src/site";
import {
  matchSiteResource,
  resourceScopeCoversSite,
} from "../../../packages/content/src/site-resource";
import { inspectSite } from "./site-runtime";

export function readSiteResource(
  value: any,
  context: {
    identity: Identity;
    store: ContentStore;
    blocked(): readonly string[];
    request(id: string): void;
    withdrawn(id: string, authorId: string): boolean;
  },
) {
  if (
    !exactShape(value, ["action", "snapshotId", "pageId", "blockId"]) ||
    !["inspect", "obtain"].includes(value.action) ||
    typeof value.snapshotId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.snapshotId) ||
    typeof value.pageId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.pageId) ||
    typeof value.blockId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.blockId)
  )
    throw Error("Pedido de recurso do site inválido");
  const { action, snapshotId, pageId, blockId } = value;
  const snapshot = context.store.get(snapshotId, false);
  if (context.blocked().includes(snapshot.manifest.author.id))
    throw Error("Autor do site bloqueado");
  const parsed = inspectSite(snapshot, context.identity);
  if (!parsed)
    throw Error("É necessário um snapshot de site assinado e legível");
  const reference = siteResourceBlocks(parsed.content.site).find(
    (b) => b.pageId === pageId && b.blockId === blockId,
  )?.reference;
  if (!reference)
    throw Error("Este bloco não contém uma referência de recurso");
  if (context.blocked().includes(reference.authorId))
    return { status: "blocked", reference };
  if (context.withdrawn(reference.bundleId, reference.authorId))
    return { status: "withdrawn", reference };
  let bundle: Bundle;
  try {
    bundle = context.store.getStored(reference.bundleId);
  } catch {
    if (context.store.hasRecord(reference.bundleId))
      return { status: "invalid", reference };
    if (action === "inspect") return { status: "missing", reference };
    context.request(reference.bundleId);
    return { status: "requested", reference };
  }
  if (
    bundle.manifest.kind !== "site-resource" ||
    bundle.manifest.author.id !== reference.authorId
  )
    return { status: "invalid", reference };
  if (
    bundle.manifest.publicKey === null &&
    !bundle.manifest.keys.some((k) => k.reader === context.identity.public.id)
  )
    return { status: "unreadable", reference };
  try {
    const content = matchSiteResource(
      reference,
      decryptStoredBundle(bundle, context.identity),
      {
        id: bundle.manifest.id,
        authorId: bundle.manifest.author.id,
        kind: bundle.manifest.kind,
      },
    );
    const audience = (b: Bundle) =>
      b.manifest.publicKey !== null
        ? ("public" as const)
        : b.manifest.keys.map((k) => k.reader).sort();
    if (!resourceScopeCoversSite(audience(snapshot), audience(bundle)))
      return { status: "invalid", reference };
    if (bundle.manifest.expires <= Date.now())
      return { status: "expired", reference, expires: bundle.manifest.expires };
    verifyBundle(bundle);
    if (action === "obtain") context.store.get(bundle.manifest.id);
    return {
      status: "available",
      reference,
      author: bundle.manifest.author,
      expires: bundle.manifest.expires,
      ...(action === "obtain" ? { content } : {}),
    };
  } catch {
    return { status: "invalid", reference };
  }
}
