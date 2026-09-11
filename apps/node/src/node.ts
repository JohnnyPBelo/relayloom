import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  createIdentity,
  exportVault,
  importVault,
  validateIdentity,
  ContentStore,
  createBundle,
  decryptBundle,
  verifyBundle,
  atomic,
  type Identity,
  type PublicIdentity,
  type Bundle,
  type Manifest,
  canonical,
  hash,
} from "../../../packages/core/src/index.js";
import {
  readPrivateState,
  writePrivateState,
  type PrivateState,
} from "./local-state.js";
import {
  Router,
  type Priority,
} from "../../../packages/transport/src/index.js";

export interface Attachment {
  name: string;
  mime: string;
  data: string;
}
export interface SiteBlock {
  id: string;
  type: "hero" | "text" | "links" | "callout";
  title: string;
  body: string;
  url?: string;
}
export interface Content {
  type: string;
  text?: string;
  title?: string;
  conversation?: string;
  members?: PublicIdentity[];
  target?: string;
  emoji?: string;
  replyTo?: string;
  attachments?: Attachment[];
  blocks?: SiteBlock[];
  theme?: string;
  value?: boolean;
  priority?: Priority;
  [key: string]: unknown;
}
export interface DisplayObject {
  id: string;
  author: PublicIdentity;
  kind: string;
  created: number;
  expires: number;
  content: Content;
  pinned: boolean;
  readers: string[];
  public: boolean;
  deleted?: boolean;
  editedText?: string;
  route?: unknown;
}
interface Config {
  contacts: PublicIdentity[];
  blocked: string[];
  following: string[];
  saved: string[];
  reports: { target: string; reason: string; at: number }[];
  relay: boolean;
  lowPower: boolean;
  quota: number;
  peers: { host: string; port: number }[];
}
export class LoomNode extends EventEmitter {
  identity?: Identity;
  private privateState: PrivateState = { mutations: {} };
  readonly store: ContentStore;
  readonly router: Router;
  config: Config;
  lastTransportError = "";
  tcpPort = 0;
  private syncTimer: ReturnType<typeof setInterval>;
  private routes = new Map<string, unknown>();
  private requests = new Map<string, number>();
  private receipts = new Set<string>();
  private cancellations: (() => void)[] = [];
  constructor(readonly dir: string) {
    super();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.config = existsSync(join(dir, "config.json"))
      ? JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))
      : {
          contacts: [],
          blocked: [],
          following: [],
          saved: [],
          reports: [],
          relay: true,
          lowPower: false,
          quota: 128 * 1024 * 1024,
          peers: [],
        };
    this.store = new ContentStore(join(dir, "store"), this.config.quota);
    this.router = new Router({
      relay: this.config.relay,
      validate: (payload) => this.validateWire(payload),
    });
    this.router.lowPower = this.config.lowPower;
    this.router.on("payload", (payload, route) => this.receive(payload, route));
    this.router.on("transportError", (message) => {
      this.lastTransportError = message;
    });
    this.syncTimer = setInterval(() => this.sync(), 2200);
    this.syncTimer.unref();
  }
  get initialized() {
    return existsSync(join(this.dir, "identity.vault"));
  }
  private saveConfig() {
    atomic(join(this.dir, "config.json"), JSON.stringify(this.config));
  }
  async start(tcpPort = 0, host = "127.0.0.1") {
    this.tcpPort =
      tcpPort === -1 ? -1 : await this.router.listen(tcpPort, host);
    for (const p of this.config.peers)
      this.cancellations.push(this.router.connectTcp(p.host, p.port));
    return this.tcpPort;
  }
  async stop() {
    clearInterval(this.syncTimer);
    for (const cancel of this.cancellations) cancel();
    await this.router.stop();
    this.identity = undefined;
  }
  setup(name: string, password: string, recovery?: string) {
    if (this.initialized) throw new Error("Já existe uma identidade neste nó");
    const identity = recovery
      ? importVault(recovery, password)
      : createIdentity(name);
    atomic(join(this.dir, "identity.vault"), exportVault(identity, password));
    this.identity = identity;
    this.privateState = readPrivateState(
      join(this.dir, "private-state.json"),
      identity,
    );
    return identity.public;
  }
  unlock(password: string) {
    const identity = importVault(
      readFileSync(join(this.dir, "identity.vault"), "utf8"),
      password,
    );
    const local = readPrivateState(
      join(this.dir, "private-state.json"),
      identity,
    );
    this.identity = identity;
    this.privateState = local;
    return identity.public;
  }
  lock() {
    this.identity = undefined;
    this.privateState = { mutations: {} };
  }
  private requireIdentity() {
    if (!this.identity) throw new Error("Desbloqueie a identidade");
    return this.identity;
  }
  saveDraft(blocks: SiteBlock[], theme: string) {
    this.requireIdentity();
    this.validateContent({ type: "site", blocks, theme });
    const next = {
      ...this.privateState,
      siteDraft: { blocks, theme, savedAt: Date.now() },
    };
    this.persistPrivate(next);
  }
  private persistPrivate(next = this.privateState) {
    writePrivateState(
      join(this.dir, "private-state.json"),
      next,
      this.requireIdentity(),
    );
    this.privateState = next;
  }
  export(password: string) {
    return exportVault(this.requireIdentity(), password);
  }
  addContact(contact: PublicIdentity) {
    this.requireIdentity();
    if (contact.id === this.identity!.public.id)
      throw new Error("Este cartão é da sua própria identidade");
    if (!validateIdentity(contact))
      throw new Error("Cartão de contacto ou assinatura inválidos");
    if (
      this.config.contacts.length >= 256 &&
      !this.config.contacts.some((c) => c.id === contact.id)
    )
      throw new Error("Limite de contactos");
    this.config.contacts = [
      ...this.config.contacts.filter((c) => c.id !== contact.id),
      contact,
    ];
    this.saveConfig();
  }
  connect(host: string, port: number) {
    this.requireIdentity();
    if (this.config.peers.length >= 16) throw new Error("Limite de ligações");
    if (!this.config.peers.some((p) => p.host === host && p.port === port)) {
      this.cancellations.push(this.router.connectTcp(host, port));
      this.config.peers.push({ host, port });
      this.saveConfig();
    }
  }
  connectSerial(path: string, baud: number) {
    this.requireIdentity();
    this.cancellations.push(this.router.connectSerial(path, baud));
  }
  settings(patch: { relay?: boolean; lowPower?: boolean; quota?: number }) {
    this.requireIdentity();
    if (
      (patch.relay !== undefined && typeof patch.relay !== "boolean") ||
      (patch.lowPower !== undefined && typeof patch.lowPower !== "boolean")
    )
      throw new Error("Definições inválidas");
    if (patch.quota !== undefined) {
      this.store.setQuota(patch.quota);
      this.config.quota = patch.quota;
    }
    if (patch.relay !== undefined)
      this.config.relay = this.router.relay = patch.relay;
    if (patch.lowPower !== undefined)
      this.config.lowPower = this.router.lowPower = patch.lowPower;
    this.saveConfig();
  }
  localAction(action: string, target: string, value: boolean, reason = "") {
    this.requireIdentity();
    if (!/^[a-f0-9]{64}$/.test(target)) throw new Error("Endereço inválido");
    if (action === "pin") this.store.pin(target, value);
    else if (action === "block" || action === "follow" || action === "save") {
      const key =
        action === "block"
          ? "blocked"
          : action === "follow"
            ? "following"
            : "saved";
      this.config[key] = [
        ...this.config[key].filter((id) => id !== target),
        ...(value ? [target] : []),
      ];
    } else if (action === "report") {
      if (!reason.trim() || reason.length > 500)
        throw new Error("Indique um motivo até 500 caracteres");
      this.config.reports = [
        ...this.config.reports.slice(-199),
        { target, reason, at: Date.now() },
      ];
    } else throw new Error("Acção desconhecida");
    this.saveConfig();
  }
  private validateContent(content: Content) {
    if (
      !content ||
      ![
        "message",
        "post",
        "group",
        "site",
        "comment",
        "reaction",
        "edit",
        "delete",
        "receipt",
        "alert",
      ].includes(content.type)
    )
      throw new Error("Tipo de conteúdo inválido");
    for (const key of [
      "text",
      "title",
      "conversation",
      "target",
      "replyTo",
      "emoji",
    ])
      if (
        content[key] !== undefined &&
        (typeof content[key] !== "string" ||
          String(content[key]).length > (key === "text" ? 12000 : 256))
      )
        throw new Error("Texto demasiado longo ou inválido");
    if (
      content.members &&
      (!Array.isArray(content.members) ||
        content.members.length > 64 ||
        content.members.some((m) => !validateIdentity(m)))
    )
      throw new Error("Membros inválidos");
    if (content.attachments) {
      if (!Array.isArray(content.attachments) || content.attachments.length > 4)
        throw new Error("Máximo de quatro anexos");
      for (const a of content.attachments)
        if (
          !a ||
          typeof a.name !== "string" ||
          a.name.length > 150 ||
          typeof a.mime !== "string" ||
          a.mime.length > 100 ||
          typeof a.data !== "string" ||
          a.data.length > 3_500_000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)
        )
          throw new Error("Anexo inválido ou demasiado grande");
    }
    if (content.type === "site") {
      if (
        !Array.isArray(content.blocks) ||
        content.blocks.length > 24 ||
        !["sand", "forest", "ink"].includes(content.theme ?? "sand")
      )
        throw new Error("Página inválida");
      for (const b of content.blocks)
        if (
          !b ||
          typeof b.id !== "string" ||
          b.id.length > 64 ||
          !["hero", "text", "links", "callout"].includes(b.type) ||
          typeof b.title !== "string" ||
          b.title.length > 120 ||
          typeof b.body !== "string" ||
          b.body.length > 4000 ||
          (b.url &&
            (typeof b.url !== "string" ||
              b.url.length > 2000 ||
              !/^https:\/\//.test(b.url)))
        )
          throw new Error("Bloco declarativo inválido");
    }
    canonical(content);
  }
  publish(
    content: Content,
    recipients: string[] | "public",
    ttlMs?: number,
  ): DisplayObject {
    const identity = this.requireIdentity();
    this.validateContent(content);
    let mutationTarget: Manifest | undefined;
    const cards = [identity.public, ...this.config.contacts];
    const readers =
      recipients === "public"
        ? "public"
        : [...new Set([...recipients, identity.public.id])].map((id) => {
            const card = cards.find((c) => c.id === id);
            if (!card)
              throw new Error("Adicione primeiro o cartão do destinatário");
            if (this.config.blocked.includes(id))
              throw new Error("Contacto bloqueado");
            return card;
          });
    if (content.type === "group" && !content.title?.trim())
      throw new Error("Indique o nome do grupo");
    if (
      ["message", "group", "receipt"].includes(content.type) &&
      readers === "public"
    )
      throw new Error("Conversas exigem destinatários privados");
    if (content.type === "message") {
      if (!content.text?.trim() && !content.attachments?.length)
        throw new Error("Escreva uma mensagem ou junte um anexo");
      if (!content.conversation)
        content = {
          ...content,
          conversation:
            "dm:" +
            hash(
              (readers as PublicIdentity[])
                .map((c) => c.id)
                .sort()
                .join(":"),
            ),
        };
      const group = this.objects().find(
        (o) => o.id === content.conversation && o.kind === "group",
      );
      if (content.conversation!.startsWith("dm:")) {
        if (
          content.conversation !==
          "dm:" +
            hash(
              (readers as PublicIdentity[])
                .map((c) => c.id)
                .sort()
                .join(":"),
            )
        )
          throw new Error("Destinatários não correspondem à conversa");
      } else if (
        !group ||
        !group.content.members?.some((m) => m.id === identity.public.id) ||
        canonical(group.content.members.map((m) => m.id).sort()) !==
          canonical((readers as PublicIdentity[]).map((m) => m.id).sort())
      )
        throw new Error("Grupo ou autorização inválidos");
      content = { ...content, members: readers as PublicIdentity[] };
    }
    if (content.type === "group")
      content = { ...content, members: readers as PublicIdentity[] };
    if (
      ["edit", "delete", "reaction", "comment", "receipt"].includes(
        content.type,
      )
    ) {
      const original = this.store.get(content.target!);
      decryptBundle(original, identity);
      if (!this.objects().some((o) => o.id === content.target))
        throw new Error("Alvo sem autorização semântica");
      if (
        content.type === "receipt" &&
        (original.manifest.kind !== "message" ||
          original.manifest.author.id === identity.public.id)
      )
        throw new Error("Confirmação de leitura inválida");
      if (["edit", "delete"].includes(content.type)) {
        ttlMs = Math.max(1000, original.manifest.expires - Date.now());
        mutationTarget = original.manifest;
      }
      if (
        ["edit", "delete"].includes(content.type) &&
        original.manifest.author.id !== identity.public.id
      )
        throw new Error("Só o autor pode alterar este conteúdo");
      if (
        ["edit", "delete", "receipt", "reaction", "comment"].includes(
          original.manifest.kind,
        )
      )
        throw new Error("Alvo inválido");
      // Follow the original privacy boundary for all related events.
      const targetReaders = original.manifest.publicKey
        ? "public"
        : original.manifest.keys.map((k) => k.reader).sort();
      const requested =
        readers === "public" ? "public" : readers.map((r) => r.id).sort();
      if (canonical(targetReaders) !== canonical(requested))
        throw new Error("A privacidade deve corresponder ao conteúdo original");
    }
    const bundle = createBundle(
      identity,
      content.type,
      content,
      readers,
      ttlMs,
    );
    this.store.put(bundle, ["site", "group"].includes(content.type));
    if (mutationTarget) {
      const next = structuredClone(this.privateState),
        before = next.mutations[mutationTarget.id];
      if (
        !before ||
        bundle.manifest.created > before.created ||
        (bundle.manifest.created === before.created &&
          bundle.manifest.id > before.eventId) ||
        (content.type === "delete" && !before.deleted)
      ) {
        next.mutations[mutationTarget.id] = {
          author: mutationTarget.author.id,
          expires: mutationTarget.expires,
          created: bundle.manifest.created,
          eventId: bundle.manifest.id,
          ...(before?.deleted || content.type === "delete"
            ? { deleted: true }
            : { text: content.text ?? "" }),
        };
        this.persistPrivate(next);
      }
    }
    this.router.broadcast(
      { type: "bundle", bundle },
      content.priority ?? (content.attachments?.length ? "bulk" : "normal"),
    );
    return this.display(bundle)!;
  }
  private validateWire(payload: any) {
    if (!payload || !["bundle", "inventory", "request"].includes(payload.type))
      throw new Error("Protocolo inválido");
    if (payload.type === "bundle") verifyBundle(payload.bundle);
    else if (
      !Array.isArray(payload.ids) ||
      payload.ids.length > 64 ||
      payload.ids.some(
        (id: unknown) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id),
      )
    )
      throw new Error("Inventário inválido");
  }
  private receive(payload: any, route: unknown) {
    try {
      if (payload.type === "bundle") {
        if (this.config.blocked.includes(payload.bundle.manifest.author.id))
          return;
        if (this.store.put(payload.bundle)) {
          this.routes.set(payload.bundle.manifest.id, route);
          if (this.routes.size > 1000)
            this.routes.delete(this.routes.keys().next().value!);
          this.emit("content");
        }
      } else if (payload.type === "inventory") {
        const missing = payload.ids
          .filter(
            (id: string) =>
              !this.store.has(id) &&
              Date.now() - (this.requests.get(id) ?? 0) > 5000,
          )
          .slice(0, 8);
        if (missing.length) {
          for (const id of missing) this.requests.set(id, Date.now());
          this.router.broadcast(
            { type: "request", ids: missing },
            "normal",
            120_000,
            true,
          );
        }
      } else {
        if (!this.config.relay) return;
        for (const id of payload.ids.slice(0, 8))
          if (
            this.store.has(id) &&
            Date.now() - (this.requests.get("serve:" + id) ?? 0) > 1000
          ) {
            this.requests.set("serve:" + id, Date.now());
            const bundle = this.store.get(id, false);
            this.router.broadcast(
              { type: "bundle", bundle },
              bundle.manifest.kind === "alert" ? "sos" : "bulk",
              120_000,
              true,
            );
          }
      }
      if (this.requests.size > 2048) this.requests.clear();
    } catch {
      this.router.counters.rejected++;
    }
  }
  sync() {
    if (!this.router.peers.some((p) => p.connected) || !this.config.relay)
      return;
    const ids = this.store.list().map((m) => m.id);
    if (ids.length) {
      const start =
        (Math.floor(Date.now() / 2200) * 64) %
        Math.max(64, Math.ceil(ids.length / 64) * 64);
      this.router.broadcast(
        { type: "inventory", ids: ids.slice(start, start + 64) },
        "normal",
        120_000,
        true,
      );
    }
  }
  private display(bundle: Bundle): DisplayObject | undefined {
    try {
      const content = decryptBundle(bundle, this.identity) as Content;
      this.validateContent(content);
      if (content.type !== bundle.manifest.kind) return;
      return {
        id: bundle.manifest.id,
        kind: bundle.manifest.kind,
        author: bundle.manifest.author,
        created: bundle.manifest.created,
        expires: bundle.manifest.expires,
        content,
        pinned: this.store.isPinned(bundle.manifest.id),
        readers: bundle.manifest.keys.map((k) => k.reader),
        public: !!bundle.manifest.publicKey,
        route: this.routes.get(bundle.manifest.id),
      };
    } catch {
      return;
    }
  }
  objects(): DisplayObject[] {
    if (!this.identity) return [];
    const all = this.store
      .list()
      .filter((m) => !this.config.blocked.includes(m.author.id))
      .flatMap((m) => {
        try {
          const o = this.display(this.store.get(m.id, false));
          return o ? [o] : [];
        } catch {
          return [];
        }
      });
    const accepted = all.filter((o) => this.authorized(o, all));
    let changed = false;
    const nextPrivate = structuredClone(this.privateState);
    for (const event of accepted)
      if (["edit", "delete"].includes(event.kind)) {
        const original = accepted.find((o) => o.id === event.content.target)!;
        const before = nextPrivate.mutations[original.id];
        if (
          !before ||
          event.created > before.created ||
          (event.created === before.created &&
            event.id > (before.eventId ?? "")) ||
          (event.kind === "delete" && !before.deleted)
        ) {
          nextPrivate.mutations[original.id] = {
            author: original.author.id,
            expires: original.expires,
            created: event.created,
            eventId: event.id,
            ...(before?.deleted || event.kind === "delete"
              ? { deleted: true }
              : { text: event.content.text ?? "" }),
          };
          changed = true;
        }
      }
    for (const [id, m] of Object.entries(nextPrivate.mutations))
      if (m.expires <= Date.now()) {
        delete nextPrivate.mutations[id];
        changed = true;
      }
    if (changed) this.persistPrivate(nextPrivate);
    return accepted.map((o) => {
      const mutation = this.privateState.mutations[o.id];
      return mutation?.author === o.author.id
        ? {
            ...o,
            deleted: mutation.deleted ?? false,
            ...(mutation.text !== undefined
              ? { editedText: mutation.text }
              : {}),
          }
        : o;
    });
  }
  private authorized(o: DisplayObject, all: DisplayObject[]): boolean {
    const readers = [...o.readers].sort();
    if (
      new Set(readers).size !== readers.length ||
      (!o.public && !readers.includes(o.author.id))
    )
      return false;
    if (["message", "group", "receipt"].includes(o.kind) && o.public)
      return false;
    if (["edit", "delete", "reaction", "comment", "receipt"].includes(o.kind)) {
      const original = all.find((a) => a.id === o.content.target);
      if (
        !original ||
        ["edit", "delete", "reaction", "comment", "receipt"].includes(
          original.kind,
        ) ||
        !this.authorized(original, all)
      )
        return false;
      if (
        ["edit", "delete"].includes(o.kind) &&
        original.author.id !== o.author.id
      )
        return false;
      if (
        o.public !== original.public ||
        canonical(readers) !== canonical([...original.readers].sort())
      )
        return false;
      if (!original.public && !original.readers.includes(o.author.id))
        return false;
      if (
        o.kind === "receipt" &&
        (original.kind !== "message" || o.author.id === original.author.id)
      )
        return false;
      return true;
    }
    if (["message", "group"].includes(o.kind)) {
      const ids = o.content.members?.map((m) => m.id).sort();
      if (!ids || canonical(ids) !== canonical(readers)) return false;
      if (o.kind === "group")
        return (
          typeof o.content.title === "string" &&
          o.content.title.trim().length > 0
        );
      if (o.content.conversation?.startsWith("dm:"))
        return o.content.conversation === "dm:" + hash(ids.join(":"));
      const group = all.find(
        (g) => g.id === o.content.conversation && g.kind === "group",
      );
      return (
        !!group &&
        this.authorized(group, all) &&
        canonical(readers) === canonical([...group.readers].sort())
      );
    }
    return true;
  }

  view(id: string) {
    this.store.get(id);
    const object = this.objects().find((o) => o.id === id);
    if (!object) throw new Error("Sem autorização de leitura");
    if (
      object.kind === "message" &&
      this.identity &&
      object.author.id !== this.identity.public.id &&
      !this.receipts.has(id)
    ) {
      for (const card of object.content.members ?? [])
        if (
          card.id !== this.identity.public.id &&
          validateIdentity(card) &&
          !this.config.contacts.some((c) => c.id === card.id)
        )
          this.config.contacts.push(card);
      this.saveConfig();
      this.receipts.add(id);
      const existing = this.objects().some(
        (o) =>
          o.kind === "receipt" &&
          o.content.target === id &&
          o.author.id === this.identity!.public.id,
      );
      if (!existing)
        this.publish(
          { type: "receipt", target: id },
          this.store.get(id).manifest.keys.map((k) => k.reader),
        );
    }
    return object;
  }
  state() {
    return {
      initialized: this.initialized,
      locked: !this.identity,
      identity: this.identity?.public ?? null,
      tcpPort: this.tcpPort,
      peers: this.router.peers,
      counters: this.router.counters,
      storage: this.store.stats(),
      settings: { relay: this.config.relay, lowPower: this.config.lowPower },
      contacts: this.identity ? this.config.contacts : [],
      blocked: this.identity ? this.config.blocked : [],
      following: this.identity ? this.config.following : [],
      saved: this.identity ? this.config.saved : [],
      reports: this.identity ? this.config.reports : [],
      objects: this.objects(),
      siteDraft: this.identity ? (this.privateState.siteDraft ?? null) : null,
      transportError: this.lastTransportError,
      now: Date.now(),
    };
  }
}
