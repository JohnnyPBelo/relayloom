import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  canonical,
  hash,
  validateIdentity,
  type Identity,
} from "../../core/src/index";
import { exactShape } from "../../core/src/protocol";
import {
  RegistryIntegrityError,
  RegistryCapacityError,
  type RegistryTransaction,
} from "../../groups/src/storage";

const DOMAIN = "relayloom/site-private/1";
const RESOURCE_DOMAIN = "relayloom/site-resource-private/1";
type Namespace = "site" | "resource";
export const SITE_PRIVATE_LIMITS = Object.freeze({
  bytes: 6 * 1024 * 1024 + 16384,
  chunkBytes: 512 * 1024,
  chunks: 16,
});
const overhead = 61; // version + salt32 + nonce12 + tag16
function insist(value: unknown, error: string): asserts value {
  if (!value) throw new RegistryIntegrityError(error);
}
function checkedKey(key: string, namespace: Namespace) {
  insist(
    (namespace === "site"
      ? /^site:[a-f0-9]{64}:(record|stage)$/
      : /^resource:[a-f0-9]{64}:(record|stage)$/
    ).test(key),
    "Chave privada de site inválida",
  );
  return key;
}
const part = (key: string, n: number) => key + ":" + String(n).padStart(2, "0");

/** Site preparation contains unpublished signatures. Encrypt it with a key
 * derived from signing ownership, inside the existing transactional encrypted
 * store, so the content-reading secret alone cannot extract those signatures.
 * No existing profile/database format or key derivation is changed. */
