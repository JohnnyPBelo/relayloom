import { createContributionEnvelopeProtocol } from "../../sites/src/contribution-envelope";
import { parseSiteAddress } from "../../sites/src/protocol";
import {
  createSiteContributionProtocol,
  type ContributionRequest,
} from "../../sites/src/contribution-protocol";
import { createSiteContentProtocol } from "../../sites/src/content";
import { browserCertificateCrypto } from "./certificate-crypto";
import { canonical, exactShape } from "../../core/src/protocol";
import type {
  Bundle,
  Identity,
  PublicIdentity,
  Sealed,
} from "../../core/src/protocol";
import {
  createIdentity,
  createBundle,
  createBundleAt,
  exportVault,
  importVault,
  hkdf,
  un64,
  utf8,
  seal,
  open,
  verifiedBundle,
  verifiedStoredBundle,
  decryptBundle,
  decryptStoredBundle,
  hash,
} from "./crypto";

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_OBJECTS = 1024;
const MAX_STATE = 1024 * 1024;
export const PRIVATE_VALUE_LIMITS = Object.freeze({
  valueBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  values: 4096,
});
const MAX_VALUE_CIPHER =
  4 * Math.ceil(PRIVATE_VALUE_LIMITS.valueBytes / 3) + 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
type CipherRow = { sealed: Sealed; revision: string; size: number };
type ValueReference = {
  id: string;
  bytes: number;
  sealedBytes: number;
  digest: string;
};
type ValueWrite = { put: { id: string; sealed: Sealed }; remove: string[] };
type State = {
  values: Record<string, unknown>;
  valueRefs?: Record<string, ValueReference>;
  bundles: Record<
    string,
    {
      size: number;
      pinned: boolean;
      accessed: number;
      expires: number;
      reserved?: boolean;
      created?: number;
      revision?: string;
    }
  >;
};
type Session = { identity: Identity; key: Uint8Array; generation: number };
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const complete = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Transacção abortada"));
  });
const allowedID = (id: string) => /^[a-f0-9]{64}$/.test(id);
const allowedValueKey = (key: unknown): key is string =>
  typeof key === "string" &&
  /^[a-z][a-z0-9:/._-]{0,159}$/.test(key) &&
  !["constructor", "prototype"].includes(key);
const privateKey = (id: string) => "private:" + id;

