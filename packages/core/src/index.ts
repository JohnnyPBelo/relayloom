import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  diffieHellman,
  hkdfSync,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
  readdirSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const MAX_CONTENT = 4 * 1024 * 1024;
export const CHUNK_SIZE = 24 * 1024;
export const MAX_STORED_OBJECTS = 1024;
const MAX_STORED_BUNDLE = 6 * 1024 * 1024;
export function hash(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
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
export function atomic(path: string, data: string | Buffer): void {
  const temp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    // POSIX filesystems need the rename's directory entry flushed too. Node
    // does not expose a portable directory flush on Windows; document that
    // platform limitation instead of silently promising power-loss survival.
    if (process.platform !== "win32") {
      fd = openSync(dirname(path), "r");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}
function b64(b: Buffer | ArrayBuffer): string {
  return Buffer.from(b as Buffer).toString("base64");
}
function un64(s: string, max = MAX_CONTENT * 2): Buffer {
  if (
    typeof s !== "string" ||
    s.length > max ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(s)
  )
    throw new Error("Codificação inválida");
  const b = Buffer.from(s, "base64");
  if (b.toString("base64") !== s) throw new Error("Codificação não canónica");
  return b;
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
function publicBytes(p: Omit<PublicIdentity, "proof">): string {
  return canonical({
    id: p.id,
    name: p.name,
    signKey: p.signKey,
    boxKey: p.boxKey,
  });
}
function exactShape(value: unknown, keys: readonly string[]): boolean {
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
export function validateIdentity(p: PublicIdentity): boolean {
  try {
    if (
      !exactShape(p, ["id", "name", "signKey", "boxKey", "proof"]) ||
      typeof p.name !== "string" ||
      p.name.length < 1 ||
      p.name.length > 64 ||
      p.id !== hash(un64(p.signKey, 256))
    )
      return false;
    const sp = createPublicKey({
      key: un64(p.signKey, 256),
      format: "der",
      type: "spki",
    });
    const bp = createPublicKey({
      key: un64(p.boxKey, 256),
      format: "der",
      type: "spki",
    });
    return (
      sp.asymmetricKeyType === "ed25519" &&
      bp.asymmetricKeyType === "x25519" &&
      verify(null, Buffer.from(publicBytes(p)), sp, un64(p.proof, 128))
    );
  } catch {
    return false;
  }
}
export function createIdentity(name: string): Identity {
  if (!name.trim() || name.trim().length > 64) throw new Error("Nome inválido");
  const s = generateKeyPairSync("ed25519"),
    x = generateKeyPairSync("x25519");
  const signKey = b64(s.publicKey.export({ format: "der", type: "spki" }));
  const p = {
    id: hash(un64(signKey)),
    name: name.trim(),
    signKey,
    boxKey: b64(x.publicKey.export({ format: "der", type: "spki" })),
  };
  return {
    public: {
      ...p,
      proof: b64(sign(null, Buffer.from(publicBytes(p)), s.privateKey)),
    },
    signSecret: b64(s.privateKey.export({ format: "der", type: "pkcs8" })),
    boxSecret: b64(x.privateKey.export({ format: "der", type: "pkcs8" })),
  };
}
function privateKey(secret: string) {
  return createPrivateKey({
    key: un64(secret, 256),
    format: "der",
    type: "pkcs8",
  });
}
interface Sealed {
  nonce: string;
  data: string;
  tag: string;
}
function seal(data: Buffer, key: Buffer, aad: string): Sealed {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  return {
    nonce: b64(nonce),
    data: b64(Buffer.concat([cipher.update(data), cipher.final()])),
    tag: b64(cipher.getAuthTag()),
  };
}
function open(s: Sealed, key: Buffer, aad: string): Buffer {
  const nonce = un64(s.nonce, 32),
    tag = un64(s.tag, 32);
  if (nonce.length !== 12 || tag.length !== 16)
    throw new Error("Cifra inválida");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(un64(s.data)), decipher.final()]);
}
export function exportVault(identity: Identity, password: string): string {
  if (password.length < 12 || password.length > 1024)
    throw new Error("Use uma frase-passe com 12 a 1024 caracteres");
  const salt = randomBytes(16),
    key = scryptSync(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  return JSON.stringify({
    version: 1,
    salt: b64(salt),
    sealed: seal(Buffer.from(canonical(identity)), key, "relayloom-vault-v1"),
  });
}
export function importVault(vault: string, password: string): Identity {
  if (vault.length > 8192 || password.length > 1024)
    throw new Error("Cofre inválido");
  const v = JSON.parse(vault);
  if (
    !exactShape(v, ["version", "salt", "sealed"]) ||
    !exactShape(v.sealed, ["nonce", "data", "tag"])
  )
    throw new Error("Campos do cofre inválidos");
  if (v.version !== 1) throw new Error("Versão do cofre inválida");
  const salt = un64(v.salt, 32);
  if (salt.length !== 16) throw new Error("Cofre inválido");
  const key = scryptSync(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const i: Identity = JSON.parse(
    open(v.sealed, key, "relayloom-vault-v1").toString(),
  );
  if (
    !exactShape(i, ["public", "signSecret", "boxSecret"]) ||
    !validateIdentity(i.public) ||
    b64(
      createPublicKey(privateKey(i.signSecret)).export({
        format: "der",
        type: "spki",
      }),
    ) !== i.public.signKey ||
    b64(
      createPublicKey(privateKey(i.boxSecret)).export({
        format: "der",
        type: "spki",
      }),
    ) !== i.public.boxKey
  )
    throw new Error("Identidade inválida");
  return i;
}
interface KeyEnvelope extends Sealed {
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
const aad = "relayloom-content-v1";
function wrap(key: Buffer, reader: PublicIdentity): KeyEnvelope {
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({
      key: un64(reader.boxKey),
      format: "der",
      type: "spki",
    }),
  });
  const wrappingKey = Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      Buffer.from(reader.id),
      Buffer.from("relayloom-reader-v1"),
      32,
    ),
  );
  return {
    reader: reader.id,
    ephemeral: b64(ephemeral.publicKey.export({ format: "der", type: "spki" })),
    ...seal(key, wrappingKey, reader.id),
  };
}
export function createBundle(
  identity: Identity,
  kind: string,
  payload: unknown,
  readers: PublicIdentity[] | "public",
  ttlMs = 30 * 86400_000,
): Bundle {
  const bytes = Buffer.from(canonical(payload));
  if (bytes.length > MAX_CONTENT) throw new Error("Conteúdo excede 4 MiB");
  if (
    !/^[a-z][a-z-]{0,31}$/.test(kind) ||
    ttlMs < 1000 ||
    ttlMs > 365 * 86400_000
  )
    throw new Error("Metadados inválidos");
  const access =
    readers === "public"
      ? []
      : [
          ...new Map(
            [identity.public, ...readers].map((r) => [r.id, r]),
          ).values(),
        ];
  if (access.length > 64 || access.some((r) => !validateIdentity(r)))
    throw new Error("Destinatários inválidos");
  const key = randomBytes(32),
    encrypted = seal(bytes, key, aad),
    ciphertext = un64(encrypted.data),
    chunks: Record<string, string> = {};
  const refs: ManifestBody["chunks"] = [];
  for (let start = 0; start < ciphertext.length; start += CHUNK_SIZE) {
    const chunk = ciphertext.subarray(start, start + CHUNK_SIZE),
      id = hash(chunk);
    chunks[id] = b64(chunk);
    refs.push({ hash: id, size: chunk.length });
  }
  const body: ManifestBody = {
    version: 1,
    author: identity.public,
    kind,
    created: Date.now(),
    expires: Date.now() + ttlMs,
    nonce: encrypted.nonce,
    tag: encrypted.tag,
    chunks: refs,
    keys: access.map((r) => wrap(key, r)),
    publicKey: readers === "public" ? b64(key) : null,
    salt: b64(randomBytes(16)),
  };
  const canonicalBody = canonical(body),
    id = hash(canonicalBody),
    signature = b64(
      sign(null, Buffer.from(canonicalBody), privateKey(identity.signSecret)),
    );
  return { manifest: { ...body, id, signature }, chunks };
}
export function verifyManifest(m: Manifest, now = Date.now()): void {
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
  const { id, signature, ...body } = m;
  if (
    m.version !== 1 ||
    !validateIdentity(m.author) ||
    !/^[a-z][a-z-]{0,31}$/.test(m.kind) ||
    !Number.isSafeInteger(m.created) ||
    !Number.isSafeInteger(m.expires) ||
    m.created > now + 300_000 ||
    m.expires <= now ||
    m.expires <= m.created ||
    m.expires - m.created > 365 * 86400_000 + 10
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
  if (m.publicKey !== null && un64(m.publicKey, 48).length !== 32)
    throw new Error("Chave pública inválida");
  if (m.publicKey === null && m.keys.length < 1)
    throw new Error("Sem destinatários");
  if (
    un64(m.nonce, 32).length !== 12 ||
    un64(m.tag, 32).length !== 16 ||
    un64(m.salt, 32).length !== 16
  )
    throw new Error("Cifra inválida");
  for (const envelope of m.keys) {
    if (
      !exactShape(envelope, ["nonce", "data", "tag", "reader", "ephemeral"]) ||
      !/^[a-f0-9]{64}$/.test(envelope.reader)
    )
      throw new Error("Envelope inválido");
    const key = createPublicKey({
      key: un64(envelope.ephemeral, 256),
      format: "der",
      type: "spki",
    });
    if (
      key.asymmetricKeyType !== "x25519" ||
      un64(envelope.nonce, 128).length !== 12 ||
      un64(envelope.tag, 128).length !== 16 ||
      un64(envelope.data, 128).length !== 32
    )
      throw new Error("Envelope inválido");
  }
  const bytes = canonical(body);
  if (
    id !== hash(bytes) ||
    !verify(
      null,
      Buffer.from(bytes),
      createPublicKey({
        key: un64(m.author.signKey),
        format: "der",
        type: "spki",
      }),
      un64(signature, 128),
    )
  )
    throw new Error("Assinatura inválida");
}
export function verifyBundle(bundle: Bundle): void {
  if (!exactShape(bundle, ["manifest", "chunks"]))
    throw new Error("Campos do conteúdo inválidos");
  verifyManifest(bundle.manifest);
  if (
    !bundle.chunks ||
    Object.keys(bundle.chunks).length > bundle.manifest.chunks.length
  )
    throw new Error("Fragmentos inválidos");
  for (const c of bundle.manifest.chunks) {
    const b = un64(bundle.chunks[c.hash], CHUNK_SIZE * 2);
    if (b.length !== c.size || hash(b) !== c.hash)
      throw new Error("Conteúdo corrompido");
  }
}
export function decryptBundle(bundle: Bundle, identity?: Identity): unknown {
  verifyBundle(bundle);
  const m = bundle.manifest;
  let key: Buffer;
  if (m.publicKey) key = un64(m.publicKey);
  else {
    const envelope = m.keys.find((k) => k.reader === identity?.public.id);
    if (!envelope || !identity) throw new Error("Sem autorização de leitura");
    const shared = diffieHellman({
      privateKey: privateKey(identity.boxSecret),
      publicKey: createPublicKey({
        key: un64(envelope.ephemeral, 256),
        format: "der",
        type: "spki",
      }),
    });
    key = open(
      envelope,
      Buffer.from(
        hkdfSync(
          "sha256",
          shared,
          Buffer.from(identity.public.id),
          Buffer.from("relayloom-reader-v1"),
          32,
        ),
      ),
      identity.public.id,
    );
  }
  const data = b64(
    Buffer.concat(m.chunks.map((c) => un64(bundle.chunks[c.hash]))),
  );
  return JSON.parse(
    open({ nonce: m.nonce, tag: m.tag, data }, key, aad).toString("utf8"),
  );
}
interface Entry {
  size: number;
  pinned: boolean;
  accessed: number;
  expires: number;
}
export class ContentStore {
  private index: Record<string, Entry> = {};
  private manifests = new Map<
    string,
    { manifest: Manifest; fingerprint: string }
  >();
  constructor(
    public readonly dir: string,
    public quota = 128 * 1024 * 1024,
    public readonly maxObjects = MAX_STORED_OBJECTS,
  ) {
    if (
      !Number.isSafeInteger(quota) ||
      quota < 1 ||
      quota > 1024 ** 3 ||
      !Number.isSafeInteger(maxObjects) ||
      maxObjects < 1 ||
      maxObjects > MAX_STORED_OBJECTS
    )
      throw new Error("Limites de armazenamento inválidos");
    mkdirSync(join(dir, "objects"), { recursive: true, mode: 0o700 });
    if (existsSync(join(dir, "index.json"))) {
      const index: unknown = JSON.parse(
        readFileSync(join(dir, "index.json"), "utf8"),
      );
      if (!index || typeof index !== "object" || Array.isArray(index))
        throw new Error("Índice de armazenamento inválido");
      this.index = index as Record<string, Entry>;
    }
    // Reconcile crash leftovers from atomic object/index transactions; never trust stale accounting.
    for (const file of readdirSync(join(dir, "objects"))) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const id = file.slice(0, -5);
      try {
        const fileState = this.fileState(id),
          bundle: Bundle = JSON.parse(fileState.bytes.toString("utf8"));
        if (bundle.manifest.id !== id)
          throw new Error("Endereço não corresponde");
        verifyBundle(bundle);
        this.index[id] = {
          size: fileState.size,
          pinned: this.index[id]?.pinned === true,
          accessed: Number.isSafeInteger(this.index[id]?.accessed)
            ? this.index[id].accessed
            : Date.now(),
          expires: bundle.manifest.expires,
        };
      } catch {
        delete this.index[id];
        unlinkSync(this.path(id));
      }
    }
    for (const id of Object.keys(this.index))
      if (!/^[a-f0-9]{64}$/.test(id) || !existsSync(this.path(id)))
        delete this.index[id];
    this.removeEntries(this.evictionPlan(0));
    this.save();
  }
  private path(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Endereço inválido");
    return join(this.dir, "objects", id + ".json");
  }
  private save() {
    atomic(join(this.dir, "index.json"), JSON.stringify(this.index));
  }
  private fileState(id: string) {
    const s = statSync(this.path(id), { bigint: true });
    if (!s.isFile() || s.size < 1n || s.size > BigInt(MAX_STORED_BUNDLE))
      throw new Error("Objecto armazenado inválido");
    const bytes = readFileSync(this.path(id));
    if (bytes.length < 1 || bytes.length > MAX_STORED_BUNDLE)
      throw new Error("Objecto armazenado inválido");
    // Timestamps can repeat on some filesystems (observed in Windows CI).
    // Hash the actual bounded bytes before reusing verified metadata.
    return {
      size: bytes.length,
      bytes,
      fingerprint: hash(bytes),
    };
  }
  stats() {
    return {
      count: Object.keys(this.index).length,
      bytes: Object.values(this.index).reduce((s, v) => s + v.size, 0),
      quota: this.quota,
      maxObjects: this.maxObjects,
      pinned: Object.values(this.index).filter((v) => v.pinned).length,
    };
  }
  private evictionPlan(
    needed: number,
    added = 0,
    quota = this.quota,
  ): string[] {
    const entries = Object.entries(this.index),
      expired = entries.filter(([, e]) => e.expires <= Date.now()),
      expiredIds = new Set(expired.map(([id]) => id));
    let bytes = entries.reduce((s, [, e]) => s + e.size, needed),
      count = entries.length + added;
    const removals: string[] = [];
    const select = ([id, e]: [string, Entry]) => {
      removals.push(id);
      bytes -= e.size;
      count--;
    };
    for (const entry of expired) select(entry);
    const candidates = entries
      .filter(([id, e]) => !e.pinned && !expiredIds.has(id))
      .sort((a, b) => a[1].accessed - b[1].accessed);
    for (const candidate of candidates) {
      if (bytes <= quota && count <= this.maxObjects) break;
      select(candidate);
    }
    // Decide whether the complete request can succeed before deleting any existing object.
    if (bytes > quota || count > this.maxObjects)
      throw new Error("Armazenamento cheio; liberte conteúdos fixados");
    return removals;
  }
  private removeEntries(ids: string[]) {
    for (const id of ids) {
      if (existsSync(this.path(id))) unlinkSync(this.path(id));
      delete this.index[id];
      this.manifests.delete(id);
    }
  }
  private read(id: string, touch: boolean): Bundle {
    const path = this.path(id);
    if (!this.index[id]) throw new Error("Conteúdo indisponível neste nó");
    const fileState = this.fileState(id),
      b: Bundle = JSON.parse(fileState.bytes.toString("utf8"));
    if (b.manifest.id !== id) throw new Error("Endereço não corresponde");
    verifyBundle(b);
    this.manifests.set(id, {
      manifest: structuredClone(b.manifest),
      fingerprint: fileState.fingerprint,
    });
    if (touch) this.index[id].accessed = Date.now();
    return b;
  }
  put(bundle: Bundle, pin = false): boolean {
    verifyBundle(bundle);
    const id = bundle.manifest.id;
    if (this.index[id]) return false;
    const bytes = canonical(bundle),
      size = Buffer.byteLength(bytes);
    if (size > this.quota || size > MAX_STORED_BUNDLE)
      throw new Error("Conteúdo excede quota");
    const removals = this.evictionPlan(size, 1);
    atomic(this.path(id), bytes);
    this.removeEntries(removals);
    this.index[id] = {
      size,
      pinned: pin,
      accessed: Date.now(),
      expires: bundle.manifest.expires,
    };
    this.manifests.set(id, {
      manifest: structuredClone(bundle.manifest),
      fingerprint: this.fileState(id).fingerprint,
    });
    this.save();
    return true;
  }
  get(id: string, touch = true): Bundle {
    return this.read(id, touch);
  }
  has(id: string): boolean {
    return (
      /^[a-f0-9]{64}$/.test(id) &&
      !!this.index[id] &&
      this.index[id].expires > Date.now()
    );
  }
  list(): Manifest[] {
    return Object.keys(this.index)
      .flatMap((id) => {
        if (this.index[id].expires <= Date.now()) return [];
        try {
          const fileState = this.fileState(id),
            cached = this.manifests.get(id);
          if (!cached || cached.fingerprint !== fileState.fingerprint)
            this.read(id, false);
          return [structuredClone(this.manifests.get(id)!.manifest)];
        } catch {
          this.manifests.delete(id);
          return [];
        }
      })
      .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  }
  pin(id: string, pinned: boolean) {
    this.get(id);
    this.index[id].pinned = pinned;
    this.save();
  }
  isPinned(id: string) {
    return this.index[id]?.pinned ?? false;
  }
  remove(id: string) {
    this.removeEntries([id]);
    this.save();
  }
  setQuota(quota: number) {
    if (
      !Number.isSafeInteger(quota) ||
      quota < 1024 * 1024 ||
      quota > 1024 ** 3
    )
      throw new Error("Quota inválida");
    const removals = this.evictionPlan(0, 0, quota);
    this.removeEntries(removals);
    this.quota = quota;
    this.save();
  }
}
export function constantEqual(a: string, b: string): boolean {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
