import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { closeSync, lstatSync, openSync } from "node:fs";
import {
  canonical,
  hash,
  validateIdentity,
  type Identity,
} from "../../core/src/index.js";

const DOMAIN = "relayloom/local-group-registry/1";
const MAX_INDEX = 4 * 1024 ** 2;
const MAX_RECORD = 512 * 1024;
const ENVELOPE_OVERHEAD = 61; // version, salt32, nonce12, GCM tag16
const APP_ID = 0x524c4731;
const CHECKPOINT_SQL =
  "CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id = 1), store_id TEXT NOT NULL, payload BLOB NOT NULL)";
const RECORDS_SQL =
  "CREATE TABLE records (slot TEXT PRIMARY KEY, payload BLOB NOT NULL) WITHOUT ROWID";
export const REGISTRY_LIMITS = Object.freeze({
  totalBytes: 64 * 1024 ** 2,
  reserveBytes: 4 * 1024 ** 2,
});
export interface RegistryLimits {
  totalBytes: number;
  reserveBytes: number;
}
export type StorageClass = "data" | "checkpoint";
interface Entry {
  key: string;
  slot: string;
  revision: number;
  digest: string;
  bytes: number;
  storageClass: StorageClass;
}
interface IndexBody {
  domain: typeof DOMAIN;
  owner: string;
  storeId: string;
  revision: number;
  limits: RegistryLimits;
  entries: Entry[];
}
export interface RegistryAccounting extends RegistryLimits {
  revision: number;
  records: number;
  serializedBytes: number;
  ordinaryBytes: number;
  sqliteBytes: number;
  sqliteMaximumBytes: number;
}
export class RegistryIntegrityError extends Error {}
export class RegistryCapacityError extends Error {}

function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(message);
}
function exact(value: any, keys: string[]) {
  insist(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
    "Campos do índice inválidos",
  );
}
function validKey(key: string) {
  return typeof key === "string" && /^[a-z0-9][a-z0-9:/._-]{0,159}$/.test(key);
}
function address(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function limits(value: RegistryLimits) {
  exact(value, ["totalBytes", "reserveBytes"]);
  insist(
    Number.isSafeInteger(value.totalBytes) &&
      value.totalBytes >= 32768 &&
      value.totalBytes <= REGISTRY_LIMITS.totalBytes &&
      Number.isSafeInteger(value.reserveBytes) &&
      value.reserveBytes >= 4096 &&
      value.reserveBytes < value.totalBytes &&
      value.reserveBytes <= REGISTRY_LIMITS.reserveBytes,
    "Limites do registo inválidos",
  );
  return { ...value };
}
function decode(bytes: Buffer): any {
  let value: any;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RegistryIntegrityError("JSON do registo inválido");
  }
  insist(Buffer.from(canonical(value)).equals(bytes), "Registo não canónico");
  return value;
}

/** Encrypted local metadata, not a group authorization API. All callbacks are synchronous. */
export class ProtectedGroupStore {
  private db: DatabaseSync;
  private signer: KeyObject;
  private verifier: KeyObject;
  private boxSecret: Buffer;
  private owner: string;
  private pinnedStoreId?: string;
  private active = false;
  private closed = false;
  private poisoned = false;