/** One encrypted profile per origin/name. Full runtime authority/outbox integration remains separate. */
export interface ProfileValueTransaction {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): void;
  remove(key: string): Promise<void>;
  keys(prefix?: string): string[];
}
export class BrowserProfile {
  #session?: Session;
  #generation = 0;
  #closed = false;
  private constructor(
    private db: IDBDatabase,
    readonly name: string,
    public quota: number,
    readonly maxObjects: number,
  ) {}
  static async connect(
    name = "relayloom-web-v1",
    quota = MAX_BYTES,
    maxObjects = MAX_OBJECTS,
  ): Promise<BrowserProfile> {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(name) ||
      !Number.isSafeInteger(quota) ||
      quota < 1024 ||
      quota > 1024 ** 3 ||
      !Number.isSafeInteger(maxObjects) ||
      maxObjects < 1 ||
      maxObjects > MAX_OBJECTS
    )
      throw new Error("Limites de armazenamento inválidos");
    if (
      !globalThis.isSecureContext ||
      !navigator.locks ||
      !globalThis.indexedDB
    )
      throw new Error(
        "Este navegador não disponibiliza armazenamento seguro e coordenação entre separadores",
      );
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("profile");
      r.result.createObjectStore("bundles");
    };
    const db = await request(r);
    const profile = new BrowserProfile(db, name, quota, maxObjects);
    db.onversionchange = () => profile.close();
    return profile;
  }
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Perfil fechado"));
    return await navigator.locks.request(
      "relayloom-profile:" + this.name,
      async () => {
        if (this.#closed) throw new Error("Perfil fechado");
        return run();
      },
    );
  }
  private active(): Session {
    if (!this.#session || this.#closed) throw new Error("Perfil bloqueado");
    return this.#session;
  }
  private guard(s: Session) {
    if (
      this.#closed ||
      this.#session !== s ||
      s.generation !== this.#generation
    )
      throw new Error("Perfil bloqueado durante a operação");
  }
  private async read<T>(store: string, key: string): Promise<T | undefined> {
    const tx = this.db.transaction(store, "readonly"),
      done = complete(tx);
    const value = await request(tx.objectStore(store).get(key));
    await done;
    return value;
  }
  async initialized(): Promise<boolean> {
    return (await this.read("profile", "vault")) !== undefined;
  }
  get identity(): PublicIdentity | null {
    return this.#session
      ? structuredClone(this.#session.identity.public)
      : null;
  }
  get sessionGeneration(): number {
    return this.active().generation;
  }
  get locked(): boolean {
    return !this.#session;
  }
  lock(): void {
    this.#generation++;
    this.#session?.key.fill(0);
    this.#session = undefined;
  }
  close(): void {
    this.lock();
    this.#closed = true;
    this.db.close();
  }
  private async makeSession(
    identity: Identity,
    generation: number,
  ): Promise<Session> {
    const key = await hkdf(
      un64(identity.signSecret, 256),
      identity.public.id,
      "relayloom-browser-profile-v1",
    );
    if (this.#generation !== generation || this.#closed) {
      key.fill(0);
      throw new Error("Perfil bloqueado durante a operação");
    }
    return { identity, key, generation };
  }
  private async encryptState(s: Session, state: State): Promise<CipherRow> {
    this.checkValueReferences(state);
    const bytes = utf8(canonical(state));
    if (bytes.length > MAX_STATE)
      throw new Error("Estado privado excede o limite");
    return {
      sealed: await seal(
        bytes,
        s.key,
        "relayloom-browser-state-v1:" + s.identity.public.id,
      ),
      revision: crypto.randomUUID(),
      size: bytes.length,
    };
  }
  private async decodeState(
    s: Session,
    row: CipherRow | undefined,
  ): Promise<State> {
    if (
      !row ||
      !exactShape(row, ["sealed", "revision", "size"]) ||
      !Number.isSafeInteger(row.size) ||
      row.size < 1 ||
      row.size > MAX_STATE ||
      typeof row.revision !== "string" ||
      row.revision.length > 64
    )
      throw new Error("Índice privado ausente ou inválido");
    const bytes = await open(
      row.sealed,
      s.key,
      "relayloom-browser-state-v1:" + s.identity.public.id,
    );
    if (bytes.length !== row.size) throw new Error("Índice privado corrompido");
    const state = JSON.parse(decoder.decode(bytes)) as State;
    if (
      (!exactShape(state, ["values", "bundles"]) &&
        !exactShape(state, ["values", "bundles", "valueRefs"])) ||
      !state.values ||
      !state.bundles ||
      Object.getPrototypeOf(state.values) !== Object.prototype ||
      Object.getPrototypeOf(state.bundles) !== Object.prototype ||
      Object.keys(state.bundles).length > MAX_OBJECTS
    )
      throw new Error("Índice privado inválido");
    this.checkValueReferences(state);
    for (const [id, entry] of Object.entries(state.bundles))
      if (
        !allowedID(id) ||
        (!exactShape(entry, ["size", "pinned", "accessed", "expires"]) &&
          !exactShape(entry, [
            "size",
            "pinned",
            "accessed",
            "expires",
            "reserved",
            "created",
            "revision",
          ])) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 1 ||
        entry.size > 9 * 1024 * 1024 ||
        typeof entry.pinned !== "boolean" ||
        !Number.isSafeInteger(entry.accessed) ||
        !Number.isSafeInteger(entry.expires) ||
        (entry.reserved !== undefined &&
          (typeof entry.reserved !== "boolean" ||
            !Number.isSafeInteger(entry.created) ||
            typeof entry.revision !== "string" ||
            !/^[a-f0-9-]{36}$/.test(entry.revision)))
      )
        throw new Error("Índice privado inválido");
    return state;
  }
  async setup(name: string, password: string): Promise<PublicIdentity> {
    return this.install(async () => {
      const identity = await createIdentity(name);
      return { identity, vault: await exportVault(identity, password) };
    });
  }
  /** Restore identity into an EMPTY profile; never replace existing data or regenerate its authority. */
  async restore(vault: string, password: string): Promise<PublicIdentity> {
    return this.install(async () => ({
      identity: await importVault(vault, password),
      vault,
    }));
  }
  private async install(
    make: () => Promise<{ identity: Identity; vault: string }>,
  ): Promise<PublicIdentity> {
    return this.exclusive(async () => {
      if (await this.initialized())
        throw new Error(
          "Já existe uma identidade; desbloqueia ou usa outro perfil",
        );
      const generation = this.#generation;
      const { identity, vault } = await make();
      const s = await this.makeSession(identity, generation);
      try {
        const state = await this.encryptState(s, { values: {}, bundles: {} });
        if (generation !== this.#generation || this.#closed)
          throw new Error("Perfil bloqueado durante a operação");
        const tx = this.db.transaction("profile", "readwrite"),
          done = complete(tx);
        tx.objectStore("profile").add(vault, "vault");
        tx.objectStore("profile").add(state, "state");
        await done;
        if (generation !== this.#generation || this.#closed)
          throw new Error("Perfil criado, mas sessão bloqueada");
        this.#session = s;
        return structuredClone(identity.public);
      } catch (error) {
        s.key.fill(0);
        throw error;
      }
    });
  }
  async unlock(password: string): Promise<PublicIdentity> {
    return this.exclusive(async () => {
      if (this.#session) throw new Error("Perfil já desbloqueado");
      const generation = this.#generation,
        vault = await this.read<string>("profile", "vault");
      if (!vault) throw new Error("Não existe identidade neste perfil");
      const s = await this.makeSession(
        await importVault(vault, password),
        generation,
      );
      try {
        await this.decodeState(s, await this.read("profile", "state"));
        if (generation !== this.#generation || this.#closed)
          throw new Error("Perfil bloqueado durante a operação");
        this.#session = s;
        return structuredClone(s.identity.public);
      } catch (error) {
        s.key.fill(0);
        throw error;
      }
    });
  }
  /** Export is the compatible encrypted identity vault, NOT a full database backup. */
  async exportIdentity(): Promise<string> {
    const s = this.active(),
      vault = await this.read<string>("profile", "vault");
    this.guard(s);
    if (!vault) throw new Error("Cofre ausente");
    return vault;
  }
  async signContent(
    kind: string,
    payload: unknown,
    readers: PublicIdentity[] | "public",
    ttl?: number,
  ): Promise<Bundle> {
    const s = this.active(),
      result = await createBundle(s.identity, kind, payload, readers, ttl);
    this.guard(s);
    return result;
  }
  async signSiteBundle(
    name: string,
    sequence: number,
    previous: string[],
    payload: unknown,
    readers: PublicIdentity[] | "public",
    ttl: number,
  ): Promise<Bundle> {
    const session = this.active();
    const content = createSiteContentProtocol(browserCertificateCrypto).create(
      session.identity,
      name,
      sequence,
      previous,
      payload,
    );
    const bundle = await createBundle(
      session.identity,
      "site",
      content,
      readers,
      ttl,
    );
    this.guard(session);
    return bundle;
  }
  // Internal signing helper; no Worker RPC exposes it directly.
  async signSiteContribution(request: ContributionRequest) {
    const session = this.active();
    const result = createSiteContributionProtocol(
      browserCertificateCrypto,
    ).create(session.identity, request);
    this.guard(session);
    return result;
  }
  async sealSiteContribution(proposal: unknown, owner: PublicIdentity) {
    const session = this.active(),
      envelopes = createContributionEnvelopeProtocol(browserCertificateCrypto);
    const content = envelopes.content({ type: "site-contribution", proposal });
    const body = content.proposal.body;
    if (
      body.contributor.id !== session.identity.public.id ||
      parseSiteAddress(body.target.site).ownerId !== owner.id
    )
      throw Error("Autor ou destinatário da proposta inválido");
    const bundle = await createBundleAt(
      session.identity,
      "site-contribution",
      content,
      [owner],
      body.expires - body.created,
      body.created,
    );
    this.guard(session);
    envelopes.match(bundle, content);
    return bundle;
  }
  async decryptStaging(value: Bundle): Promise<unknown> {
    const session = this.active(),
      decoded = await decryptStoredBundle(value, session.identity);
    this.guard(session);
    return decoded;
  }
  async decrypt(value: Bundle): Promise<unknown> {
    const s = this.active(),
      valueOwned = await verifiedBundle(value),
      result = await decryptBundle(valueOwned, s.identity);
    this.guard(s);
    return result;
  }
  async exportCopy(password: string): Promise<string> {
    const s = this.active(),
      vault = await exportVault(s.identity, password);
    this.guard(s);
    return vault;
  }
  async records() {
    const s = this.active();
    return structuredClone((await this.state(s)).value.bundles);
  }
  private checkValueReferences(state: State) {
    if (state.valueRefs === undefined) return;
    if (
      !state.valueRefs ||
      Object.getPrototypeOf(state.valueRefs) !== Object.prototype ||
      Object.keys(state.valueRefs).length > PRIVATE_VALUE_LIMITS.values
    )
      throw new Error("Índice de valores privados inválido");
    let total = 0;
    const ids = new Set<string>();
    for (const [key, reference] of Object.entries(state.valueRefs)) {
      if (
        !allowedValueKey(key) ||
        Object.hasOwn(state.values, key) ||
        !exactShape(reference, ["id", "bytes", "sealedBytes", "digest"]) ||
        typeof reference.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          reference.id,
        ) ||
        ids.has(reference.id) ||
        !Number.isSafeInteger(reference.bytes) ||
        reference.bytes < 1 ||
        reference.bytes > PRIVATE_VALUE_LIMITS.valueBytes ||
        !Number.isSafeInteger(reference.sealedBytes) ||
        reference.sealedBytes < 1 ||
        reference.sealedBytes > MAX_VALUE_CIPHER ||
        typeof reference.digest !== "string" ||
        !allowedID(reference.digest)
      )
        throw new Error("Referência privada inválida");
      total += reference.sealedBytes;
      ids.add(reference.id);
    }
    if (total > PRIVATE_VALUE_LIMITS.totalBytes)
      throw new Error("Limite de valores privados atingido");
  }
  private async resolveValue(
    s: Session,
    state: State,
    key: string,
  ): Promise<unknown> {
    const reference =
      state.valueRefs && Object.hasOwn(state.valueRefs, key)
        ? state.valueRefs[key]
        : undefined;
    if (!reference)
      return Object.hasOwn(state.values, key) ? state.values[key] : null;
    const row = await this.read<Sealed>("bundles", privateKey(reference.id));
    this.guard(s);
    if (
      !row ||
      !exactShape(row, ["nonce", "data", "tag"]) ||
      typeof row.nonce !== "string" ||
      row.nonce.length !== 16 ||
      typeof row.tag !== "string" ||
      row.tag.length !== 24 ||
      typeof row.data !== "string" ||
      row.data.length > MAX_VALUE_CIPHER ||
      utf8(canonical(row)).length !== reference.sealedBytes
    )
      throw new Error("Valor privado ausente ou inválido");
    const bytes = await open(
      row,
      s.key,
      "relayloom-browser-value-v1:" +
        s.identity.public.id +
        ":" +
        key +
        ":" +
        reference.id,
    );
    this.guard(s);
    if (
      bytes.length !== reference.bytes ||
      (await hash(bytes)) !== reference.digest
    )
      throw new Error("Valor privado corrompido");
    this.guard(s);
    return JSON.parse(decoder.decode(bytes));
  }
  private async mutate(
    s: Session,
    state: State,
    mutation?: { key: string; update: (previous: unknown) => unknown },
    checkLimits = true,
  ): Promise<ValueWrite | undefined> {
    if (!mutation) return;
    if (!allowedValueKey(mutation.key))
      throw new Error("Nome de estado inválido");
    const previous = await this.resolveValue(s, state, mutation.key);
    this.guard(s);
    const bytes = utf8(canonical(mutation.update(structuredClone(previous))));
    if (bytes.length > PRIVATE_VALUE_LIMITS.valueBytes)
      throw new Error("Valor privado excede o limite");
    const id = crypto.randomUUID(),
      old =
        state.valueRefs && Object.hasOwn(state.valueRefs, mutation.key)
          ? state.valueRefs[mutation.key]
          : undefined;
    const sealed = await seal(
      bytes,
      s.key,
      "relayloom-browser-value-v1:" +
        s.identity.public.id +
        ":" +
        mutation.key +
        ":" +
        id,
    );
    const digest = await hash(bytes);
    this.guard(s);
    state.valueRefs = {
      ...state.valueRefs,
      [mutation.key]: {
        id,
        bytes: bytes.length,
        sealedBytes: utf8(canonical(sealed)).length,
        digest,
      },
    };
    delete state.values[mutation.key];
    if (checkLimits) this.checkValueReferences(state);
    return {
      put: { id: privateKey(id), sealed },
      remove: old ? [privateKey(old.id)] : [],
    };
  }
  /** Internal worker transaction. It holds the profile lock across asynchronous
   * crypto, and releases only a committed result. No RPC accepts this callback. */
  async transactValues<T>(
    run: (tx: ProfileValueTransaction) => Promise<T>,
  ): Promise<T> {
    const session = this.active();
    return this.exclusive(async () => {
      this.guard(session);
      const state = await this.state(session);
      const fetched = new Map<string, Promise<unknown>>();
      const changes = new Map<
        string,
        { remove: true } | { remove: false; value: unknown; bytes: number }
      >();
      const accessed = new Set<string>();
      let live = true,
        inflight = 0,
        failure: Error | undefined;
      const fail = (error: unknown): never => {
        failure ??= error instanceof Error ? error : new Error(String(error));
        throw failure;
      };
      const check = (key?: string) => {
        if (failure) throw failure;
        this.guard(session);
        if (key !== undefined) {
          if (!allowedValueKey(key)) throw new Error("Nome de estado inválido");
          accessed.add(key);
          if (accessed.size > 192)
            throw new Error("Demasiados valores numa transacção");
        }
      };
      const active = (key?: string) => {
        if (!live) throw new Error("Transacção privada terminada");
        try {
          check(key);
        } catch (error) {
          fail(error);
        }
      };
      const original = async (key: string) => {
        try {
          check(key);
          let pending = fetched.get(key);
          if (!pending) {
            pending = this.resolveValue(session, state.value, key);
            fetched.set(key, pending);
          }
          const value = await pending;
          check(key);
          return value;
        } catch (error) {
          return fail(error);
        }
      };
      const track = <V>(operation: () => Promise<V>): Promise<V> => {
        inflight++;
        const pending = (async () => {
          try {
            return await operation();
          } catch (error) {
            return fail(error);
          } finally {
            inflight--;
          }
        })();
        void pending.catch(() => {}); // The transaction still fails if a caller forgets to await.
        return pending;
      };
      const tx: ProfileValueTransaction = {
        get: (key) =>
          track(async () => {
            active(key);
            const changed = changes.get(key);
            const value = changed
              ? changed.remove
                ? null
                : changed.value
              : await original(key);
            active(key);
            return structuredClone(value);
          }),
        set: (key, value) => {
          active(key);
          try {
            const encoded = canonical(value),
              bytes = utf8(encoded).length;
            if (bytes > PRIVATE_VALUE_LIMITS.valueBytes)
              throw new Error("Valor privado excede o limite");
            const total = [...changes.entries()].reduce(
              (sum, [other, change]) =>
                sum + (other !== key && !change.remove ? change.bytes : 0),
              bytes,
            );
            if (total > PRIVATE_VALUE_LIMITS.totalBytes)
              throw new Error("Transacção privada excede o limite");
            changes.set(key, {
              remove: false,
              value: JSON.parse(encoded),
              bytes,
            });
          } catch (error) {
            fail(error);
          }
        },
        remove: (key) =>
          track(async () => {
            active(key);
            await original(key);
            active(key);
            changes.set(key, { remove: true });
          }),
        keys: (prefix = "") => {
          active();
          if (typeof prefix !== "string" || prefix.length > 160)
            return fail(new Error("Prefixo privado inválido"));
          const names = new Set([
            ...Object.keys(state.value.values),
            ...Object.keys(state.value.valueRefs ?? {}),
          ]);
          for (const [key, change] of changes) {
            if (change.remove) names.delete(key);
            else names.add(key);
          }
          return [...names].filter((key) => key.startsWith(prefix)).sort();
        },
      };
      try {
        const result = structuredClone(await run(tx));
        active();
        if (inflight)
          throw new Error("Aguarda as operações privadas pendentes");
        live = false;
        for (const key of changes.keys()) await original(key);
        const writes: ValueWrite[] = [],
          remove: string[] = [];
        for (const [key, change] of changes)
          if (change.remove) {
            const reference = state.value.valueRefs?.[key];
            if (reference) remove.push(privateKey(reference.id));
            delete state.value.values[key];
            if (state.value.valueRefs) delete state.value.valueRefs[key];
          }
        for (const [key, change] of changes)
          if (!change.remove) {
            const write = await this.mutate(
              session,
              state.value,
              { key, update: () => change.value },
              false,
            );
            if (write) writes.push(write);
          }
        // encryptState/commit validates the complete final quota/index before
        // queuing any IndexedDB writes. Intermediate replacement sizes do not
        // bypass per-value or transaction memory bounds.
        if (changes.size)
          await this.commit(
            session,
            state.row,
            state.value,
            undefined,
            remove,
            writes,
          );
        this.guard(session);
        return result;
      } finally {
        live = false;
      }
    });
  }
  async updateValue(
    key: string,
    update: (previous: unknown) => unknown,
    release: string[] = [],
  ): Promise<void> {
    return this.updateValues([{ key, update }], release);
  }
  /** Private values and reservation releases share one index/blob transaction. */
  async updateValues(
    mutations: { key: string; update: (previous: unknown) => unknown }[],
    release: string[] = [],
  ): Promise<void> {
    if (
      !Array.isArray(mutations) ||
      mutations.length > 64 ||
      mutations.some(
        (m) => !m || !allowedValueKey(m.key) || typeof m.update !== "function",
      ) ||
      new Set(mutations.map((m) => m.key)).size !== mutations.length
    )
      throw new Error("Alterações privadas inválidas");
    return this.exclusive(async () => {
      const s = this.active(),
        state = await this.state(s);
      const writes: ValueWrite[] = [];
      for (const mutation of mutations) {
        const write = await this.mutate(s, state.value, mutation);
        if (write) writes.push(write);
      }
      for (const id of release) {
        if (!allowedID(id)) throw new Error("Endereço inválido");
        if (state.value.bundles[id]?.reserved !== undefined)
          state.value.bundles[id].reserved = false;
      }
      await this.commit(s, state.row, state.value, undefined, [], writes);
    });
  }
  async changeQuota(
    quota: number,
    mutation?: { key: string; update: (previous: unknown) => unknown },
  ): Promise<void> {
    if (!Number.isSafeInteger(quota) || quota < 1024 || quota > 1024 ** 3)
      throw new Error("Limite de armazenamento inválido");
    return this.exclusive(async () => {
      const s = this.active(),
        { row, value } = await this.state(s),
        remove: string[] = [];
      let size = Object.values(value.bundles).reduce((n, e) => n + e.size, 0);
      const candidates = Object.entries(value.bundles)
        .filter(
          ([, e]) => e.expires <= Date.now() || (!e.pinned && !e.reserved),
        )
        .sort((a, b) => a[1].accessed - b[1].accessed);
      while (size > quota) {
        const next = candidates.shift();
        if (!next)
          throw new Error(
            "O espaço está reservado por conteúdo fixado ou envios pendentes",
          );
        remove.push(next[0]);
        size -= next[1].size;
        delete value.bundles[next[0]];
      }
      const valueWrite = await this.mutate(s, value, mutation);
      await this.commit(s, row, value, undefined, remove, valueWrite);
      this.quota = quota;
    });
  }
  private async state(s: Session) {
    const row = await this.read<CipherRow>("profile", "state"),
      value = await this.decodeState(s, row);
    this.guard(s);
    return { row: row!, value };
  }
  private async commit(
    s: Session,
    old: CipherRow,
    next: State,
    put?: { id: string; sealed: Sealed },
    remove: string[] = [],
    valueWrite?: ValueWrite | ValueWrite[],
  ): Promise<void> {
    const values = Array.isArray(valueWrite)
      ? valueWrite
      : valueWrite
        ? [valueWrite]
        : [];
    const encrypted = await this.encryptState(s, next);
    this.guard(s);
    const tx = this.db.transaction(["profile", "bundles"], "readwrite"),
      done = complete(tx);
    let enqueueFailure: unknown;
    const check = tx.objectStore("profile").get("state");
    check.onsuccess = () => {
      // All requests are enqueued synchronously while the IDB transaction is active.
      if (this.#session !== s || check.result?.revision !== old.revision) {
        tx.abort();
        return;
      }
      try {
        tx.objectStore("profile").put(encrypted, "state");
        if (put) tx.objectStore("bundles").put(put.sealed, put.id);
        for (const value of values)
          tx.objectStore("bundles").put(value.put.sealed, value.put.id);
        for (const id of remove) tx.objectStore("bundles").delete(id);
        for (const value of values)
          for (const id of value.remove) tx.objectStore("bundles").delete(id);
      } catch (error) {
        enqueueFailure = error;
        try {
          tx.abort();
        } catch {
          /* The browser may already have aborted. */
        }
      }
    };
    try {
      await done;
    } catch (error) {
      throw enqueueFailure ?? error;
    }
    this.guard(s);
  }
  async getValue(key: string): Promise<unknown> {
    if (!allowedValueKey(key)) throw new Error("Nome de estado inválido");
    return this.exclusive(async () => {
      const s = this.active(),
        state = (await this.state(s)).value;
      return this.resolveValue(s, state, key);
    });
  }
  async readValues(keys: string[]): Promise<Record<string, unknown>> {
    if (
      !Array.isArray(keys) ||
      keys.length > 64 ||
      keys.some((key) => !allowedValueKey(key)) ||
      new Set(keys).size !== keys.length
    )
      throw new Error("Leitura privada inválida");
    return this.exclusive(async () => {
      const s = this.active(),
        state = (await this.state(s)).value;
      const entries: [string, unknown][] = [];
      for (const key of keys)
        entries.push([key, await this.resolveValue(s, state, key)]);
      this.guard(s);
      return Object.fromEntries(entries);
    });
  }
  async setValue(key: string, value: unknown): Promise<void> {
    if (!allowedValueKey(key)) throw new Error("Nome de estado inválido");
    const owned = JSON.parse(canonical(value));
    return this.updateValue(key, () => owned);
  }
  async valueKeys(prefix = ""): Promise<string[]> {
    const s = this.active(),
      state = (await this.state(s)).value;
    return [
      ...new Set([
        ...Object.keys(state.values),
        ...Object.keys(state.valueRefs ?? {}),
      ]),
    ]
      .filter((key) => key.startsWith(prefix))
      .sort();
  }
  async stats() {
    const s = this.active(),
      { value } = await this.state(s),
      entries = Object.values(value.bundles);
    return {
      count: entries.length,
      bytes: entries.reduce((n, e) => n + e.size, 0),
      pinned: entries.filter((e) => e.pinned).length,
      quota: this.quota,
      privateBytes: Object.values(value.valueRefs ?? {}).reduce(
        (sum, reference) => sum + reference.sealedBytes,
        0,
      ),
    };
  }
  async ids(): Promise<string[]> {
    const s = this.active();
    return Object.keys((await this.state(s)).value.bundles);
  }
  async putBundle(
    value: Bundle,
    pinned = false,
    mutation?:
      | { key: string; update: (previous: unknown) => unknown }
      | { key: string; update: (previous: unknown) => unknown }[],
    reserve = false,
  ): Promise<string> {
    if (typeof pinned !== "boolean" || typeof reserve !== "boolean")
      throw new Error("Reserva inválida");
    const mutations = (
      mutation === undefined
        ? []
        : Array.isArray(mutation)
          ? mutation
          : [mutation]
    ).map((m) => ({ key: m.key, update: m.update }));
    if (
      mutations.length > 64 ||
      new Set(mutations.map((m) => m.key)).size !== mutations.length ||
      mutations.some(
        (m) => !allowedValueKey(m.key) || typeof m.update !== "function",
      )
    )
      throw Error("Alterações privadas inválidas");
    const s = this.active(),
      b = await verifiedBundle(value);
    this.guard(s);
    // Admission is an explicit runtime decision; never accept group authority/control as generic content.
    if (b.manifest.kind.startsWith("group-"))
      throw new Error("Autoridade de grupos ainda não ligada ao motor web");
    const sealed = await seal(
      utf8(canonical(b)),
      s.key,
      "relayloom-browser-bundle-v1:" + b.manifest.id,
    );
    const size = utf8(canonical(sealed)).length;
    this.guard(s);
    if (size > this.quota)
      throw new Error("Conteúdo excede o espaço disponível");
    return this.exclusive(async () => {
      this.guard(s);
      const { row, value: state } = await this.state(s),
        id = b.manifest.id;
      const remove: string[] = [];
      for (const [other, entry] of Object.entries(state.bundles))
        if (entry.expires <= Date.now()) {
          delete state.bundles[other];
          remove.push(other);
        }
      const previous = state.bundles[id];
      delete state.bundles[id];
      let bytes = Object.values(state.bundles).reduce((n, e) => n + e.size, 0),
        count = Object.keys(state.bundles).length;
      const candidates = Object.entries(state.bundles)
        .filter(([, e]) => !e.pinned && !e.reserved)
        .sort(
          (a, b) => a[1].accessed - b[1].accessed || a[0].localeCompare(b[0]),
        );
      while (bytes + size > this.quota || count >= this.maxObjects) {
        const candidate = candidates.shift();
        if (!candidate) throw new Error("Espaço reservado por conteúdo fixado");
        const [drop, entry] = candidate;
        remove.push(drop);
        delete state.bundles[drop];
        bytes -= entry.size;
        count--;
      }
      state.bundles[id] = {
        size,
        pinned: pinned || previous?.pinned === true,
        accessed: Date.now(),
        expires: b.manifest.expires,
        reserved: reserve || previous?.reserved === true,
        created: b.manifest.created,
        revision: crypto.randomUUID(),
      };
      const valueWrite: ValueWrite[] = [];
      for (const change of mutations) {
        const write = await this.mutate(s, state, change);
        if (write) valueWrite.push(write);
      }
      await this.commit(
        s,
        row,
        state,
        { id, sealed },
        remove.filter((other) => other !== id),
        valueWrite,
      );
      return id;
    });
  }
  async getBundle(id: string): Promise<Bundle> {
    return this.readBundle(id, false);
  }
  /** Historical authentication for status only; does not permit serving expired data. */
  async getStoredBundle(id: string): Promise<Bundle> {
    return this.readBundle(id, true);
  }
  private async readBundle(id: string, historical: boolean): Promise<Bundle> {
    if (!allowedID(id)) throw new Error("Endereço inválido");
    const s = this.active(),
      { value } = await this.state(s);
    if (!value.bundles[id]) throw new Error("Conteúdo não encontrado");
    const row = await this.read<Sealed>("bundles", id);
    if (!row) throw new Error("Conteúdo ausente do armazenamento");
    const bytes = await open(row, s.key, "relayloom-browser-bundle-v1:" + id);
    const b = await (historical ? verifiedStoredBundle : verifiedBundle)(
      JSON.parse(decoder.decode(bytes)),
    );
    this.guard(s);
    if (b.manifest.id !== id) throw new Error("Endereço não corresponde");
    return b;
  }
  async view(id: string): Promise<unknown> {
    const s = this.active(),
      b = await this.getBundle(id),
      payload = await decryptBundle(b, s.identity);
    this.guard(s);
    // Retain the exact signed object. Reading cannot transfer ownership.
    await this.putBundle(b);
    this.guard(s);
    return payload;
  }
  async pin(
    id: string,
    pinned: boolean,
    mutation?: { key: string; update: (previous: unknown) => unknown },
  ): Promise<void> {
    if (!allowedID(id) || typeof pinned !== "boolean")
      throw new Error("Reserva inválida");
    return this.exclusive(async () => {
      const s = this.active(),
        { row, value } = await this.state(s);
      if (!value.bundles[id]) throw new Error("Conteúdo não encontrado");
      if (value.bundles[id].reserved && !pinned)
        throw new Error("Conteúdo reservado por um envio pendente");
      value.bundles[id].pinned = pinned;
      const valueWrite = await this.mutate(s, value, mutation);
      await this.commit(s, row, value, undefined, [], valueWrite);
    });
  }
}
