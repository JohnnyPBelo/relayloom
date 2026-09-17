import {
  canonical,
  exactShape,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { createSiteContentProtocol, type SitePayload } from "./content";
import {
  createSiteRevisionProtocol,
  siteAddress,
  SITE_REVISION_LIMITS,
} from "./protocol";

export interface SiteRequestContext {
  sequence: number;
  operationId: string;
  expectedBase: string;
  readers: PublicIdentity[] | "public";
  ttlMs: number;
  confirmedHeads?: string[];
}
export interface SitePublicationRequest extends SiteRequestContext {
  payload: SitePayload;
}

export function createSiteRequestProtocol(crypto: CertificateCrypto) {
  const snapshots = createSiteContentProtocol(crypto),
    revisions = createSiteRevisionProtocol(crypto);
  function normalize(owner: PublicIdentity, name: string, input: unknown) {
    if (!crypto.validateIdentity(owner))
      throw new Error("Proprietário inválido");
    siteAddress(owner.id, name);
    const fields = [
      "sequence",
      "operationId",
      "expectedBase",
      "readers",
      "ttlMs",
      "payload",
    ];
    if (
      !exactShape(input, fields) &&
      !exactShape(input, [...fields, "confirmedHeads"])
    )
      throw new Error("Pedido de publicação inválido");
    const value = input as SitePublicationRequest;
    if (
      Object.hasOwn(value, "confirmedHeads") &&
      (!Array.isArray(value.confirmedHeads) ||
        value.confirmedHeads.length < 2 ||
        value.confirmedHeads.length > 128 ||
        value.confirmedHeads.some(
          (id, i) =>
            typeof id !== "string" ||
            !/^[a-f0-9]{64}$/.test(id) ||
            (i > 0 && value.confirmedHeads![i - 1] >= id),
        ))
    )
      throw new Error("Confirmação das versões concorrentes inválida");
    if (
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1 ||
      value.sequence > SITE_REVISION_LIMITS.sequence ||
      typeof value.operationId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        value.operationId,
      ) ||
      typeof value.expectedBase !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.expectedBase) ||
      !Number.isSafeInteger(value.ttlMs) ||
      value.ttlMs < 1000 ||
      value.ttlMs > 365 * 86400_000
    )
      throw new Error("Parâmetros de publicação inválidos");
    let readers: PublicIdentity[] | "public" = "public";
    if (value.readers !== "public") {
      if (!Array.isArray(value.readers) || value.readers.length > 64)
        throw new Error("Leitores de site inválidos");
      const cards = new Map([[owner.id, owner]]);
      for (const card of value.readers) {
        if (!crypto.validateIdentity(card))
          throw new Error("Cartão de leitor inválido");
        const prior = cards.get(card.id);
        if (prior && canonical(prior) !== canonical(card))
          throw new Error("Cartões diferentes para o mesmo leitor");
        cards.set(card.id, card);
      }
      if (cards.size > 64) throw new Error("Demasiados leitores de site");
      readers = structuredClone(
        [...cards.values()].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      );
    }
    const payload = snapshots.payload(value.payload);
    const context: SiteRequestContext = {
      sequence: value.sequence,
      operationId: value.operationId,
      expectedBase: value.expectedBase,
      readers,
      ttlMs: value.ttlMs,
      ...(value.confirmedHeads
        ? { confirmedHeads: [...value.confirmedHeads] }
        : {}),
    };
    const fingerprint = crypto.hash(
      canonical({
        domain: "relayloom/site-publication-request/1",
        ownerId: owner.id,
        name,
        ...context,
        documentHash: revisions.documentHash(payload),
      }),
    );
    return { context, payload, fingerprint };
  }
  return { normalize };
}