  constructor(
    path: string,
    identity: Identity,
    options: {
      create?: boolean;
      limits?: RegistryLimits;
      expectedStoreId?: string;
    } = {},
  ) {
    insist(validateIdentity(identity.public), "Identidade local inválida");
    this.owner = identity.public.id;
    if (options.expectedStoreId !== undefined)
      insist(
        address(options.expectedStoreId) && !options.create,
        "Identificador de registo esperado inválido",
      );
    this.pinnedStoreId = options.expectedStoreId;
    this.signer = createPrivateKey({
      key: Buffer.from(identity.signSecret, "base64"),
      format: "der",
      type: "pkcs8",
    });
    this.verifier = createPublicKey({
      key: Buffer.from(identity.public.signKey, "base64"),
      format: "der",
      type: "spki",
    });
    insist(
      this.signer.asymmetricKeyType === "ed25519" &&
        createPublicKey(this.signer)
          .export({ format: "der", type: "spki" })
          .toString("base64") === identity.public.signKey,
      "A chave de assinatura não pertence à identidade local",
    );
    const box = createPrivateKey({
      key: Buffer.from(identity.boxSecret, "base64"),
      format: "der",
      type: "pkcs8",
    });
    insist(
      box.asymmetricKeyType === "x25519" &&
        createPublicKey(box)
          .export({ format: "der", type: "spki" })
          .toString("base64") === identity.public.boxKey,
      "A chave de leitura não pertence à identidade local",
    );
    this.boxSecret = Buffer.from(identity.boxSecret, "base64");
    if (options.limits && !options.create)
      throw new Error("Os limites existentes são autenticados pelo registo");
    const initialLimits = limits(options.limits ?? REGISTRY_LIMITS);
    // Explicit exclusive creation: an absent or truncated existing registry is
    // never interpreted as a new membership state by an ordinary open.
    if (options.create) closeSync(openSync(path, "wx", 0o600));
    const stat = lstatSync(path);
    insist(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size <= REGISTRY_LIMITS.totalBytes * 1.5,
      "Ficheiro de registo inválido",
    );
    this.db = new DatabaseSync(path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    try {
      this.db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY",
      );
      if (options.create) {
        this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA page_size=4096");
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.exec(
            `PRAGMA application_id=${APP_ID}; PRAGMA user_version=1; ${CHECKPOINT_SQL}; ${RECORDS_SQL}`,
          );
          const body: IndexBody = {
            domain: DOMAIN,
            owner: this.owner,
            storeId: randomBytes(32).toString("hex"),
            revision: 0,
            limits: initialLimits,
            entries: [],
          };
          this.saveIndex(body);
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
      const schema = this.db
        .prepare(
          "SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      insist(
        schema.length === 2 &&
          schema[0].name === "checkpoint" &&
          schema[0].sql === CHECKPOINT_SQL &&
          schema[1].name === "records" &&
          schema[1].sql === RECORDS_SQL,
        "Esquema de registo desconhecido",
      );
      insist(
        this.db.prepare("PRAGMA application_id").get()?.application_id ===
          APP_ID &&
          this.db.prepare("PRAGMA user_version").get()?.user_version === 1 &&
          this.db.prepare("PRAGMA journal_mode").get()?.journal_mode ===
            "delete",
        "Formato de registo desconhecido",
      );
      const body = this.view((tx) => tx.indexBody());
      // Bound database pages separately from serialized encrypted metadata.
      const maximum = this.maximumDatabaseBytes(body.limits);
      insist(
        Number(this.db.prepare("PRAGMA page_size").get()?.page_size) === 4096 &&
          Number(this.db.prepare("PRAGMA page_count").get()?.page_count) *
            4096 <=
            maximum,
        "Base de dados excede o limite físico",
      );
      this.db.exec(`PRAGMA max_page_count=${maximum / 4096}`);
    } catch (error) {
      this.db.close();
      this.closed = true;
      this.boxSecret.fill(0);
      throw error;
    }
  }

  private maximumDatabaseBytes(value: RegistryLimits) {
    return Math.ceil(Math.max(65536, value.totalBytes * 1.5) / 4096) * 4096;
  }
  private aad(storeId: string, key: string, revision: number) {
    return Buffer.from(canonical([DOMAIN, this.owner, storeId, key, revision]));
  }
  private seal(plain: Buffer, aad: Buffer) {
    const salt = randomBytes(32),
      nonce = randomBytes(12);
    const key = Buffer.from(
      hkdfSync("sha256", this.boxSecret, salt, Buffer.from(DOMAIN), 32),
    );
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const data = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([
        Buffer.from([1]),
        salt,
        nonce,
        cipher.getAuthTag(),
        data,
      ]);
    } finally {
      key.fill(0);
    }
  }
  private unseal(envelope: Buffer, aad: Buffer) {
    insist(
      envelope.length >= ENVELOPE_OVERHEAD && envelope[0] === 1,
      "Envelope de registo inválido",
    );
    const key = Buffer.from(
      hkdfSync(
        "sha256",
        this.boxSecret,
        envelope.subarray(1, 33),
        Buffer.from(DOMAIN),
        32,
      ),
    );
    try {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        envelope.subarray(33, 45),
      );
      cipher.setAAD(aad);
      cipher.setAuthTag(envelope.subarray(45, 61));
      return Buffer.concat([
        cipher.update(envelope.subarray(61)),
        cipher.final(),
      ]);
    } catch {
      throw new RegistryIntegrityError("Autenticação do registo falhou");
    } finally {
      key.fill(0);
    }
  }
  private loadIndex(): IndexBody {
    const info = this.db
      .prepare(
        "SELECT id, store_id, typeof(payload) AS encoding, length(payload) AS bytes FROM checkpoint",
      )
      .all();
    insist(
      info.length === 1 &&
        info[0].id === 1 &&
        address(info[0].store_id) &&
        typeof info[0].bytes === "number" &&
        info[0].encoding === "blob" &&
        info[0].bytes >= ENVELOPE_OVERHEAD &&
        info[0].bytes <= MAX_INDEX,
      "Checkpoint ausente ou inválido",
    );
    const storeId = info[0].store_id as string;
    insist(
      this.pinnedStoreId === undefined || this.pinnedStoreId === storeId,
      "Checkpoint de outro registo",
    );
    const envelope = Buffer.from(
      this.db.prepare("SELECT payload FROM checkpoint WHERE id=1").get()!
        .payload as Uint8Array,
    );
    const checked = decode(
      this.unseal(envelope, this.aad(storeId, "@index", 0)),
    );
    exact(checked, ["body", "signature"]);
    const b: IndexBody = checked.body;
    exact(b, ["domain", "owner", "storeId", "revision", "limits", "entries"]);
    insist(
      b.domain === DOMAIN &&
        b.owner === this.owner &&
        b.storeId === storeId &&
        Number.isSafeInteger(b.revision) &&
        b.revision >= 0 &&
        typeof checked.signature === "string" &&
        checked.signature.length === 88,
      "Checkpoint de outra identidade ou versão",
    );
    const signature = Buffer.from(checked.signature, "base64");
    insist(
      signature.length === 64 &&
        signature.toString("base64") === checked.signature &&
        verify(null, Buffer.from(canonical(b)), this.verifier, signature),
      "Assinatura local do checkpoint inválida",
    );
    limits(b.limits);
    insist(
      Array.isArray(b.entries) && b.entries.length <= 131072,
      "Índice excede o limite",
    );
    let previous = "";
    const slots = new Set<string>();
    for (const entry of b.entries) {
      exact(entry, [
        "key",
        "slot",
        "revision",
        "digest",
        "bytes",
        "storageClass",
      ]);
      insist(
        validKey(entry.key) &&
          entry.key > previous &&
          address(entry.slot) &&
          !slots.has(entry.slot) &&
          address(entry.digest) &&
          Number.isSafeInteger(entry.revision) &&
          entry.revision > 0 &&
          entry.revision <= b.revision &&
          Number.isSafeInteger(entry.bytes) &&
          entry.bytes >= ENVELOPE_OVERHEAD &&
          entry.bytes <= MAX_RECORD + ENVELOPE_OVERHEAD &&
          ["data", "checkpoint"].includes(entry.storageClass),
        "Referência de registo inválida",
      );
      previous = entry.key;
      slots.add(entry.slot);
    }
    insist(
      this.db.prepare("SELECT count(*) AS count FROM records").get()?.count ===
        b.entries.length,
      "Registos ausentes ou fora do índice autenticado",
    );
    this.checkCapacity(b, envelope.length);
    this.pinnedStoreId = storeId;
    return b;
  }
  private checkCapacity(b: IndexBody, indexBytes: number) {
    const rows = b.entries.reduce((sum, e) => sum + e.bytes + 64, 0);
    const ordinary = b.entries.filter((e) => e.storageClass === "data");
    const ordinaryBytes =
      ordinary.reduce((sum, e) => sum + e.bytes + 64, 0) +
      Buffer.byteLength(canonical(ordinary));
    const serializedBytes = rows + indexBytes + 64;
    if (
      indexBytes > MAX_INDEX ||
      serializedBytes > b.limits.totalBytes ||
      ordinaryBytes > b.limits.totalBytes - b.limits.reserveBytes
    )
      throw new RegistryCapacityError(
        "Capacidade protegida do registo atingida",
      );
    return { serializedBytes, ordinaryBytes };
  }
  private saveIndex(b: IndexBody) {
    b.entries.sort((a, z) => (a.key < z.key ? -1 : a.key > z.key ? 1 : 0));
    const plain = Buffer.from(
      canonical({
        body: b,
        signature: sign(null, Buffer.from(canonical(b)), this.signer).toString(
          "base64",
        ),
      }),
    );
    this.checkCapacity(b, plain.length + ENVELOPE_OVERHEAD);
    const envelope = this.seal(plain, this.aad(b.storeId, "@index", 0));
    this.db
      .prepare(
        "INSERT INTO checkpoint(id,store_id,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET store_id=excluded.store_id,payload=excluded.payload",
      )
      .run(b.storeId, envelope);
  }
  private execute<T>(
    writable: boolean,
    callback: (tx: RegistryTransaction) => T,
  ): T {
    if (this.closed || this.poisoned || this.active)
      throw new Error("Registo fechado, incerto ou já em transacção");
    this.active = true;
    let begun = false,
      tx: RegistryTransaction | undefined,
      operationFailure: unknown;
    const guarded = <R>(operation: () => R): R => {
      if (operationFailure) throw operationFailure;
      try {
        return operation();
      } catch (error) {
        operationFailure = error;
        throw error;
      }
    };
    try {
      this.db.exec(writable ? "BEGIN IMMEDIATE" : "BEGIN");
      begun = true;
      const body = this.loadIndex();
      const next = body.revision + 1;
      if (writable)
        insist(Number.isSafeInteger(next), "Revisão do registo esgotada");
      tx = new RegistryTransaction(
        body,
        writable,
        (entry) =>
          guarded(() => {
            const info = this.db
              .prepare(
                "SELECT typeof(payload) AS encoding, length(payload) AS bytes FROM records WHERE slot=?",
              )
              .get(entry.slot);
            insist(
              info?.encoding === "blob" && info?.bytes === entry.bytes,
              "Registo ausente ou de tamanho diferente",
            );
            const envelope = Buffer.from(
              this.db
                .prepare("SELECT payload FROM records WHERE slot=?")
                .get(entry.slot)!.payload as Uint8Array,
            );
            insist(
              hash(envelope) === entry.digest,
              "Registo trocado ou corrompido",
            );
            return this.unseal(
              envelope,
              this.aad(body.storeId, entry.key, entry.revision),
            );
          }),
        (key, bytes, storageClass, old) => {
          const envelope = this.seal(bytes, this.aad(body.storeId, key, next));
          const entry: Entry = {
            key,
            slot: randomBytes(32).toString("hex"),
            revision: next,
            digest: hash(envelope),
            bytes: envelope.length,
            storageClass,
          };
          const candidate = {
            ...body,
            revision: next,
            entries: [...body.entries.filter((e) => e.key !== key), entry],
          };
          // Refuse before any SQL mutation, so the caller may catch capacity
          // and atomically persist a minimal frozen checkpoint in the reserve.
          // Bounding each insertion also bounds a large single transaction.
          this.checkCapacity(
            candidate,
            Buffer.byteLength(
              canonical({ body: candidate, signature: "A".repeat(88) }),
            ) + ENVELOPE_OVERHEAD,
          );
          return guarded(() => {
            if (old)
              this.db.prepare("DELETE FROM records WHERE slot=?").run(old.slot);
            this.db
              .prepare("INSERT INTO records(slot,payload) VALUES(?,?)")
              .run(entry.slot, envelope);
            return entry;
          });
        },
        (entry) =>
          guarded(() => {
            this.db.prepare("DELETE FROM records WHERE slot=?").run(entry.slot);
          }),
        () => {
          const indexBytes =
            Buffer.byteLength(canonical({ body, signature: "A".repeat(88) })) +
            ENVELOPE_OVERHEAD;
          return {
            ...body.limits,
            ...this.checkCapacity(body, indexBytes),
            revision: body.revision,
            records: body.entries.length,
            sqliteBytes:
              Number(this.db.prepare("PRAGMA page_count").get()?.page_count) *
              4096,
            sqliteMaximumBytes: this.maximumDatabaseBytes(body.limits),
          };
        },
      );
      const result = callback(tx);
      if (operationFailure) throw operationFailure;
      if (result && typeof (result as any).then === "function")
        throw new Error("A transacção exige uma função síncrona");
      if (writable && tx.changed) {
        body.revision = next;
        this.saveIndex(body);
      }
      // A commit error is ambiguous. Block this handle; reopening authenticates
      // the committed state before any caller may decide whether to retry.
      try {
        this.db.exec("COMMIT");
        begun = false;
      } catch (error) {
        this.poisoned = true;
        throw error;
      }
      return result;
    } catch (error) {
      if (error instanceof RegistryIntegrityError) this.poisoned = true;
      if (begun) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          this.poisoned = true;
        }
      }
      throw error;
    } finally {
      tx?.finish();
      this.active = false;
    }
  }
  transaction<T>(callback: (tx: RegistryTransaction) => T): T {
    return this.execute(true, callback);
  }
  view<T>(callback: (tx: RegistryTransaction) => T): T {
    return this.execute(false, callback);
  }
  accounting(): RegistryAccounting {
    return this.view((tx) => tx.accounting());
  }
  storeId(): string {
    return this.view((tx) => tx.indexBody().storeId);
  }
  close() {
    if (this.active) throw new Error("Transacção em curso");
    if (!this.closed) {
      this.db.close();
      this.boxSecret.fill(0);
      this.closed = true;
    }
  }
}

