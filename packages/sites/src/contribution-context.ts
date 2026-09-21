import {
  exactShape,
  type Bundle,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { siteFormBlocks } from "../../content/src/site";
import { createSiteContentProtocol } from "./content";
import { siteAddress } from "./protocol";
import {
  createSiteContributionProtocol,
  type ContributionFormContext,
} from "./contribution-protocol";

export interface ContributionFormLookup {
  action: "form";
  snapshotId: string;
  pageId: string;
  formId: string;
}
/** Copy the sole permitted locator before any async work; no caller schema or ACL. */
export function parseContributionFormLookup(
  value: unknown,
): ContributionFormLookup {
  if (!exactShape(value, ["action", "snapshotId", "pageId", "formId"]))
    throw Error("Pedido de formulário inválido");
  const q = value as ContributionFormLookup;
  if (
    q.action !== "form" ||
    typeof q.snapshotId !== "string" ||
    !/^[a-f0-9]{64}$/.test(q.snapshotId) ||
    [q.pageId, q.formId].some(
      (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id),
    )
  )
    throw Error("Pedido de formulário inválido");
  return {
    action: "form",
    snapshotId: q.snapshotId,
    pageId: q.pageId,
    formId: q.formId,
  };
}
/** This API is internal. The caller must authenticate/decrypt the exact envelope
 * before passing plaintext and must enforce block/withdrawal/session policy.
 * Future submission must resolve again, never accept this result from the UI. */
export function createContributionContextResolver(crypto: CertificateCrypto) {
  const snapshots = createSiteContentProtocol(crypto),
    proposals = createSiteContributionProtocol(crypto);
  function resolve(
    input: unknown,
    bundle: Bundle,
    plaintext: unknown,
    visitorId: string,
    now: number,
  ) {
    const lookup = parseContributionFormLookup(input),
      m = bundle.manifest;
    if (m.id !== lookup.snapshotId || m.kind !== "site")
      throw Error("Snapshot do formulário diferente do pedido");
    const parsed = snapshots.verify(plaintext, m.author);
    const binding = siteFormBlocks(parsed.content.site).find(
      (entry) =>
        entry.pageId === lookup.pageId && entry.blockId === lookup.formId,
    );
    if (!binding) throw Error("Formulário inexistente neste snapshot");
    const context: ContributionFormContext = {
      target: {
        site: siteAddress(
          parsed.revision.body.owner.id,
          parsed.revision.body.name,
        ),
        snapshotId: m.id,
        revisionId: parsed.revision.id,
        pageId: lookup.pageId,
        formId: lookup.formId,
      },
      form: binding.form,
      table: binding.table,
      siteScope:
        m.publicKey !== null
          ? "public"
          : m.keys.map((key) => key.reader).sort(),
      snapshotExpires: m.expires,
    };
    proposals.authorizeContext(context, visitorId, now);
    const page = parsed.content.site.pages.find(
      (page) => page.id === lookup.pageId,
    )!;
    const locate = (
      nodes: typeof page.blocks,
    ): (typeof page.blocks)[number] | undefined => {
      for (const node of nodes) {
        if (node.id === lookup.formId) return node;
        const child = locate(node.children ?? []);
        if (child) return child;
      }
    };
    const node = locate(page.blocks)!;
    return {
      context,
      owner: structuredClone(m.author),
      title: node.title,
      description: node.body,
    };
  }
  function describe(value: ReturnType<typeof resolve>) {
    const { context, owner, title, description } = value;
    return {
      target: structuredClone(context.target),
      owner: structuredClone(owner) as PublicIdentity,
      title,
      description,
      fields: context.table.columns.map((c, i) => ({
        ...c,
        required: context.form.fields[i].required,
      })),
      contributors: structuredClone(context.form.contributors),
      siteScope: structuredClone(context.siteScope),
      schemaHash: proposals.schemaHash(context.form, context.table),
      expires: context.snapshotExpires,
    };
  }
  return { resolve, describe };
}
