import {
  canonical,
  exactShape,
  type Identity,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { validateContentShape } from "../../content/src/validation";
import type { Attachment, SiteBlock } from "../../content/src/types";
import type { SiteDocument } from "../../content/src/site";
import { createSiteRevisionProtocol, type SiteRevision } from "./protocol";

export interface SitePayload {
  type: "site";
  blocks: SiteBlock[];
  theme: "sand" | "forest" | "ink";
  site: SiteDocument;
  attachments?: Attachment[];
}
export type SiteSnapshotContent = SitePayload & { siteRevision: SiteRevision };

/** Signed snapshots use a closed authored payload. The certificate is excluded
 * from its document hash; the external bundle still authenticates the envelope. */
export function createSiteContentProtocol(crypto: CertificateCrypto) {
  const revisions = createSiteRevisionProtocol(crypto);
  function payload(value: unknown): SitePayload {
    const keys = ["type", "blocks", "theme", "site"];
    if (
      !exactShape(value, keys) &&
      !exactShape(value, [...keys, "attachments"])
    )
      throw new Error("Campos do documento de site inválidos");
    const content = value as SitePayload;
    if (
      content.type !== "site" ||
      !["sand", "forest", "ink"].includes(content.theme)
    )
      throw new Error("Documento de site inválido");
    validateContentShape({ ...content });
    revisions.documentHash(content);
    return JSON.parse(canonical(content)) as SitePayload;
  }
  function create(
    identity: Identity,
    name: string,
    number: number,
    previous: string[],
    value: unknown,
  ): SiteSnapshotContent {
    const document = payload(value);
    return {
      ...document,
      siteRevision: revisions.createRevision(
        identity,
        name,
        number,
        previous,
        revisions.documentHash(document),
      ),
    };
  }
  function verify(
    value: unknown,
    author: PublicIdentity,
    expectedName?: string,
  ) {
    const keys = ["type", "blocks", "theme", "site", "siteRevision"];
    if (
      !exactShape(value, keys) &&
      !exactShape(value, [...keys, "attachments"])
    )
      throw new Error("Campos do snapshot de site inválidos");
    if (!crypto.validateIdentity(author))
      throw new Error("Autor do envelope inválido");
    const { siteRevision, ...data } = value as SiteSnapshotContent;
    const document = payload(data),
      revision = revisions.verifyRevision(siteRevision);
    revisions.verifySnapshot(
      revision,
      document,
      author.id,
      expectedName ?? revision.body.name,
    );
    // Different verified reading cards can share the same signing owner ID.
    // A matching owner ID binds authorship, while the envelope governs readers.
    return {
      content: { ...document, siteRevision: structuredClone(revision) },
      revision: structuredClone(revision),
    };
  }
  return { payload, create, verify };
}
