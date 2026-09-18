import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonical, exactShape } from "../../core/src/protocol";
import { parseSiteTable, type SiteTable } from "./site-data";

/** Optional P2P resource schema. This module never authenticates a caller,
 * authorises a signature, fetches a URL, writes a file or executes file content.
 * Envelope signature/chunk verification and decryption MUST precede matching. */
export const SITE_RESOURCE_LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  name: 150,
  readers: 64,
});
export const SITE_FILE_TYPES = Object.freeze([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/json",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
] as const);
const tableMime = "application/vnd.relayloom.table+json";
export type SiteResource = {
  type: "site-resource";
  domain: "relayloom/site-resource/1";
  name: string;
} & (
  | { kind: "table"; table: SiteTable }
  | { kind: "file"; mime: string; data: string }
);
export interface SiteResourceReference {
  domain: "relayloom/site-resource-reference/1";
  bundleId: string;
  authorId: string;
  kind: "table" | "file";
  name: string;
  mime: string;
  bytes: number;
  payloadHash: string;
}
export type SiteReadScope = "public" | string[];
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw Error("Recurso de site inválido: " + message);
}
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function name(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= SITE_RESOURCE_LIMITS.name &&
    v.trim().length > 0 &&
    v !== "." &&
    v !== ".." &&
    !/[\/\\\u0000-\u001f\u007f]/u.test(v)
  );
}
function decodedFile(value: unknown): string {
  requireThat(
    typeof value === "string" &&
      value.length <= Math.ceil(SITE_RESOURCE_LIMITS.fileBytes / 3) * 4 &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    "base64 ou tamanho do ficheiro",
  );
  const decoded = atob(value);
  requireThat(
    decoded.length <= SITE_RESOURCE_LIMITS.fileBytes && btoa(decoded) === value,
    "base64 não canónico",
  );
  return decoded;
}
export function parseSiteResource(value: unknown): SiteResource {
  const table = exactShape(value, ["type", "domain", "name", "kind", "table"]);
  requireThat(
    table ||
      exactShape(value, ["type", "domain", "name", "kind", "mime", "data"]),
    "campos do recurso",
  );
  const resource = value as SiteResource;
  requireThat(
    resource.type === "site-resource" &&
      resource.domain === "relayloom/site-resource/1" &&
      name(resource.name),
    "tipo, domínio ou nome",
  );
  if (table) {
    requireThat(resource.kind === "table", "tipo de tabela");
    parseSiteTable(resource.table);
  } else {
    requireThat(
      resource.kind === "file" &&
        SITE_FILE_TYPES.includes(
          resource.mime as (typeof SITE_FILE_TYPES)[number],
        ),
      "tipo de ficheiro",
    );
    decodedFile(resource.data);
  }
  return JSON.parse(canonical(resource));
}
export function parseSiteResourceReference(
  value: unknown,
): SiteResourceReference {
  requireThat(
    exactShape(value, [
      "domain",
      "bundleId",
      "authorId",
      "kind",
      "name",
      "mime",
      "bytes",
      "payloadHash",
    ]),
    "campos da referência",
  );
  const reference = value as SiteResourceReference;
  requireThat(
    reference.domain === "relayloom/site-resource-reference/1" &&
      id(reference.bundleId) &&
      id(reference.authorId) &&
      id(reference.payloadHash) &&
      name(reference.name),
    "identidade da referência",
  );
  requireThat(
    reference.kind === "table"
      ? reference.mime === tableMime
      : reference.kind === "file" &&
          SITE_FILE_TYPES.includes(
            reference.mime as (typeof SITE_FILE_TYPES)[number],
          ),
    "tipo MIME da referência",
  );
  requireThat(
    Number.isSafeInteger(reference.bytes) &&
      reference.bytes >= (reference.kind === "table" ? 1 : 0) &&
      reference.bytes <=
        (reference.kind === "table"
          ? 64 * 1024
          : SITE_RESOURCE_LIMITS.fileBytes),
    "tamanho anunciado",
  );
  return JSON.parse(canonical(reference));
}
/** Derive a descriptor from authenticated envelope metadata, not from supplied
 * names or a claimed author in the payload. All caller inputs remain untrusted. */
export function describeSiteResource(
  value: unknown,
  envelope: { id: string; authorId: string; kind: string },
): SiteResourceReference {
  requireThat(
    exactShape(envelope, ["id", "authorId", "kind"]) &&
      id(envelope.id) &&
      id(envelope.authorId) &&
      envelope.kind === "site-resource",
    "envelope do recurso",
  );
  const resource = parseSiteResource(value);
  return parseSiteResourceReference({
    domain: "relayloom/site-resource-reference/1",
    bundleId: envelope.id,
    authorId: envelope.authorId,
    kind: resource.kind,
    name: resource.name,
    mime: resource.kind === "table" ? tableMime : resource.mime,
    bytes:
      resource.kind === "table"
        ? new TextEncoder().encode(canonical(resource.table)).length
        : decodedFile(resource.data).length,
    payloadHash: bytesToHex(
      sha256(new TextEncoder().encode(canonical(resource))),
    ),
  });
}
/** A successful match says only that this plaintext/envelope matches this
 * signed-page reference. It confers neither publication nor reading rights. */
export function matchSiteResource(
  reference: unknown,
  value: unknown,
  envelope: { id: string; authorId: string; kind: string },
): SiteResource {
  const expected = parseSiteResourceReference(reference);
  requireThat(
    canonical(expected) === canonical(describeSiteResource(value, envelope)),
    "conteúdo diferente da referência assinada",
  );
  return parseSiteResource(value);
}
function scope(value: unknown): SiteReadScope {
  if (value === "public") return value;
  requireThat(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length >= 1 &&
      value.length <= SITE_RESOURCE_LIMITS.readers,
    "leitores",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from(
        { length: value.length },
        (_, i) => descriptors[String(i)],
      ).every((d) => d && "value" in d),
    "lista de leitores",
  );
  requireThat(
    value.every(
      (reader, index) =>
        id(reader) && (index === 0 || value[index - 1] < reader),
    ),
    "leitores não canónicos",
  );
  return [...value];
}
/** Use actual authenticated envelope audiences at the runtime boundary. A
 * private site's readers may be a subset; a public site needs a public resource. */
export function resourceScopeCoversSite(
  siteValue: unknown,
  resourceValue: unknown,
): boolean {
  const site = scope(siteValue),
    resource = scope(resourceValue);
  return (
    resource === "public" ||
    (site !== "public" && site.every((reader) => resource.includes(reader)))
  );
}