export class RegistryTransaction {
  private valid = true;
  #changed = false;
  get changed() {
    return this.#changed;
  }
  constructor(
    private body: IndexBody,
    private writable: boolean,
    private read: (entry: Entry) => Buffer,
    private write: (
      key: string,
      bytes: Buffer,
      storageClass: StorageClass,
      old?: Entry,
    ) => Entry,
    private remove: (entry: Entry) => void,
    private measure: () => RegistryAccounting,
  ) {}
  private check(write = false) {
    if (!this.valid || (write && !this.writable))
      throw new Error("Transacção terminada ou apenas de leitura");
  }
  /** Internal constructor inspection returns a copy, never the mutable index. */
  indexBody(): IndexBody {
    this.check();
    return structuredClone(this.body);
  }
  finish() {
    this.valid = false;
  }
  keys(prefix = ""): string[] {
    this.check();
    return this.body.entries
      .map((e) => e.key)
      .filter((k) => k.startsWith(prefix))
      .sort();
  }
  get(key: string): Buffer | undefined {
    this.check();
    if (!validKey(key)) throw new Error("Chave de registo inválida");
    const entry = this.body.entries.find((e) => e.key === key);
    return entry ? this.read(entry) : undefined;
  }
  put(key: string, bytes: Uint8Array, storageClass: StorageClass = "data") {
    this.check(true);
    if (
      !validKey(key) ||
      !(bytes instanceof Uint8Array) ||
      bytes.length > MAX_RECORD ||
      !["data", "checkpoint"].includes(storageClass)
    )
      throw new Error("Registo fora dos limites");
    const old = this.body.entries.find((e) => e.key === key);
    const entry = this.write(key, Buffer.from(bytes), storageClass, old);
    this.body.entries = this.body.entries.filter((e) => e.key !== key);
    this.body.entries.push(entry);
    this.#changed = true;
  }
  delete(key: string) {
    this.check(true);
    if (!validKey(key)) throw new Error("Chave de registo inválida");
    const entry = this.body.entries.find((e) => e.key === key);
    if (entry) {
      this.remove(entry);
      this.body.entries = this.body.entries.filter((e) => e !== entry);
      this.#changed = true;
    }
  }
  accounting(): RegistryAccounting {
    this.check();
    return this.measure();
  }
}
