import {
  canonical,
  exactShape,
  type Identity,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { parseSiteAddress } from "./protocol";
import {
  bindSiteForm,
  matchContributionValues,
  parseContributionValues,
  parseContributionScope,
  type SiteForm,
} from "../../content/src/site-form";
import type { SiteCell, SiteTable } from "../../content/src/site-data";
import {
  resourceScopeCoversSite,
  type SiteReadScope,
} from "../../content/src/site-resource";

export const SITE_CONTRIBUTION_LIMITS = Object.freeze({
  bytes: 16 * 1024,
  lifetimeMs: 30 * 86400_000,
  clockSkewMs: 300_000, // Match the existing authenticated envelope policy.
});
export interface ContributionTarget {
  site: string;
  snapshotId: string;
  revisionId: string;
  pageId: string;
  formId: string;
}
export interface SiteContributionBody {
  domain: "relayloom/site-contribution/1";
  contributor: PublicIdentity;
  target: ContributionTarget;
  schemaHash: string;
  operationId: string;
  created: number;
  expires: number;
  values: Record<string, SiteCell>;
  publicationScope: SiteReadScope;
}
export interface SiteContribution {
  body: SiteContributionBody;
  id: string;
  signature: string;
}
export type ContributionRequest = Omit<
  SiteContributionBody,
  "domain" | "contributor"
>;
/** Supplied by the runtime only after signature/decryption validation of the site.
 * This type is intentionally not an HTTP/Worker command or an approval capability. */
export interface ContributionFormContext {
  target: ContributionTarget;
  form: SiteForm;
  table: SiteTable;
  siteScope: SiteReadScope;
  snapshotExpires: number;
}
const hashID = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nodeID = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw Error("Proposta de site inválida: " + message);
}
function target(value: unknown): asserts value is ContributionTarget {
  requireThat(
    exactShape(value, ["site", "snapshotId", "revisionId", "pageId", "formId"]),
    "destino",
  );
  const t = value as ContributionTarget;
  parseSiteAddress(t.site);
  requireThat(
    hashID(t.snapshotId) &&
      hashID(t.revisionId) &&
      nodeID(t.pageId) &&
      nodeID(t.formId),
    "referência do snapshot",
  );
}
function time(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Uses the same maintained certificate adapters as site/group ownership.
 * Verifying a visitor signature is never owner approval or a site revision. */
export function createSiteContributionProtocol(crypto: CertificateCrypto) {
  function bounded(value: unknown) {
    const text = canonical(value);
    requireThat(
      new TextEncoder().encode(text).length <= SITE_CONTRIBUTION_LIMITS.bytes,
      "orçamento",
    );
    return text;
  }
  function body(value: unknown): asserts value is SiteContributionBody {
    requireThat(
      exactShape(value, [
        "domain",
        "contributor",
        "target",
        "schemaHash",
        "operationId",
        "created",
        "expires",
        "values",
        "publicationScope",
      ]),
      "campos",
    );
    const b = value as SiteContributionBody;
    requireThat(
      b.domain === "relayloom/site-contribution/1" &&
        crypto.validateIdentity(b.contributor),
      "autor ou domínio",
    );
    target(b.target);
    requireThat(
      hashID(b.schemaHash) &&
        typeof b.operationId === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          b.operationId,
        ),
      "esquema ou operação",
    );
    requireThat(
      time(b.created) &&
        time(b.expires) &&
        b.expires > b.created &&
        b.expires - b.created <= SITE_CONTRIBUTION_LIMITS.lifetimeMs,
      "prazo",
    );
    parseContributionValues(b.values);
    const scope = parseContributionScope(b.publicationScope),
      { ownerId } = parseSiteAddress(b.target.site);
    requireThat(
      scope === "public" ||
        (scope.includes(ownerId) && scope.includes(b.contributor.id)),
      "leitores de publicação",
    );
    bounded(b);
  }
  /** Historical authenticity check; expiry/admission, persistence and approval
   * are separate. Returning an owned copy prevents caller mutation of evidence. */
  function verify(input: unknown): SiteContribution {
    requireThat(exactShape(input, ["body", "id", "signature"]), "certificado");
    const value = input as SiteContribution;
    body(value.body);
    requireThat(
      hashID(value.id) &&
        typeof value.signature === "string" &&
        value.signature.length === 88,
      "assinatura",
    );
    const bytes = Uint8Array.from(atob(value.signature), (c) =>
      c.charCodeAt(0),
    );
    requireThat(
      bytes.length === 64 &&
        btoa(String.fromCharCode(...bytes)) === value.signature,
      "assinatura não canónica",
    );
    const text = bounded(value.body);
    requireThat(
      value.id === crypto.hash(text) &&
        crypto.verify(value.body.contributor, text, bytes),
      "assinatura ou hash",
    );
    return JSON.parse(bounded(value));
  }
  function create(
    identity: Identity,
    input: ContributionRequest,
  ): SiteContribution {
    requireThat(
      exactShape(input, [
        "target",
        "schemaHash",
        "operationId",
        "created",
        "expires",
        "values",
        "publicationScope",
      ]),
      "pedido",
    );
    const value: SiteContributionBody = {
      domain: "relayloom/site-contribution/1",
      contributor: identity.public,
      ...input,
    };
    body(value);
    const owned = JSON.parse(bounded(value)),
      text = bounded(owned);
    return verify({
      body: owned,
      id: crypto.hash(text),
      signature: crypto.sign(identity, text),
    });
  }
  function schemaHash(formInput: unknown, tableInput: unknown) {
    const { form, table } = bindSiteForm(formInput, tableInput);
    return crypto.hash(
      bounded({
        domain: "relayloom/site-form-schema/1",
        form,
        columns: table.columns,
      }),
    );
  }
  /** Policy over a runtime-derived authenticated snapshot, never caller authority. */
  function authorizeContext(
    context: ContributionFormContext,
    contributorId: string,
    now: number,
  ) {
    target(context.target);
    requireThat(
      hashID(contributorId) &&
        time(now) &&
        time(context.snapshotExpires) &&
        context.snapshotExpires > now,
      "contexto expirado ou identidade inválida",
    );
    const bound = bindSiteForm(context.form, context.table);
    const scope = parseContributionScope(context.siteScope),
      { ownerId } = parseSiteAddress(context.target.site);
    requireThat(
      scope === "public" ||
        (scope.includes(ownerId) && scope.includes(contributorId)),
      "autor sem leitura do site",
    );
    requireThat(
      bound.form.contributors === "readers" ||
        bound.form.contributors.includes(contributorId),
      "autor sem permissão de proposta",
    );
    return bound;
  }
  /** Check the proposal against authenticated source data. A runtime must still
   * enforce blocking, current-head CAS, durable replay controls and owner consent
   * before adopting anything. This method does not sign or mutate a page. */
  function verifyForForm(
    input: unknown,
    context: ContributionFormContext,
    now: number,
  ): SiteContribution {
    const proposal = verify(input),
      b = proposal.body;
    target(context.target);
    requireThat(
      time(now) && time(context.snapshotExpires),
      "horário de admissão",
    );
    requireThat(
      canonical(b.target) === canonical(context.target),
      "base ou formulário diferentes",
    );
    const { form, table } = authorizeContext(context, b.contributor.id, now);
    requireThat(b.schemaHash === schemaHash(form, table), "esquema diferente");
    matchContributionValues(form, table, b.values);
    const siteScope = parseContributionScope(context.siteScope);
    requireThat(
      b.created - now <= SITE_CONTRIBUTION_LIMITS.clockSkewMs &&
        b.expires > now &&
        b.expires <= context.snapshotExpires,
      "proposta expirada ou futura",
    );
    requireThat(
      resourceScopeCoversSite(siteScope, b.publicationScope),
      "divulgação não consentida",
    );
    return proposal;
  }
  return { create, verify, schemaHash, verifyForForm, authorizeContext };
}
