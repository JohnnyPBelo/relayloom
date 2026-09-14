/** Browser-native implementation of the existing v1 wire format. No Node polyfills. */
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { admittedSigningKey } from "../../core/src/signing-key";
import {
  canonical,
  exactShape,
  MAX_CONTENT,
  CHUNK_SIZE,
} from "../../core/src/protocol";
import type {
  Identity,
  PublicIdentity,
  Sealed,
  KeyEnvelope,
  Manifest,
  ManifestBody,
  Bundle,
} from "../../core/src/protocol";
export { canonical } from "../../core/src/protocol";
export type { Identity, PublicIdentity, Bundle } from "../../core/src/protocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export const utf8 = (s: string) => encoder.encode(s);
const source = (b: Uint8Array) => new Uint8Array(b).buffer;
export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export function b64(b: Uint8Array | ArrayBuffer): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export function un64(
  s: string,
  max = MAX_CONTENT * 2,
): Uint8Array<ArrayBuffer> {
  if (
    typeof s !== "string" ||
    s.length > max ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(s)
  )
    throw new Error("Codificação inválida");
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (b64(bytes) !== s) throw new Error("Codificação não canónica");
  return bytes;
}
export async function hash(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", source(bytes))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const pub = (der: string, algorithm: "Ed25519" | "X25519") =>
  crypto.subtle.importKey(
    "spki",
    un64(der, 256),
    algorithm,
    true,
    algorithm === "Ed25519" ? ["verify"] : [],
  );
const secret = (der: string, algorithm: "Ed25519" | "X25519") =>
  crypto.subtle.importKey(
    "pkcs8",
    un64(der, 256),
    algorithm,
    true,
    algorithm === "Ed25519" ? ["sign"] : ["deriveBits"],
  );
const publicBytes = ({
  id,
  name,
  signKey,
  boxKey,
}: PublicIdentity | Omit<PublicIdentity, "proof">) =>
  canonical({ id, name, signKey, boxKey });

export async function validateIdentity(
  value: PublicIdentity,
): Promise<boolean> {
  try {
    if (!exactShape(value, ["id", "name", "signKey", "boxKey", "proof"]))
      return false;
    const p = { ...value }; // Snapshot before any asynchronous crypto.
    if (
      typeof p.name !== "string" ||
      p.name.length < 1 ||
      p.name.length > 64 ||
      !admittedSigningKey(un64(p.signKey, 256)) ||
      p.id !== (await hash(un64(p.signKey, 256)))
    )
      return false;
    const signing = await pub(p.signKey, "Ed25519");
    await pub(p.boxKey, "X25519");
    return await crypto.subtle.verify(
      "Ed25519",
      signing,
      un64(p.proof, 128),
      utf8(publicBytes(p)),
    );
  } catch {
    return false;
  }
}
export async function createIdentity(name: string): Promise<Identity> {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 64)
    throw new Error("Nome inválido");
  const signing = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const boxing = (await crypto.subtle.generateKey("X25519", true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const signKey = b64(await crypto.subtle.exportKey("spki", signing.publicKey));
  const p = {
    id: await hash(un64(signKey)),
    name: name.trim(),
    signKey,
    boxKey: b64(await crypto.subtle.exportKey("spki", boxing.publicKey)),
  };
  return {
    public: {
      ...p,
      proof: b64(
        await crypto.subtle.sign(
          "Ed25519",
          signing.privateKey,
          utf8(publicBytes(p)),
        ),
      ),
    },
    signSecret: b64(await crypto.subtle.exportKey("pkcs8", signing.privateKey)),
    boxSecret: b64(await crypto.subtle.exportKey("pkcs8", boxing.privateKey)),
  };
}
export async function checkIdentity(value: Identity): Promise<void> {
  if (
    !exactShape(value, ["public", "signSecret", "boxSecret"]) ||
    !(await validateIdentity(value.public))
  )
    throw new Error("Identidade inválida");
  for (const [privateDER, publicDER, alg] of [
    [value.signSecret, value.public.signKey, "Ed25519"],
    [value.boxSecret, value.public.boxKey, "X25519"],
  ] as const) {
    const privateJwk = await crypto.subtle.exportKey(
      "jwk",
      await secret(privateDER, alg),
    );
    const publicJwk = await crypto.subtle.exportKey(
      "jwk",
      await pub(publicDER, alg),
    );
    if (privateJwk.x !== publicJwk.x)
      throw new Error("Chaves da identidade não correspondem");
  }
}
export async function seal(
  data: Uint8Array,
  key: Uint8Array,
  aad: string,
): Promise<Sealed> {
  const nonce = random(12);
  const k = await crypto.subtle.importKey(
    "raw",
    source(key),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const out = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: utf8(aad), tagLength: 128 },
      k,
      source(data),
    ),
  );
  return {
    nonce: b64(nonce),
    data: b64(out.subarray(0, -16)),
    tag: b64(out.subarray(-16)),
  };
}
export async function open(
  s: Sealed,
  key: Uint8Array,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!exactShape(s, ["nonce", "data", "tag"]))
    throw new Error("Cifra inválida");
  const nonce = un64(s.nonce, 32),
    tag = un64(s.tag, 32),
    data = un64(s.data, 12 * 1024 * 1024);
  if (nonce.length !== 12 || tag.length !== 16)
    throw new Error("Cifra inválida");
  const joined = new Uint8Array(data.length + tag.length);
  joined.set(data);
  joined.set(tag, data.length);
  const k = await crypto.subtle.importKey(
    "raw",
    source(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: utf8(aad), tagLength: 128 },
      k,
      joined,
    ),
  );
}
async function vaultKey(password: string, salt: Uint8Array) {
  if (
    typeof password !== "string" ||
    password.length > 1024 ||
    salt.length !== 16
  )
    throw new Error("Cofre inválido");
  return scryptAsync(utf8(password), salt, {
    N: 32768,
    r: 8,
    p: 1,
    dkLen: 32,
    maxmem: 64 * 1024 * 1024,
    asyncTick: 10,
  });
}
export async function exportVault(
  identity: Identity,
  password: string,
): Promise<string> {
  if (password.length < 12 || password.length > 1024)
    throw new Error("Use uma frase-passe com 12 a 1024 caracteres");
  const snapshot = JSON.parse(canonical(identity)) as Identity;
  await checkIdentity(snapshot);
  const salt = random(16),
    key = await vaultKey(password, salt);
  try {
    return JSON.stringify({
      version: 1,
      salt: b64(salt),
      sealed: await seal(utf8(canonical(snapshot)), key, "relayloom-vault-v1"),
    });
  } finally {
    key.fill(0);
  }
}
export async function importVault(
  vault: string,
  password: string,
): Promise<Identity> {
  if (typeof vault !== "string" || vault.length > 8192)
    throw new Error("Cofre inválido");
  const v = JSON.parse(vault);
  if (
    !exactShape(v, ["version", "salt", "sealed"]) ||
    v.version !== 1 ||
    !exactShape(v.sealed, ["nonce", "data", "tag"])
  )
    throw new Error("Cofre inválido");
  const key = await vaultKey(password, un64(v.salt, 32));
  try {
    const identity = JSON.parse(
      decoder.decode(await open(v.sealed, key, "relayloom-vault-v1")),
    ) as Identity;
    await checkIdentity(identity);
    return identity;
  } finally {
    key.fill(0);
  }
}
export async function hkdf(
  shared: Uint8Array,
  salt: string,
  info: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    source(shared),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: utf8(salt), info: utf8(info) },
      key,
      256,
    ),
  );
}
async function wrap(
  key: Uint8Array,
  reader: PublicIdentity,
): Promise<KeyEnvelope> {
  const ephemeral = (await crypto.subtle.generateKey("X25519", true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "X25519", public: await pub(reader.boxKey, "X25519") },
      ephemeral.privateKey,
      256,
    ),
  );
  const wrappingKey = await hkdf(shared, reader.id, "relayloom-reader-v1");
  try {
    return {
      reader: reader.id,
      ephemeral: b64(
        await crypto.subtle.exportKey("spki", ephemeral.publicKey),
      ),
      ...(await seal(key, wrappingKey, reader.id)),
    };
  } finally {
    shared.fill(0);
    wrappingKey.fill(0);
  }
}
export async function createBundle(
  identity: Identity,
  kind: string,
  payload: unknown,
  readers: PublicIdentity[] | "public",
  ttlMs = 30 * 86400_000,
): Promise<Bundle> {
  const bytes = utf8(canonical(payload));
  if (bytes.length > MAX_CONTENT) throw new Error("Conteúdo excede 4 MiB");
  if (
    !/^[a-z][a-z-]{0,31}$/.test(kind) ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1000 ||
    ttlMs > 365 * 86400_000
  )
    throw new Error("Metadados inválidos");
  const owner = JSON.parse(canonical(identity)) as Identity;
  const access: PublicIdentity[] =
    readers === "public"
      ? []
      : JSON.parse(
          canonical([
            ...new Map(
              [owner.public, ...readers].map((r) => [r.id, r]),
            ).values(),
          ]),
        );
  await checkIdentity(owner);
  if (access.length > 64) throw new Error("Destinatários inválidos");
  for (const reader of access)
    if (!(await validateIdentity(reader)))
      throw new Error("Destinatários inválidos");
  const key = random(32);
  try {
    const encrypted = await seal(bytes, key, "relayloom-content-v1"),
      ciphertext = un64(encrypted.data);
    const chunks: Record<string, string> = {},
      refs: ManifestBody["chunks"] = [];
    for (let start = 0; start < ciphertext.length; start += CHUNK_SIZE) {
      const chunk = ciphertext.subarray(start, start + CHUNK_SIZE),
        id = await hash(chunk);
      chunks[id] = b64(chunk);
      refs.push({ hash: id, size: chunk.length });
    }
    const keys: KeyEnvelope[] = [];
    for (const reader of access) keys.push(await wrap(key, reader));
    const created = Date.now();
    const body: ManifestBody = {
      version: 1,
      author: owner.public,
      kind,
      created,
      expires: created + ttlMs,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      chunks: refs,
      keys,
      publicKey: readers === "public" ? b64(key) : null,
      salt: b64(random(16)),
    };
    const encoded = canonical(body),
      id = await hash(encoded);
    const signature = b64(
      await crypto.subtle.sign(
        "Ed25519",
        await secret(owner.signSecret, "Ed25519"),
        utf8(encoded),
      ),
    );
    return { manifest: { ...body, id, signature }, chunks };
  } finally {
    key.fill(0);
  }
}
async function verifyManifestSnapshot(m: Manifest, now: number): Promise<void> {
  if (
    !exactShape(m, [
      "version",
      "author",
      "kind",
      "created",
      "expires",
      "nonce",
      "tag",
      "chunks",
      "keys",
      "publicKey",
      "salt",
      "id",
      "signature",
    ]) ||
    canonical(m).length > 100_000
  )
    throw new Error("Manifesto inválido");
  if (
    m.version !== 1 ||
    !/^[a-z][a-z-]{0,31}$/.test(m.kind) ||
    !Number.isSafeInteger(m.created) ||
    !Number.isSafeInteger(m.expires) ||
    m.created > now + 300_000 ||
    m.expires <= now ||
    m.expires <= m.created ||
    m.expires - m.created > 365 * 86400_000 + 10 ||
    !(await validateIdentity(m.author))
  )
    throw new Error("Manifesto expirado ou inválido");
  if (
    !Array.isArray(m.chunks) ||
    m.chunks.length < 1 ||
    m.chunks.length > Math.ceil(MAX_CONTENT / CHUNK_SIZE) ||
    m.chunks.some(
      (c) =>
        !exactShape(c, ["hash", "size"]) ||
        !/^[a-f0-9]{64}$/.test(c.hash) ||
        !Number.isSafeInteger(c.size) ||
        c.size < 1 ||
        c.size > CHUNK_SIZE,
    ) ||
    m.chunks.reduce((s, c) => s + c.size, 0) > MAX_CONTENT ||
    !Array.isArray(m.keys) ||
    m.keys.length > 64
  )
    throw new Error("Limite de conteúdo");
  if (
    (m.publicKey !== null && un64(m.publicKey, 48).length !== 32) ||
    (m.publicKey === null && m.keys.length < 1)
  )
    throw new Error("Chave de leitura inválida");
  if (
    un64(m.nonce, 32).length !== 12 ||
    un64(m.tag, 32).length !== 16 ||
    un64(m.salt, 32).length !== 16
  )
    throw new Error("Cifra inválida");
  for (const e of m.keys) {
    if (
      !exactShape(e, ["nonce", "data", "tag", "reader", "ephemeral"]) ||
      !/^[a-f0-9]{64}$/.test(e.reader) ||
      un64(e.nonce, 128).length !== 12 ||
      un64(e.tag, 128).length !== 16 ||
      un64(e.data, 128).length !== 32
    )
      throw new Error("Envelope inválido");
    await pub(e.ephemeral, "X25519");
  }
  const { id, signature, ...body } = m,
    encoded = canonical(body);
  if (
    id !== (await hash(encoded)) ||
    !(await crypto.subtle.verify(
      "Ed25519",
      await pub(m.author.signKey, "Ed25519"),
      un64(signature, 128),
      utf8(encoded),
    ))
  )
    throw new Error("Assinatura inválida");
}
/** Returns an owned, verified snapshot: callers never persist mutable caller data after await. */
export async function verifiedBundle(value: Bundle): Promise<Bundle> {
  if (!exactShape(value, ["manifest", "chunks"]))
    throw new Error("Campos do conteúdo inválidos");
  const encoded = canonical(value);
  if (encoded.length > 6 * 1024 * 1024) throw new Error("Limite de conteúdo");
  const b = JSON.parse(encoded) as Bundle;
  await verifyManifestSnapshot(b.manifest, Date.now());
  if (
    !b.chunks ||
    typeof b.chunks !== "object" ||
    Array.isArray(b.chunks) ||
    Object.keys(b.chunks).length > b.manifest.chunks.length
  )
    throw new Error("Fragmentos inválidos");
  for (const c of b.manifest.chunks) {
    const bytes = un64(b.chunks[c.hash], CHUNK_SIZE * 2);
    if (bytes.length !== c.size || (await hash(bytes)) !== c.hash)
      throw new Error("Conteúdo corrompido");
  }
  return b;
}
export async function verifyBundle(bundle: Bundle): Promise<void> {
  await verifiedBundle(bundle);
}
export async function decryptBundle(
  value: Bundle,
  identity?: Identity,
): Promise<unknown> {
  const who =
    identity && (JSON.parse(canonical(identity)) as Identity | undefined);
  const b = await verifiedBundle(value),
    m = b.manifest;
  let key: Uint8Array;
  if (m.publicKey) key = un64(m.publicKey);
  else {
    const e = m.keys.find((k) => k.reader === who?.public.id);
    if (!e || !who) throw new Error("Sem autorização de leitura");
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "X25519", public: await pub(e.ephemeral, "X25519") },
        await secret(who.boxSecret, "X25519"),
        256,
      ),
    );
    const wrapping = await hkdf(shared, who.public.id, "relayloom-reader-v1");
    try {
      key = await open(
        { nonce: e.nonce, data: e.data, tag: e.tag },
        wrapping,
        who.public.id,
      );
    } finally {
      shared.fill(0);
      wrapping.fill(0);
    }
  }
  try {
    const data = new Uint8Array(m.chunks.reduce((n, c) => n + c.size, 0));
    let offset = 0;
    for (const c of m.chunks) {
      data.set(un64(b.chunks[c.hash]), offset);
      offset += c.size;
    }
    return JSON.parse(
      decoder.decode(
        await open(
          { nonce: m.nonce, tag: m.tag, data: b64(data) },
          key,
          "relayloom-content-v1",
        ),
      ),
    );
  } finally {
    key.fill(0);
  }
}
