import { BrowserContributionRuntime } from "./contribution-runtime";
import { contributionCommandShape } from "../../sites/src/contribution-command";
import { createContributionOperations } from "../../sites/src/contribution-operations";
import {
  contributionManifestPolicy,
  summarizeContribution,
} from "../../content/src/site-contribution";
import { createContributionEnvelopeProtocol } from "../../sites/src/contribution-envelope";
import { browserCertificateCrypto } from "./certificate-crypto";
import { BrowserResourceRuntime } from "./resource-runtime";
import { parseSiteResourceRead } from "./resource-read";
import { validateSiteEditingContext } from "../../sites/src/editing";
import { draftSummary } from "../../content/src/site";
import { summarizeSiteResource } from "../../content/src/site-resource";
import { canonical } from "../../core/src/protocol";
import type { Bundle, PublicIdentity } from "../../core/src/protocol";
import type {
  Content,
  DisplayObject,
  Attachment,
} from "../../content/src/types";
import { validateContentShape } from "../../content/src/validation";
import {
  OUTBOX_LIMITS,
  requireOperationId,
  validateOutbox,
  admitOutbox,
  isPending,
  outboxItem,
  outboxPreview,
  applyConfirmations,
  type Outbox,
  type OutboxEntry,
} from "../../content/src/outbox";
import {
  applyCollectionCommand,
  validateCollections,
  validateFollowing,
  followedFeed,
  type Collection,
} from "../../../apps/node/src/social";
import { BrowserProfile } from "./profile";
import { hash, utf8, un64, validateIdentity, verifiedBundle } from "./crypto";
import type { Priority } from "./packet";
import { BrowserSiteRuntime } from "./site-runtime";
import { verifySiteContent } from "./site-content";

type Mutation = {
  author: string;
  expires: number;
  created: number;
  eventId: string;
  deleted?: boolean;
  text?: string;
};
type Data = {
  version: 1;
  quota: number;
  contacts: PublicIdentity[];
  following: string[];
  saved: string[];
  reports: { target: string; reason: string; at: number }[];
  collections: Collection[];
  siteDraft: import("../../content/src/site").SiteDraft | null;
  outbox: Outbox;
  mutations: Record<string, Mutation>;
  receipts: Record<string, { delivery?: string; receipt?: string }>;
};
export interface ApplicationNetwork {
  publish(bundle: Bundle, priority: Priority): void;
  command(operation: string, body?: unknown): Promise<any>;
  state(): { peers: any[]; counters: Record<string, number>; error: string };
  context(identity: PublicIdentity | null, generation: number): void;
}
const isAddress = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const eventKinds = [
  "edit",
  "delete",
  "reaction",
  "comment",
  "receipt",
  "delivery",
];
const grouped = (c: Content) =>
  c.groupEpoch !== undefined ||
  c.groupAudience !== undefined ||
  c.targetEpoch !== undefined;