export class SitePrivateRecords {
  private closed = false;
  private constructor(
    private tx: RegistryTransaction,
    private ownerId: string,
    private storeId: string,
    private secret: Buffer,
    private namespace: Namespace,
  ) {}
  private check() {
    if (this.closed) throw new Error("Sessão privada de site terminada");
  }
  static run<T>(
    tx: RegistryTransaction,
    identity: Identity,
    fn: (records: SitePrivateRecords) => T,
  ): T {
    return this.session(tx, identity, fn, "site");
  }
  static runResource<T>(
    tx: RegistryTransaction,
    identity: Identity,
    fn: (records: SitePrivateRecords) => T,
  ): T {
    return this.session(tx, identity, fn, "resource");
  }
  private static session<T>(
    tx: RegistryTransaction,
    identity: Identity,
    fn: (records: SitePrivateRecords) => T,
    namespace: Namespace,
  ): T {
    insist(
      namespace === "site" || namespace === "resource",
      "Espaço privado inválido",
    );
    if (
      !validateIdentity(identity.public) ||
      tx.indexBody().owner !== identity.public.id
    )
      throw new Error("Proprietário local inválido");
    let records: SitePrivateRecords | undefined;
    const secret = Buffer.from(identity.signSecret, "base64");
    try {
      const key = createPrivateKey({
        key: secret,
        type: "pkcs8",
        format: "der",
      });
      insist(
        key.asymmetricKeyType === "ed25519" &&
          createPublicKey(key)
            .export({ type: "spki", format: "der" })
            .toString("base64") === identity.public.signKey,
        "A chave privada não pertence ao proprietário",
      );
      records = new SitePrivateRecords(
        tx,
        identity.public.id,
        tx.indexBody().storeId,
        secret,
        namespace,
      );
      const result = fn(records);
      if (result && typeof (result as any).then === "function")
        throw new Error("Operação privada deve ser síncrona");
      return result;
    } catch (error) {
      return tx.abort(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      if (records) records.closed = true;
      secret.fill(0);
    }
  }
  private get domain() {
    return this.namespace === "site" ? DOMAIN : RESOURCE_DOMAIN;
  }
  private aad(key: string) {
    return Buffer.from(
      canonical([
        this.domain,
        this.ownerId,
        this.storeId,
        checkedKey(key, this.namespace),
      ]),
    );
  }
  private encrypt(key: string, bytes: Buffer) {
    const salt = randomBytes(32),
      nonce = randomBytes(12);
    const derived = Buffer.from(
      hkdfSync("sha256", this.secret, salt, this.domain, 32),
    );
    try {
      const cipher = createCipheriv("aes-256-gcm", derived, nonce);
      cipher.setAAD(this.aad(key));
      const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return Buffer.concat([
        Buffer.from([1]),
        salt,
        nonce,
        cipher.getAuthTag(),
        data,
      ]);
    } finally {
      derived.fill(0);
    }
  }
  private decrypt(key: string, bytes: Buffer) {
    insist(
      bytes.length >= overhead && bytes[0] === 1,
      "Envelope privado de site inválido",
    );
    const derived = Buffer.from(
      hkdfSync("sha256", this.secret, bytes.subarray(1, 33), this.domain, 32),
    );
    try {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        derived,
        bytes.subarray(33, 45),
      );
      cipher.setAAD(this.aad(key));
      cipher.setAuthTag(bytes.subarray(45, 61));
      return Buffer.concat([cipher.update(bytes.subarray(61)), cipher.final()]);
    } catch {
      throw new RegistryIntegrityError(
        "Autenticação dos dados privados de site falhou",
      );
    } finally {
      derived.fill(0);
    }
  }
  read(key: string): unknown | null {
    this.check();
    try {
      return this.readChecked(key);
    } catch (error) {
      return this.tx.abort(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  private readChecked(key: string): unknown | null {
    checkedKey(key, this.namespace);
    const manifest = this.tx.get(key),
      keys = this.tx.keys(key + ":");
    if (!manifest) {
      insist(keys.length === 0, "Blocos privados de site sem índice");
      return null;
    }
    let data: any;
    try {
      data = JSON.parse(manifest.toString("utf8"));
    } catch {
      throw new RegistryIntegrityError("Índice privado de site ilegível");
    }
    insist(
      manifest.length <= 1024 &&
        exactShape(data, ["domain", "bytes", "chunks", "digest"]) &&
        data.domain === this.domain &&
        canonical(data) === manifest.toString("utf8") &&
        Number.isSafeInteger(data.bytes) &&
        data.bytes >= overhead &&
        data.bytes <= SITE_PRIVATE_LIMITS.bytes + overhead &&
        Number.isSafeInteger(data.chunks) &&
        data.chunks ===
          Math.ceil(data.bytes / SITE_PRIVATE_LIMITS.chunkBytes) &&
        data.chunks <= SITE_PRIVATE_LIMITS.chunks &&
        typeof data.digest === "string" &&
        /^[a-f0-9]{64}$/.test(data.digest),
      "Índice privado de site inválido",
    );
    insist(
      keys.length === data.chunks &&
        keys.every((keyPart, i) => keyPart === part(key, i)),
      "Conjunto privado de site incompleto",
    );
    const pieces = keys.map((keyPart, i) => {
      const bytes = this.tx.get(keyPart);
      insist(
        bytes &&
          bytes.length ===
            Math.min(
              SITE_PRIVATE_LIMITS.chunkBytes,
              data.bytes - i * SITE_PRIVATE_LIMITS.chunkBytes,
            ),
        "Bloco privado de site truncado",
      );
      return bytes;
    });
    const encrypted = Buffer.concat(pieces, data.bytes);
    insist(hash(encrypted) === data.digest, "Hash privado de site inválido");
    const plain = this.decrypt(key, encrypted);
    try {
      const value = JSON.parse(plain.toString("utf8"));
      insist(
        Buffer.from(canonical(value)).equals(plain),
        "Dados privados de site não canónicos",
      );
      return value;
    } catch (error) {
      if (error instanceof RegistryIntegrityError) throw error;
      throw new RegistryIntegrityError("Dados privados de site ilegíveis");
    }
  }
  write(key: string, value: unknown) {
    this.check();
    try {
      this.writeChecked(key, value);
    } catch (error) {
      this.tx.abort(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private writeChecked(key: string, value: unknown) {
    checkedKey(key, this.namespace);
    const bytes = Buffer.from(canonical(value));
    if (bytes.length > SITE_PRIVATE_LIMITS.bytes)
      throw new RegistryCapacityError("Dados privados de site acima do limite");
    const encrypted = this.encrypt(key, bytes),
      chunks = Math.ceil(encrypted.length / SITE_PRIVATE_LIMITS.chunkBytes);
    insist(
      chunks <= SITE_PRIVATE_LIMITS.chunks,
      "Demasiados blocos privados de site",
    );
    this.remove(key);
    for (let i = 0; i < chunks; i++)
      this.tx.put(
        part(key, i),
        encrypted.subarray(
          i * SITE_PRIVATE_LIMITS.chunkBytes,
          (i + 1) * SITE_PRIVATE_LIMITS.chunkBytes,
        ),
      );
    this.tx.put(
      key,
      Buffer.from(
        canonical({
          domain: this.domain,
          bytes: encrypted.length,
          chunks,
          digest: hash(encrypted),
        }),
      ),
    );
  }
  /** Explicit removal is for completed/cancelled staging. It is not recovery
   * from a corrupt record; callers must verify the catalog transition first. */
  remove(key: string) {
    this.check();
    checkedKey(key, this.namespace);
    for (const existing of this.tx.keys(key + ":")) this.tx.delete(existing);
    this.tx.delete(key);
  }
}
