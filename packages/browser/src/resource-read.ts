import { exactShape, type Bundle } from "../../core/src/protocol";
import { siteResourceBlocks } from "../../content/src/site";
import {
  matchSiteResource,
  resourceScopeCoversSite,
} from "../../content/src/site-resource";
import type { BrowserProfile } from "./profile";
import { verifySiteContent } from "./site-content";
import { verifiedBundle } from "./crypto";

export function parseSiteResourceRead(value: any): {
  action: "inspect" | "obtain";
  snapshotId: string;
  pageId: string;
  blockId: string;
} {
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
  return {
    action: value.action,
    snapshotId: value.snapshotId,
    pageId: value.pageId,
    blockId: value.blockId,
  };
}

export async function readSiteResource(
  value: any,
  context: {
    profile: BrowserProfile;
    ensure(): void;
    blocked(): Promise<readonly string[]>;
    request(id: string): Promise<void>;
    withdrawn(id: string, authorId: string): Promise<boolean>;
  },
) {
  const { action, snapshotId, pageId, blockId } = parseSiteResourceRead(value);
  const snapshot = await context.profile.getBundle(snapshotId),
    blocked = await context.blocked();
  context.ensure();
  if (blocked.includes(snapshot.manifest.author.id))
    throw Error("Autor do site bloqueado");
  const parsed = verifySiteContent(
    (await context.profile.decrypt(snapshot)) as any,
    snapshot.manifest.author,
  );
  context.ensure();
  if (snapshot.manifest.kind !== "site" || !parsed)
    throw Error("É necessário um snapshot de site assinado e legível");
  const reference = siteResourceBlocks(parsed.content.site).find(
    (b) => b.pageId === pageId && b.blockId === blockId,
  )?.reference;
  if (!reference)
    throw Error("Este bloco não contém uma referência de recurso");
  if (blocked.includes(reference.authorId))
    return { status: "blocked", reference };
  const stillAllowed = async () => {
    const current = await context.blocked();
    context.ensure();
    return (
      !current.includes(snapshot.manifest.author.id) &&
      !current.includes(reference.authorId)
    );
  };
  if (await context.withdrawn(reference.bundleId, reference.authorId))
    return { status: "withdrawn", reference };
  context.ensure();
  let bundle: Bundle;
  try {
    bundle = await context.profile.getStoredBundle(reference.bundleId);
  } catch {
    context.ensure();
    if ((await context.profile.ids()).includes(reference.bundleId))
      return { status: "invalid", reference };
    if (action === "inspect") return { status: "missing", reference };
    context.ensure();
    if (!(await stillAllowed())) return { status: "blocked", reference };
    await context.request(reference.bundleId);
    return { status: "requested", reference };
  }
  context.ensure();
  if (
    bundle.manifest.kind !== "site-resource" ||
    bundle.manifest.author.id !== reference.authorId
  )
    return { status: "invalid", reference };
  const owner = context.profile.identity!;
  if (
    bundle.manifest.publicKey === null &&
    !bundle.manifest.keys.some((k) => k.reader === owner.id)
  )
    return { status: "unreadable", reference };
  try {
    const content = matchSiteResource(
      reference,
      await context.profile.decryptStaging(bundle),
      {
        id: bundle.manifest.id,
        authorId: bundle.manifest.author.id,
        kind: bundle.manifest.kind,
      },
    );
    context.ensure();
    const audience = (b: Bundle) =>
      b.manifest.publicKey !== null
        ? ("public" as const)
        : b.manifest.keys.map((k) => k.reader).sort();
    if (!resourceScopeCoversSite(audience(snapshot), audience(bundle)))
      return { status: "invalid", reference };
    if (bundle.manifest.expires <= Date.now())
      return { status: "expired", reference, expires: bundle.manifest.expires };
    await verifiedBundle(bundle);
    if (action === "obtain") await context.profile.view(bundle.manifest.id);
    context.ensure();
    if (!(await stillAllowed())) return { status: "blocked", reference };
    if (await context.withdrawn(reference.bundleId, reference.authorId))
      return { status: "withdrawn", reference };
    context.ensure();
    return {
      status: "available",
      reference,
      author: bundle.manifest.author,
      expires: bundle.manifest.expires,
      ...(action === "obtain" ? { content } : {}),
    };
  } catch {
    context.ensure();
    return { status: "invalid", reference };
  }
}