const empty = (): Data => ({
  version: 1,
  quota: 128 * 1024 * 1024,
  contacts: [],
  following: [],
  saved: [],
  reports: [],
  collections: [],
  siteDraft: null,
  outbox: {},
  mutations: {},
  receipts: {},
});
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Application domain in the dedicated worker. No sockets and no private-key exports to the UI. */
export class BrowserApplication {
  #generation = 0;
  #queue = Promise.resolve();
  #cache = new Map<
    string,
    { revision: string; object: DisplayObject; bytes: number }
  >();
  #cacheBytes = 0;
  #timer?: ReturnType<typeof setInterval>;
  #flushing = false;
  #closed = false;
  #sites?: BrowserSiteRuntime;
  #resources?: BrowserResourceRuntime;
  #contributions?: BrowserContributionRuntime;
  constructor(
    readonly profile: BrowserProfile,
    private network: ApplicationNetwork,
  ) {}
  private owner() {
    const identity = this.profile.identity;
    if (!identity || this.#closed) throw new Error("Desbloqueia a identidade");
    return identity;
  }
  private guard(generation: number) {
    if (generation !== this.#generation || this.profile.locked || this.#closed)
      throw new Error("Sessão bloqueada durante a operação");
  }
  private parse(value: unknown): Data {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Estado da aplicação em falta");
    const d = value as Data,
      owner = this.owner().id;
    if (
      d.version !== 1 ||
      !Number.isSafeInteger(d.quota) ||
      d.quota < 1024 ||
      d.quota > 1024 ** 3 ||
      !Array.isArray(d.contacts) ||
      d.contacts.length > 256 ||
      !Array.isArray(d.saved) ||
      d.saved.length > 2048 ||
      d.saved.some((id) => !isAddress(id)) ||
      !Array.isArray(d.reports) ||
      d.reports.length > 200 ||
      !d.mutations ||
      Array.isArray(d.mutations) ||
      !d.receipts ||
      Array.isArray(d.receipts) ||
      Object.keys(d.mutations).length > 2048 ||
      Object.keys(d.receipts).length > 1024
    )
      throw new Error("Estado da aplicação inválido");
    validateFollowing(d.following);
    validateCollections(d.collections, owner);
    validateOutbox(d.outbox, owner);
    for (const [id, m] of Object.entries(d.mutations))
      if (
        !isAddress(id) ||
        !isAddress(m.author) ||
        !isAddress(m.eventId) ||
        !Number.isSafeInteger(m.expires) ||
        !Number.isSafeInteger(m.created) ||
        (m.text !== undefined &&
          (typeof m.text !== "string" || m.text.length > 12000)) ||
        (m.deleted !== undefined && typeof m.deleted !== "boolean")
      )
        throw new Error("Estado de alterações inválido");
    for (const [id, r] of Object.entries(d.receipts))
      if (
        !isAddress(id) ||
        !r ||
        typeof r !== "object" ||
        Object.keys(r).some((k) => k !== "receipt" && k !== "delivery") ||
        Object.values(r).some((v) => !isAddress(v))
      )
        throw new Error("Registo de confirmações inválido");
    if (d.siteDraft?.editing !== undefined)
      validateSiteEditingContext(d.siteDraft.editing, owner);
    if (d.siteDraft)
      validateContentShape({
        type: "site",
        blocks: d.siteDraft.blocks,
        theme: d.siteDraft.theme,
        ...(d.siteDraft.site !== undefined ? { site: d.siteDraft.site } : {}),
        ...(d.siteDraft.attachments !== undefined
          ? { attachments: d.siteDraft.attachments }
          : {}),
      });
    return d;
  }
  private async data(): Promise<Data> {
    return this.parse(await this.profile.getValue("application"));
  }
  private mutation(update: (d: Data) => void) {
    return {
      key: "application",
      update: (old: unknown) => {
        const d = this.parse(old);
        update(d);
        return this.parse(d);
      },
    };
  }
  private async update(update: (d: Data) => void, release: string[] = []) {
    await this.profile.updateValue(
      "application",
      this.mutation(update).update,
      release,
    );
    await this.#contributions?.revokeInvalid();
  }
  async open() {
    const owner = this.owner();
    let value = await this.profile.getValue("application");
    if (value === null) {
      value = empty();
      await this.profile.setValue("application", value);
    }
    const d = this.parse(value);
    await this.profile.changeQuota(d.quota);
    for (const card of d.contacts)
      if (!(await validateIdentity(card)))
        throw new Error("Contacto guardado inválido");
    this.network.context(owner, this.#generation);
    this.#sites?.close();
    this.#sites = new BrowserSiteRuntime({
      profile: this.profile,
      knownWithdrawals: async (readValue) =>
        Object.fromEntries(
          Object.entries(this.parse(await readValue("application")).mutations)
            .filter(([, m]) => m.deleted && m.expires > Date.now())
            .map(([id, m]) => [id, m.author]),
        ),
      blocked: async () =>
        ((await this.profile.getValue("mesh-settings")) as any)?.blocked ?? [],
      readers: (ids) => this.readers(ids),
      publish: (bundle) => this.network.publish(bundle, "normal"),
      request: async (ids) => {
        for (const id of ids) await this.network.command("request", { id });
      },
    });
    this.#resources?.close();
    this.#resources = new BrowserResourceRuntime({
      profile: this.profile,
      withdrawn: async (id, authorId) => {
        const m = (await this.data()).mutations[id];
        return (
          m?.author === authorId && m.deleted === true && m.expires > Date.now()
        );
      },
      blocked: async () =>
        ((await this.profile.getValue("mesh-settings")) as any)?.blocked ?? [],
      request: async (id) => {
        await this.network.command("request", { id });
      },
      readerSnapshot: async () => {
        const data = await this.data(),
          settings = (await this.profile.getValue("mesh-settings")) as any,
          cards = [owner, ...data.contacts];
        return (scope) =>
          scope === "public"
            ? scope
            : scope.map((id) => {
                if (settings?.blocked?.includes(id))
                  throw new Error("Contacto bloqueado");
                const card = cards.find((c) => c.id === id);
                if (!card)
                  throw new Error("Adiciona primeiro o cartão do destinatário");
                return card;
              });
      },
    });
    this.#contributions?.close();
    const generation = this.#generation;
    this.#contributions = new BrowserContributionRuntime({
      profile: this.profile,
      policy: async (values, id, author) => {
        this.guard(generation);
        const settings = (await values.get("mesh-settings")) as any,
          data = this.parse(await values.get("application"));
        this.guard(generation);
        if (settings?.blocked?.includes(author))
          throw Error("Autor do site bloqueado");
        const m = data.mutations[id];
        if (
          m?.author === author &&
          m.deleted === true &&
          m.expires > Date.now()
        )
          throw Error("O autor retirou este snapshot");
      },
      copyPolicy: (id, author) => [
        {
          key: "mesh-settings",
          update: (previous) => {
            this.guard(generation);
            if (previous?.blocked?.includes(author))
              throw Error("Autor do site bloqueado");
            return previous;
          },
        },
        {
          key: "application",
          update: (previous) => {
            this.guard(generation);
            const data = this.parse(previous),
              m = data.mutations[id];
            if (
              m?.author === author &&
              m.deleted === true &&
              m.expires > Date.now()
            )
              throw Error("O autor retirou este snapshot");
            return previous;
          },
        },
      ],
      publish: (bundle) => this.network.publish(bundle, "normal"),
      cancel: (id) =>
        this.network.command("cancel-owned-bundle", { id }).then(() => {}),
      cancelSource: (id, operationId) =>
        this.network
          .command("cancel-contribution-source", { id, operationId })
          .then(() => {}),
      requestSource: (id) =>
        this.network
          .command("contribution-source-request", { id })
          .then((value) => value?.requested === true),
    });
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      void this.flush();
    }, 2000);
    await this.reconcile();
  }
  lock() {
    this.#generation++;
    this.#sites?.close();
    this.#sites = undefined;
    this.#resources?.close();
    this.#resources = undefined;
    this.#contributions?.close();
    this.#contributions = undefined;
    clearInterval(this.#timer);
    this.#cache.clear();
    this.#cacheBytes = 0;
    this.profile.lock();
    this.network.context(null, this.#generation);
  }
  close() {
    this.lock();
    this.#closed = true;
    this.profile.close();
  }
  private async validateContent(content: Content) {
    validateContentShape(content);
    for (const m of content.members ?? [])
      if (!(await validateIdentity(m)))
        throw new Error("Cartão de membro inválido");
  }
  private async project(bundle: Bundle): Promise<DisplayObject> {
    const content = (await this.profile.decrypt(bundle)) as Content;
    await this.validateContent(content);
    if (content.type !== bundle.manifest.kind || grouped(content))
      throw new Error("Conteúdo ou autoridade de grupo indisponível");
    verifySiteContent(content, bundle.manifest.author);
    if (content.type === "site-contribution")
      createContributionEnvelopeProtocol(browserCertificateCrypto).match(
        bundle,
        content,
      );
    return {
      id: bundle.manifest.id,
      kind: bundle.manifest.kind,
      author: bundle.manifest.author,
      created: bundle.manifest.created,
      expires: bundle.manifest.expires,
      content,
      pinned: false,
      readers: bundle.manifest.keys.map((k) => k.reader),
      public: bundle.manifest.publicKey !== null,
    };
  }
  private summary(o: DisplayObject): DisplayObject {
    const result = structuredClone(o);
    if (result.kind === "site-contribution")
      result.content = summarizeContribution(result.content);
    if (result.kind === "site-resource")
      result.content = summarizeSiteResource(result.content);
    if (result.content.attachments)
      result.content.attachments = result.content.attachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        data: "",
        size: un64(a.data).length,
      }));
    return result;
  }
  private async authorized(
    o: DisplayObject,
    all: DisplayObject[],
    depth = 0,
  ): Promise<boolean> {
    if (depth > 3 || grouped(o.content)) return false;
    const readers = [...o.readers].sort();
    if (
      new Set(readers).size !== readers.length ||
      (!o.public && !readers.includes(o.author.id))
    )
      return false;
    if (
      ["message", "group", "receipt", "delivery"].includes(o.kind) &&
      o.public
    )
      return false;
    if (eventKinds.includes(o.kind)) {
      const target = all.find((a) => a.id === o.content.target);
      if (
        !target ||
        eventKinds.includes(target.kind) ||
        !(await this.authorized(target, all, depth + 1))
      )
        return false;
      if (
        ["edit", "delete"].includes(o.kind) &&
        target.author.id !== o.author.id
      )
        return false;
      if (
        o.public !== target.public ||
        !same(readers, [...target.readers].sort()) ||
        (!target.public && !target.readers.includes(o.author.id))
      )
        return false;
      if (
        ["receipt", "delivery"].includes(o.kind) &&
        (target.kind !== "message" || target.author.id === o.author.id)
      )
        return false;
      return true;
    }
    if (o.kind === "message" || o.kind === "group") {
      const members = o.content.members?.map((m) => m.id).sort();
      if (!members || !same(members, readers)) return false;
      if (o.kind === "group") return !!o.content.title?.trim();
      if (o.content.conversation?.startsWith("dm:"))
        return (
          o.content.conversation === "dm:" + (await hash(members.join(":")))
        );
      const group = all.find(
        (g) => g.id === o.content.conversation && g.kind === "group",
      );
      return (
        !!group &&
        (await this.authorized(group, all, depth + 1)) &&
        same(readers, [...group.readers].sort())
      );
    }
    return true;
  }
  private async objects(): Promise<DisplayObject[]> {
    const generation = this.#generation,
      records = await this.profile.records(),
      data = await this.data(),
      all: DisplayObject[] = [];
    for (const [id, entry] of Object.entries(records)) {
      if (entry.expires <= Date.now()) continue;
      const revision = entry.revision ?? `${entry.size}:${entry.accessed}`,
        cached = this.#cache.get(id);
      let object: DisplayObject | undefined =
        cached?.revision === revision
          ? structuredClone(cached.object)
          : undefined;
      if (!object) {
        try {
          object = this.summary(
            await this.project(await this.profile.getBundle(id)),
          );
        } catch {
          continue;
        }
        const size = utf8(canonical(object)).length;
        const old = this.#cache.get(id);
        if (old) {
          this.#cache.delete(id);
          this.#cacheBytes -= old.bytes;
        }
        while (this.#cacheBytes + size > 16 * 1024 * 1024 && this.#cache.size) {
          const first = this.#cache.keys().next().value!;
          this.#cacheBytes -= this.#cache.get(first)!.bytes;
          this.#cache.delete(first);
        }
        this.#cache.set(id, {
          revision,
          object: structuredClone(object),
          bytes: size,
        });
        this.#cacheBytes += size;
      }
      object.pinned = entry.pinned;
      all.push(object);
      this.guard(generation);
    }
    for (const [id, cached] of this.#cache)
      if (!records[id]) {
        this.#cacheBytes -= cached.bytes;
        this.#cache.delete(id);
      }
    const blocked =
      ((await this.profile.getValue("mesh-settings")) as any)?.blocked ?? [];
    const accepted: DisplayObject[] = [];
    for (const object of all)
      if (
        !blocked.includes(object.author.id) &&
        (await this.authorized(object, all))
      ) {
        const mutation = data.mutations[object.id];
        if (
          mutation &&
          mutation.author === object.author.id &&
          mutation.expires > Date.now()
        ) {
          object.deleted = mutation.deleted;
          if (mutation.text !== undefined) object.editedText = mutation.text;
        }
        accepted.push(object);
      }
    this.guard(generation);
    return accepted.sort(
      (a, b) => b.created - a.created || b.id.localeCompare(a.id),
    );
  }
  private page(objects: DisplayObject[], before?: string) {
    if (before !== undefined && !/^\d{1,16}:[a-f0-9]{64}$/.test(before))
      throw new Error("Cursor de histórico inválido");
    const position = before
      ? objects.findIndex((o) => `${o.created}:${o.id}` === before)
      : -1;
    if (before && position < 0)
      throw new Error("O histórico mudou; actualiza a lista");
    const values = objects.slice(position + 1, position + 129),
      last = values.at(-1);
    return {
      objects: values,
      history: {
        hasMore: position + 1 + values.length < objects.length,
        nextBefore: last ? `${last.created}:${last.id}` : null,
        total: objects.length,
        availableIds: objects.map((o) => o.id),
      },
    };
  }
  async state() {
    const initialized = await this.profile.initialized(),
      locked = this.profile.locked,
      network = this.network.state();
    const base = {
      nativeRuntime: "Browser",
      capabilities: { autonomous: true, dynamicGroups: false },
      initialized,
      locked,
      identity: this.profile.identity,
      tcpPort: -1,
      peers: network.peers,
      counters: network.counters,
      storage: { count: 0, bytes: 0, quota: this.profile.quota, pinned: 0 },
      settings: { relay: false, lowPower: false },
      contacts: [],
      blocked: [],
      following: [],
      saved: [],
      reports: [],
      collections: [],
      siteDraft: null,
      sitePublishing: null,
      objects: [],
      outbox: [],
      history: { hasMore: false, nextBefore: null, total: 0, availableIds: [] },
      transportError: network.error,
      now: Date.now(),
    };
    if (locked) return base;
    const generation = this.#generation,
      data = await this.data(),
      objects = await this.objects(),
      settings = (await this.profile.getValue("mesh-settings")) as any,
      storage = await this.profile.stats(),
      available = new Set(objects.map((o) => o.id));
    this.guard(generation);
    return {
      ...base,
      storage,
      settings: {
        relay: settings?.relay ?? false,
        lowPower: settings?.lowPower ?? false,
      },
      contacts: data.contacts,
      blocked: settings?.blocked ?? [],
      following: data.following,
      saved: data.saved,
      reports: data.reports,
      collections: data.collections,
      siteDraft: draftSummary(data.siteDraft),
      sitePublishing: this.#sites?.status() ?? null,
      ...this.page(objects),
      followedPostIds: followedFeed(objects, data.following).map((o) => o.id),
      outbox: Object.values(data.outbox).map((e) =>
        outboxItem(e, Date.now(), settings?.blocked ?? [], available.has(e.id)),
      ),
    };
  }
  async bundleForTransport(id: string) {
    const generation = this.#generation,
      bundle = await this.profile.getBundle(id);
    this.guard(generation);
    if (bundle.manifest.kind === "site-contribution") {
      if (!contributionManifestPolicy(bundle.manifest))
        throw Error("Envelope de proposta inválido");
      if (
        bundle.manifest.author.id === this.owner().id &&
        (!this.#contributions || !(await this.#contributions.canServe(bundle)))
      )
        throw Error("Proposta não autorizada para envio");
    }
    this.guard(generation);
    return bundle;
  }
  async sourceForTransport(id: string) {
    if (!isAddress(id)) throw Error("Endereço inválido");
    const generation = this.#generation;
    this.guard(generation);
    const result = await this.#contributions?.sourceForRequest(id);
    this.guard(generation);
    return result ?? null;
  }
  async ingest(value: Bundle): Promise<string> {
    const generation = this.#generation,
      bundle = await verifiedBundle(value);
    const owner = this.owner();
    if (
      bundle.manifest.kind === "site-contribution" &&
      !contributionManifestPolicy(bundle.manifest)
    )
      throw Error("Propostas exigem um envelope privado limitado");
    if (
      (
        (await this.profile.getValue("mesh-settings")) as any
      )?.blocked?.includes(bundle.manifest.author.id)
    )
      throw new Error("Origem bloqueada");
    let object: DisplayObject | undefined;
    try {
      object = await this.project(bundle);
    } catch (error) {
      if (
        ["site", "site-resource", "site-contribution"].includes(
          bundle.manifest.kind,
        ) &&
        (bundle.manifest.publicKey !== null ||
          bundle.manifest.keys.some((k) => k.reader === owner.id))
      )
        throw error;
      /* Opaque relaying does not need a read key. */
    }
    if (bundle.manifest.kind === "site") {
      if (!this.#sites) throw new Error("Sessão de site bloqueada");
      await this.#sites.receive(bundle);
    }
    if (object && eventKinds.includes(object.kind)) {
      const all = await this.objects();
      if (await this.authorized(object, all)) {
        const target = all.find((o) => o.id === object!.content.target)!;
        const data = await this.data(),
          now = Date.now();
        if (["receipt", "delivery"].includes(object.kind)) {
          applyConfirmations(data.outbox, [object], now);
          const release = Object.values(data.outbox)
            .filter((e) => !isPending(e, now))
            .map((e) => e.id);
          await this.update((d) => {
            applyConfirmations(d.outbox, [object!], now);
          }, release);
        } else if (["edit", "delete"].includes(object.kind))
          await this.update((d) => {
            const old = d.mutations[target.id];
            if (
              !old ||
              object!.created > old.created ||
              (object!.created === old.created && object!.id > old.eventId) ||
              (object!.kind === "delete" && !old.deleted)
            )
              d.mutations[target.id] = {
                author: target.author.id,
                expires: target.expires,
                created: object!.created,
                eventId: object!.id,
                ...(old?.deleted || object!.kind === "delete"
                  ? { deleted: true }
                  : { text: object!.content.text ?? "" }),
              };
          });
      }
    }
    this.guard(generation);
    if (bundle.manifest.kind === "site-contribution") {
      if (!this.#contributions) throw Error("Sessão de propostas bloqueada");
      await this.#contributions.receive(bundle);
    } else if (bundle.manifest.kind === "site") {
      if (!this.#contributions) throw Error("Sessão de propostas bloqueada");
      await this.#contributions.receiveSource(bundle);
    }
    this.guard(generation);
    await this.profile.putBundle(bundle);
    const cached = this.#cache.get(bundle.manifest.id);
    if (cached) {
      this.#cacheBytes -= cached.bytes;
      this.#cache.delete(bundle.manifest.id);
    }
    if (object?.kind === "message" && object.author.id !== this.owner().id) {
      try {
        await this.confirm(object.id, "delivery");
      } catch {
        /* Reading remains possible when a confirmation cannot be retained. */
      }
    }
    return bundle.manifest.id;
  }
  private async readers(recipients: unknown, extra: PublicIdentity[] = []) {
    const owner = this.owner();
    if (
      recipients !== "public" &&
      (!Array.isArray(recipients) ||
        recipients.length > 64 ||
        recipients.some((id) => !isAddress(id)))
    )
      throw new Error("Destinatários inválidos");
    const data = await this.data(),
      settings = (await this.profile.getValue("mesh-settings")) as any,
      cards = [owner, ...extra, ...data.contacts];
    return recipients === "public"
      ? ("public" as const)
      : [...new Set([owner.id, ...(recipients as string[])])].map((id) => {
          const card = cards.find((c) => c.id === id);
          if (!card)
            throw new Error("Adiciona primeiro o cartão do destinatário");
          if (settings?.blocked?.includes(id))
            throw new Error("Contacto bloqueado");
          return card;
        });
  }
  private async prepare(
    raw: Content,
    recipients: string[] | "public",
    ttlMs = 30 * 86400_000,
    extra: PublicIdentity[] = [],
  ): Promise<Bundle> {
    const owner = this.owner(),
      content = JSON.parse(canonical(raw)) as Content;
    await this.validateContent(content);
    if (content.type === "site-contribution")
      throw Error("Envia propostas através do comando de contribuições");
    if (content.type === "site-resource")
      throw new Error(
        "Guarda recursos opcionais através do gestor de recursos",
      );
    if (
      content.type === "site" &&
      (Object.hasOwn(content, "siteRevision") ||
        (content.site?.version ?? 0) >= 3)
    )
      throw new Error("Publica revisões através do comando de site");
    if (grouped(content))
      throw new Error("Grupos dinâmicos ainda não estão ligados ao motor web");
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 365 * 86400_000)
      throw new Error("Prazo inválido");
    const readers = await this.readers(recipients, extra);
    if (
      ["message", "group", "receipt", "delivery"].includes(content.type) &&
      readers === "public"
    )
      throw new Error("Conversas exigem destinatários privados");
    const all = await this.objects();
    if (content.type === "message") {
      if (!content.text?.trim() && !content.attachments?.length)
        throw new Error("Escreve uma mensagem ou junta um anexo");
      const members = readers as PublicIdentity[],
        dm =
          "dm:" +
          (await hash(
            members
              .map((m) => m.id)
              .sort()
              .join(":"),
          ));
      content.conversation ??= dm;
      if (content.conversation.startsWith("dm:") && content.conversation !== dm)
        throw new Error("Destinatários não correspondem à conversa");
      if (!content.conversation.startsWith("dm:")) {
        const group = all.find(
          (o) => o.id === content.conversation && o.kind === "group",
        );
        if (
          !group ||
          !same([...group.readers].sort(), members.map((m) => m.id).sort())
        )
          throw new Error("Grupo não autorizado");
      }
      content.members = members;
      if (content.replyTo) {
        const target = all.find((o) => o.id === content.replyTo);
        if (
          !target ||
          target.content.conversation !== content.conversation ||
          !same([...target.readers].sort(), members.map((m) => m.id).sort())
        )
          throw new Error("Resposta fora da conversa autorizada");
      }
    }
    if (content.type === "group") {
      if (!content.title?.trim()) throw new Error("Indica o nome do grupo");
      content.members = readers as PublicIdentity[];
    }
    if (eventKinds.includes(content.type)) {
      const target = all.find((o) => o.id === content.target);
      if (
        !target ||
        eventKinds.includes(target.kind) ||
        grouped(target.content)
      )
        throw new Error("Alvo sem autorização");
      if (
        ["edit", "delete"].includes(content.type) &&
        target.author.id !== owner.id
      )
        throw new Error("Só o autor pode alterar este conteúdo");
      if (
        ["receipt", "delivery"].includes(content.type) &&
        (target.kind !== "message" || target.author.id === owner.id)
      )
        throw new Error("Confirmação inválida");
      const scope =
        readers === "public" ? "public" : readers.map((r) => r.id).sort();
      if (!same(scope, target.public ? "public" : [...target.readers].sort()))
        throw new Error("A privacidade deve corresponder ao alvo");
      if (["edit", "delete"].includes(content.type))
        ttlMs = Math.max(1000, target.expires - Date.now());
    }
    return this.profile.signContent(content.type, content, readers, ttlMs);
  }
  private async publish(
    content: Content,
    recipients: string[] | "public",
    ttl?: number,
  ) {
    const bundle = await this.prepare(content, recipients, ttl);
    await this.ingest(bundle);
    if (["site", "group"].includes(content.type))
      await this.profile.pin(bundle.manifest.id, true);
    this.network.publish(bundle, content.priority ?? "normal");
    return this.summary(await this.project(bundle));
  }
  private async confirm(id: string, kind: "receipt" | "delivery") {
    const generation = this.#generation,
      owner = this.owner(),
      data = await this.data(),
      all = await this.objects(),
      target = all.find((o) => o.id === id);
    if (
      !target ||
      target.kind !== "message" ||
      target.author.id === owner.id ||
      target.public
    )
      throw new Error("Confirmação não autorizada");
    const previous = data.receipts[id]?.[kind];
    if (previous) {
      try {
        const existing = await this.profile.getBundle(previous);
        this.guard(generation);
        this.network.publish(existing, "normal");
        return;
      } catch {}
    }
    const full = await this.project(await this.profile.getBundle(id));
    const bundle = await this.prepare(
      { type: kind, target: id },
      target.readers,
      Math.max(1000, target.expires - Date.now()),
      full.content.members ?? [],
    );
    await this.profile.putBundle(
      bundle,
      false,
      this.mutation((d) => {
        if (!d.receipts[id] && Object.keys(d.receipts).length >= 1024)
          delete d.receipts[Object.keys(d.receipts)[0]];
        d.receipts[id] = { ...d.receipts[id], [kind]: bundle.manifest.id };
      }),
    );
    this.guard(generation);
    this.network.publish(bundle, "normal");
  }
  private async send(body: any) {
    const generation = this.#generation,
      operationId = requireOperationId(body.operationId),
      owner = this.owner(),
      ttl = body.ttlMs ?? 30 * 86400_000;
    if (
      body.content?.type !== "message" ||
      !Array.isArray(body.recipients) ||
      body.recipients.some((id: unknown) => !isAddress(id))
    )
      throw new Error("Envio inválido");
    const fingerprint = await hash(
        canonical({
          content: body.content,
          recipients: [...new Set(body.recipients)].sort(),
          ttlMs: ttl,
        }),
      ),
      data = await this.data(),
      existing = data.outbox[operationId];
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error("O identificador pertence a outro envio");
      let available = false;
      try {
        const retained = await this.profile.getBundle(existing.id);
        available =
          retained.manifest.author.id === existing.author &&
          retained.manifest.kind === "message" &&
          retained.manifest.expires === existing.expires &&
          same(
            retained.manifest.keys
              .map((k) => k.reader)
              .filter((id) => id !== existing.author)
              .sort(),
            Object.keys(existing.confirmations).sort(),
          );
      } catch {}
      if (!available) {
        await this.update(
          (d) => {
            const e = d.outbox[operationId];
            if (e) {
              e.phase = "unavailable";
              e.lastError = "Conteúdo indisponível ou corrompido";
            }
          },
          [existing.id],
        );
        existing.phase = "unavailable";
      }
      const settings = (await this.profile.getValue("mesh-settings")) as any,
        outbox = outboxItem(
          existing,
          Date.now(),
          settings?.blocked ?? [],
          available,
        );
      return { accepted: outbox.accepted, outbox };
    }
    const bundle = await this.prepare(body.content, body.recipients, ttl),
      content = (await this.profile.decrypt(bundle)) as Content,
      recipients = bundle.manifest.keys
        .map((k) => k.reader)
        .filter((id) => id !== owner.id);
    if (!recipients.length)
      throw new Error("Escolhe pelo menos um destinatário");
    const entry: OutboxEntry = {
      operationId,
      fingerprint,
      id: bundle.manifest.id,
      author: owner.id,
      conversation: content.conversation!,
      preview: outboxPreview(content.text ?? "Anexo"),
      created: bundle.manifest.created,
      expires: bundle.manifest.expires,
      priority:
        content.priority ?? (content.attachments?.length ? "bulk" : "normal"),
      bytes: utf8(canonical(bundle)).length,
      phase: "ready",
      attempts: 0,
      lastAttemptAt: 0,
      nextAttemptAt: 0,
      lastError: "",
      manualPin: false,
      confirmations: Object.fromEntries(recipients.map((id) => [id, {}])),
    };
    this.guard(generation);
    await this.profile.putBundle(
      bundle,
      false,
      this.mutation((d) => {
        if (d.outbox[operationId]) throw new Error("Envio já registado");
        d.outbox = admitOutbox(d.outbox, entry, Date.now());
      }),
      true,
    );
    this.guard(generation);
    void this.flush();
    return { accepted: true, outbox: outboxItem(entry, Date.now(), [], true) };
  }
  private async reconcile() {
    const data = await this.data(),
      now = Date.now(),
      ids = new Set(await this.profile.ids()),
      release: string[] = [],
      missing: string[] = [];
    for (const e of Object.values(data.outbox)) {
      if (!ids.has(e.id) && e.phase !== "unavailable")
        missing.push(e.operationId);
      if (!isPending(e, now)) release.push(e.id);
    }
    const expired = Object.entries(data.mutations)
      .filter(([, m]) => m.expires <= now)
      .map(([id]) => id);
    if (missing.length || release.length || expired.length)
      await this.update((d) => {
        for (const op of missing) {
          const e = d.outbox[op];
          if (e && !ids.has(e.id)) {
            e.phase = "unavailable";
            e.lastError = "Conteúdo local indisponível";
          }
        }
        for (const id of expired)
          if (d.mutations[id]?.expires <= now) delete d.mutations[id];
      }, release);
  }
  async flush() {
    if (this.profile.locked || this.#closed || this.#flushing) return;
    this.#flushing = true;
    try {
      await this.reconcile();
      if (!this.network.state().peers.some((p) => p.connected)) return;
      const data = await this.data(),
        settings = (await this.profile.getValue("mesh-settings")) as any,
        now = Date.now();
      for (const entry of Object.values(data.outbox)
        .filter(
          (e) =>
            isPending(e, now) &&
            e.nextAttemptAt <= now &&
            !Object.keys(e.confirmations).some((id) =>
              settings?.blocked?.includes(id),
            ),
        )
        .sort(
          (a, b) =>
            (a.priority === "sos" ? -1 : 0) - (b.priority === "sos" ? -1 : 0) ||
            a.created - b.created,
        )
        .slice(0, 8)) {
        let bundle: Bundle;
        try {
          bundle = await this.profile.getBundle(entry.id);
          if (
            bundle.manifest.author.id !== entry.author ||
            !same(
              bundle.manifest.keys
                .map((k) => k.reader)
                .filter((id) => id !== entry.author)
                .sort(),
              Object.keys(entry.confirmations).sort(),
            )
          )
            throw new Error("Registo não corresponde ao conteúdo");
        } catch {
          await this.update(
            (d) => {
              const e = d.outbox[entry.operationId];
              if (e) {
                e.phase = "unavailable";
                e.lastError = "Conteúdo indisponível ou corrompido";
              }
            },
            [entry.id],
          );
          continue;
        }
        await this.update((d) => {
          const e = d.outbox[entry.operationId];
          if (e && isPending(e, Date.now())) {
            e.attempts++;
            e.lastAttemptAt = Date.now();
            e.nextAttemptAt =
              Date.now() +
              Math.min(30_000, 2000 * 2 ** Math.min(e.attempts, 4));
            e.lastError = "";
          }
        });
        if (!this.profile.locked && !this.#closed)
          this.network.publish(bundle, entry.priority);
      }
    } catch {
      /* Durable state is rechecked at the next attempt; no mutation is replayed with a fresh ID. */
    } finally {
      await this.#sites?.tick();
      await this.#resources?.tick();
      await this.#contributions?.tick();
      this.#flushing = false;
    }
  }
  async call(path: string, body: any = {}): Promise<any> {
    if (path === "state") return this.state();
    if (path === "lock") {
      this.lock();
      return { ok: true };
    }
    if (path === "resource-command" && body?.action === "inspect") {
      // Inspection neither signs nor requests content nor mutates its store.
      // Keep it out of the mutation queue so bounded read work can overlap I/O.
      this.owner();
      // Capture the read-only intent before the first await; a mutable caller
      // must not turn it into an obtain or change targets while state is read.
      const request = parseSiteResourceRead(body);
      const generation = this.#generation,
        resources = this.#resources;
      await this.objects();
      this.guard(generation);
      if (!resources) throw new Error("Sessão de recursos bloqueada");
      const result = await resources.command(request);
      this.guard(generation);
      return result;
    }
    if (path === "contribution-command") {
      const command = contributionCommandShape(body);
      if (command.action === "submit") {
        const { action: _action, ...raw } = command;
        body = {
          action: "submit",
          ...createContributionOperations(browserCertificateCrypto).request(
            raw,
            this.owner().id,
          ).request,
        };
      } else body = command;
    }
    const run = this.#queue.then(() => this.execute(path, body));
    this.#queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  private async execute(path: string, body: any): Promise<any> {
    if (path === "setup" || path === "unlock") {
      if (path === "unlock") await this.profile.unlock(body.password);
      else if (body.recovery)
        await this.profile.restore(body.recovery, body.password);
      else await this.profile.setup(body.name, body.password);
      try {
        await this.open();
        return this.owner();
      } catch (error) {
        this.lock();
        throw error;
      }
    }
    this.owner();
    if (path === "contribution-command") {
      const generation = this.#generation;
      await this.objects();
      this.guard(generation);
      if (!this.#contributions) throw Error("Sessão de propostas bloqueada");
      return this.#contributions.command(body);
    }
    if (path === "resource-command") {
      if (["inspect", "obtain"].includes(body?.action)) await this.objects();
      if (!this.#resources) throw new Error("Sessão de recursos bloqueada");
      return this.#resources.command(body);
    }
    if (path === "site-command") {
      if (!this.#sites) throw new Error("Sessão de site bloqueada");
      return this.#sites.command(body);
    }
    if (path === "export")
      return { vault: await this.profile.exportCopy(body.password) };
    if (path === "contact") {
      const card = JSON.parse(canonical(body.contact)) as PublicIdentity;
      if (!(await validateIdentity(card)) || card.id === this.owner().id)
        throw new Error("Cartão público inválido");
      await this.update((d) => {
        if (d.contacts.some((c) => c.id === card.id && !same(c, card)))
          throw new Error(
            "O cartão mudou; a revisão da chave ainda não está disponível neste cliente",
          );
        if (!d.contacts.some((c) => c.id === card.id)) {
          if (d.contacts.length >= 256) throw new Error("Limite de contactos");
          d.contacts.push(card);
        }
      });
      return { ok: true };
    }
    if (path === "send") return this.send(body);
    if (path === "publish")
      return this.publish(body.content, body.recipients, body.ttlMs);
    if (path === "view" || path === "attachment") {
      const found = (await this.objects()).find((o) => o.id === body.id);
      if (!found) throw new Error("Sem autorização de leitura");
      const full = await this.project(await this.profile.getBundle(body.id));
      full.pinned = found.pinned;
      full.deleted = found.deleted;
      full.editedText = found.editedText;
      if (path === "attachment") {
        if (
          full.deleted ||
          !Number.isInteger(body.index) ||
          body.index < 0 ||
          body.index > 3 ||
          !full.content.attachments?.[body.index]
        )
          throw new Error("Anexo indisponível");
        return full.content.attachments[body.index] as Attachment;
      }
      await this.profile.view(body.id);
      if (
        full.kind === "message" &&
        !full.deleted &&
        full.author.id !== this.owner().id
      ) {
        try {
          await this.confirm(full.id, "receipt");
        } catch {}
      }
      return full;
    }
    if (path === "history") return this.page(await this.objects(), body.before);
    if (path === "retrieve") {
      if (!isAddress(body.id)) throw new Error("Endereço inválido");
      const found = (await this.objects()).some((o) => o.id === body.id);
      if ((await this.profile.ids()).includes(body.id))
        return { status: found ? "available" : "unreadable", id: body.id };
      await this.network.command("request", { id: body.id });
      return { status: "requested", id: body.id };
    }
    if (path === "site-draft-load")
      return structuredClone((await this.data()).siteDraft);
    if (path === "site-draft") {
      const context =
        body.editing === undefined
          ? undefined
          : validateSiteEditingContext(body.editing, this.owner().id);
      validateContentShape({
        type: "site",
        blocks: body.blocks,
        theme: body.theme,
        ...(body.site !== undefined ? { site: body.site } : {}),
        ...(body.attachments !== undefined
          ? { attachments: body.attachments }
          : {}),
      });
      await this.update((d) => {
        d.siteDraft = {
          blocks: body.blocks,
          theme: body.theme,
          ...(body.site !== undefined ? { site: body.site } : {}),
          ...(body.attachments !== undefined
            ? { attachments: body.attachments }
            : {}),
          ...(context !== undefined ? { editing: context } : {}),
          savedAt: Date.now(),
        };
      });
      return { ok: true };
    }
    if (path === "collection") {
      if (
        body.action === "add" &&
        !(await this.objects()).some((o) => o.id === body.objectId)
      )
        throw new Error("Conteúdo indisponível ou não autorizado");
      const owner = this.owner().id;
      await this.update((d) => {
        d.collections = applyCollectionCommand(
          d.collections,
          owner,
          body,
          Date.now(),
        );
      });
      return (await this.data()).collections;
    }
    if (path === "outbox-retry") {
      const op = requireOperationId(body.operationId),
        data = await this.data(),
        entry = data.outbox[op];
      if (!entry)
        throw new Error(
          "Registo de envio não conservado; revê a conversa antes de um novo envio",
        );
      const settings = (await this.profile.getValue("mesh-settings")) as any;
      if (
        Object.keys(entry.confirmations).some((id) =>
          settings?.blocked?.includes(id),
        )
      )
        throw new Error("Contacto bloqueado; o envio permanece suspenso");
      if (!isPending(entry, Date.now()))
        throw new Error("Este envio já não pode ser repetido");
      await this.update((d) => {
        d.outbox[op].nextAttemptAt = 0;
      });
      await this.flush();
      const next = (await this.data()).outbox[op],
        available = (await this.profile.ids()).includes(next.id),
        outbox = outboxItem(
          next,
          Date.now(),
          settings?.blocked ?? [],
          available,
        );
      return { accepted: outbox.accepted, outbox };
    }
    if (path === "settings") {
      if (body.quota !== undefined)
        await this.profile.changeQuota(
          body.quota,
          this.mutation((d) => {
            d.quota = body.quota;
          }),
        );
      if (body.relay !== undefined)
        await this.network.command("relay", { value: body.relay });
      if (body.lowPower !== undefined)
        await this.network.command("low-power", { value: body.lowPower });
      return { ok: true };
    }
    if (path === "action") {
      if (
        !isAddress(body.target) ||
        (body.value !== undefined && typeof body.value !== "boolean")
      )
        throw new Error("Acção inválida");
      const enabled = body.value ?? true;
      if (body.action === "block") {
        await this.network.command("block", {
          id: body.target,
          value: enabled,
        });
        return { ok: true };
      }
      if (body.action === "pin") {
        const entry = Object.values((await this.data()).outbox).find(
          (e) => e.id === body.target,
        );
        if (entry && isPending(entry, Date.now()) && !enabled)
          throw new Error("Conteúdo reservado por envio pendente");
        await this.profile.pin(
          body.target,
          enabled,
          this.mutation((d) => {
            for (const e of Object.values(d.outbox))
              if (e.id === body.target) e.manualPin = enabled;
          }),
        );
        return { ok: true };
      }
      await this.update((d) => {
        if (body.action === "follow" || body.action === "save") {
          const key = body.action === "follow" ? "following" : "saved";
          d[key] = [
            ...d[key].filter((id) => id !== body.target),
            ...(enabled ? [body.target] : []),
          ];
          if (key === "following") validateFollowing(d.following);
          else if (d.saved.length > 2048)
            throw new Error("Limite de guardados");
        } else if (body.action === "report") {
          if (
            typeof body.reason !== "string" ||
            !body.reason.trim() ||
            body.reason.length > 500
          )
            throw new Error("Indica um motivo até 500 caracteres");
          d.reports = [
            ...d.reports.slice(-199),
            { target: body.target, reason: body.reason, at: Date.now() },
          ];
        } else throw new Error("Acção desconhecida");
      });
      return { ok: true };
    }
    if (path === "group-command")
      throw new Error(
        "A autoridade de grupos dinâmicos ainda não está integrada no motor web",
      );
    throw new Error("Operação não disponível neste motor");
  }
}
