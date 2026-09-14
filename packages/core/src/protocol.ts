// Portable wire types and canonical encoding. No runtime or filesystem imports.
export const MAX_CONTENT = 4 * 1024 * 1024;
export const CHUNK_SIZE = 24 * 1024;
export const MAX_STORED_OBJECTS = 1024;
export function canonical(value: unknown, depth = 0): string {
  if (depth > 24) throw new Error("Estrutura demasiado profunda");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map((v) => canonical(v, depth + 1)).join(",") + "]";
  if (
    typeof value === "object" &&
    value &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const o = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(o[k], depth + 1))
        .join(",") +
      "}"
    );
  }
  throw new Error("Valor não suportado");
}
export function exactShape(value: unknown, keys: readonly string[]): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(value).length === keys.length &&
    keys.every(
      (key) => Object.hasOwn(descriptors, key) && "value" in descriptors[key],
    )
  );
}
export interface PublicIdentity {
  id: string;
  name: string;
  signKey: string;
  boxKey: string;
  proof: string;
}
export interface Identity {
  public: PublicIdentity;
  signSecret: string;
  boxSecret: string;
}
export interface Sealed {
  nonce: string;
  data: string;
  tag: string;
}
export interface KeyEnvelope extends Sealed {
  reader: string;
  ephemeral: string;
}
export interface ManifestBody {
  version: 1;
  author: PublicIdentity;
  kind: string;
  created: number;
  expires: number;
  nonce: string;
  tag: string;
  chunks: { hash: string; size: number }[];
  keys: KeyEnvelope[];
  publicKey: string | null;
  salt: string;
}
export interface Manifest extends ManifestBody {
  id: string;
  signature: string;
}
export interface Bundle {
  manifest: Manifest;
  chunks: Record<string, string>;
}
