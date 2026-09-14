import { api } from "./api";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MessageCircle,
  Radio,
  Globe2,
  Layers3,
  Plus,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Send,
  ShieldCheck,
  LockKeyhole,
  Search,
  X,
  Sun,
  Moon,
  Settings2,
  Users,
  Paperclip,
  Bookmark,
  Heart,
  Check,
  CheckCheck,
  Pencil,
  Trash2,
  Link,
  GripVertical,
  Eye,
  Download,
  Copy,
  Battery,
  AlertTriangle,
  LogOut,
  MoreHorizontal,
  Reply,
  Menu,
  Wifi,
  Leaf,
  FileText,
  Volume2,
  Video,
  RefreshCw,
} from "lucide-react";
import type { PublicIdentity } from "../../../packages/core/src/index";
import type {
  Content,
  DisplayObject,
  SiteBlock,
  Attachment,
} from "../../node/src/node";
import "./style.css";
import { VoiceRecorder } from "./media";
import { CollectionManager } from "./collections";
import {
  usePrivateMessageNotifications,
  NotificationSettings,
} from "./notifications";
import type { Collection } from "../../node/src/social";
import type { OutboxItem } from "../../node/src/outbox";
import { DeliveryBadge, OutboxPanel } from "./outbox";
import { CommandPalette, type Command } from "./commands";
import { useAppearance } from "./appearance";
import "./liquid-glass.css";
import { GroupManager, groupStatus, useGroupWorkspace } from "./groups";

type State = {
  capabilities?: { autonomous?: boolean; dynamicGroups?: boolean };
  nativeRuntime?: string;
  initialized: boolean;
  locked: boolean;
  identity: PublicIdentity | null;
  tcpPort: number;
  peers: {
    id: string;
    medium: string;
    address: string;
    connected: boolean;
    sent: number;
    received: number;
    queued: number;
  }[];
  counters: Record<string, number>;
  storage: { count: number; bytes: number; quota: number; pinned: number };
  settings: { relay: boolean; lowPower: boolean };
  contacts: PublicIdentity[];
  blocked: string[];
  following: string[];
  saved: string[];
  reports: unknown[];
  collections: Collection[];
  followedPostIds: string[];
  siteDraft: { blocks: SiteBlock[]; theme: string; savedAt: number } | null;
  objects: DisplayObject[];
  outbox?: OutboxItem[];
  history: {
    hasMore: boolean;
    nextBefore: string | null;
    total: number;
    availableIds: string[];
  };
  transportError: string;
  now: number;
};
type Page = "messages" | "feed" | "site" | "network" | "saved" | "settings";

const short = (s: string) => s.slice(0, 8) + "…" + s.slice(-4);
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;
const date = (t: number) =>
  new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={"avatar " + (small ? "small" : "")} aria-hidden="true">
      {name
        .split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
function Logo() {
  return (
    <span className="brand">
      <span className="brandmark">
        <i />
        <i />
        <i />
      </span>
      relayloom
    </span>
  );
}
function Empty({
  icon: Icon = MessageCircle,
  title,
  text,
  children,
}: {
  icon?: typeof MessageCircle;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <Icon size={32} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      const target = before?.isConnected
        ? before
        : (document.querySelector<HTMLElement>(
            'button[aria-label="Estado dos envios"]',
          ) ?? document.querySelector<HTMLElement>("#main"));
      target?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" onClick={close} aria-label="Fechar">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [state, setState] = useState<State>(),
    [page, setPage] = useState<Page>("messages"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false),
    [dark, setDark] = useState(
      localStorage.getItem("relayloom-theme") === "dark",
    ),
    [modal, setModal] = useState(""),
    [selection, setSelection] = useState(""),
    [search, setSearch] = useState(""),
    [text, setText] = useState(""),
    [reply, setReply] = useState<DisplayObject>(),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [viewSite, setViewSite] = useState<DisplayObject>(),
    [mobileMenu, setMobileMenu] = useState(false);
  const [messageTTL, setMessageTTL] = useState(30 * 86400_000);
  const [groupManager, setGroupManager] = useState(false);
  const [reviewedEpochs, setReviewedEpochs] = useState<Record<string, string>>(
    {},
  );
  const groupWorkspace = useGroupWorkspace(
    state && !state.locked && state.capabilities?.dynamicGroups !== false
      ? (state.identity?.id ?? null)
      : null,
    selection,
    groupManager,
    api,
  );
  const openGroups = () =>
    state?.capabilities?.dynamicGroups === false
      ? setModal("group")
      : setGroupManager(true);
  const selectedAuthority = groupWorkspace.groups.find(
    (g) => g.id === selection,
  );
  const groupSnapshot =
    selectedAuthority?.head?.id === groupWorkspace.snapshotHead
      ? groupWorkspace.snapshot
      : null;
  const groupCanSend =
    !selectedAuthority ||
    (selectedAuthority.status === "active" &&
      !!groupSnapshot &&
      groupSnapshot.members.length >= 2 &&
      groupSnapshot.members.some((m) => m.id === state?.identity?.id) &&
      reviewedEpochs[selection] === selectedAuthority.head?.id);
  useEffect(() => {
    if (
      selectedAuthority?.status === "active" &&
      groupSnapshot &&
      !reviewedEpochs[selection]
    )
      setReviewedEpochs((current) => ({
        ...current,
        [selection]: selectedAuthority.head!.id,
      }));
  }, [selection, selectedAuthority?.head?.id, groupSnapshot]);
  const [uncertainOperation, setUncertainOperation] = useState("");
  const pendingSend = useRef<
    Record<string, { signature: string; operationId: string }>
  >({});
  const [blocks, setBlocks] = useState<SiteBlock[]>([
      {
        id: "hero",
        type: "hero",
        title: "Um lugar para estar perto.",
        body: "Bem-vindo ao meu pequeno espaço na rede.",
      },
      {
        id: "about",
        type: "text",
        title: "Sobre mim",
        body: "As histórias, as pessoas e os lugares que nos ligam.",
      },
    ]),
    [theme, setTheme] = useState("sand"),
    [preview, setPreview] = useState(false),
    [drag, setDrag] = useState<number>();
  const loadedSite = useRef(""),
    viewed = useRef(new Set<string>()),
    drafts = useRef<
      Record<
        string,
        { text: string; attachments: Attachment[]; reply?: DisplayObject }
      >
    >({}),
    messageScroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const [largeText, setLargeText] = useState(
      localStorage.getItem("relayloom-large-text") === "true",
    ),
    [highContrast, setHighContrast] = useState(
      localStorage.getItem("relayloom-high-contrast") === "true",
    );
  const { glass, setGlass } = useAppearance(
    state?.settings.lowPower ?? false,
    highContrast,
  );
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [messageToFocus, setMessageToFocus] = useState("");
  useEffect(() => {
    setCommandsOpen(false);
    setGroupManager(false);
    setReviewedEpochs({});
    setMessageToFocus("");
  }, [state?.locked, state?.identity?.id]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k" &&
        state &&
        !state.locked &&
        !modal &&
        !groupManager &&
        !viewSite
      ) {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [state?.locked, state?.identity?.id, modal, viewSite, groupManager]);
  useEffect(() => {
    if (!messageToFocus || state?.locked) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`message-${messageToFocus}`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "center" });
      setMessageToFocus("");
    });
    return () => cancelAnimationFrame(frame);
  }, [messageToFocus, selection, page, state?.locked]);
  useEffect(() => {
    document.documentElement.dataset.readability = largeText
      ? "large"
      : "normal";
    document.documentElement.dataset.contrast = highContrast
      ? "high"
      : "normal";
    localStorage.setItem("relayloom-large-text", String(largeText));
    localStorage.setItem("relayloom-high-contrast", String(highContrast));
  }, [largeText, highContrast]);
  const [feedMode, setFeedMode] = useState("all"),
    [selectedCollection, setSelectedCollection] = useState("");
  const activeSelection = useRef(selection);
  activeSelection.current = selection;
  function chooseConversation(id: string) {
    activeSelection.current = id;
    drafts.current[selection] = { text, attachments, reply };
    const draft = drafts.current[id];
    setText(draft?.text ?? "");
    setAttachments(draft?.attachments ?? []);
    setReply(draft?.reply);
    nearBottom.current = true;
    setNewMessages(false);
    setSelection(id);
  }
  const refreshInFlight = useRef(0);
  const requestSequence = useRef(0),
    privacyGeneration = useRef(0),
    historyOwner = useRef<string | null>(null),
    loadedHistory = useRef(new Map<string, DisplayObject>()),
    olderCursor = useRef<
      { hasMore: boolean; nextBefore: string | null } | undefined
    >(undefined);
  async function refresh() {
    refreshInFlight.current++;
    const sequence = ++requestSequence.current,
      generation = privacyGeneration.current;
    try {
      const snapshot: State = await api("state");
      if (
        sequence !== requestSequence.current ||
        generation !== privacyGeneration.current
      )
        return;
      const owner = snapshot.identity?.id ?? null;
      if (snapshot.locked || owner !== historyOwner.current) {
        loadedHistory.current.clear();
        olderCursor.current = undefined;
        historyOwner.current = owner;
      }
      const available = new Set(
        snapshot.history?.availableIds ?? snapshot.objects.map((o) => o.id),
      );
      for (const id of loadedHistory.current.keys())
        if (!available.has(id)) loadedHistory.current.delete(id);
      for (const object of snapshot.objects)
        loadedHistory.current.set(object.id, object);
      // Preserve already observed author mutations in older loaded history between pages.
      for (const event of snapshot.objects)
        if (["delete", "edit"].includes(event.kind)) {
          const original = loadedHistory.current.get(
            event.content.target ?? "",
          );
          if (original?.author.id === event.author.id)
            loadedHistory.current.set(original.id, {
              ...original,
              ...(event.kind === "delete"
                ? { deleted: true }
                : { editedText: event.content.text }),
            });
        }
      setState({
        ...snapshot,
        objects: [...loadedHistory.current.values()].sort(
          (a, b) => a.created - b.created || a.id.localeCompare(b.id),
        ),
        history: { ...snapshot.history, ...(olderCursor.current ?? {}) },
      });
      setOffline(false);
    } catch (e) {
      if (
        sequence !== requestSequence.current ||
        generation !== privacyGeneration.current
      )
        return;
      setOffline(true);
      setError((e as Error).message);
    } finally {
      refreshInFlight.current--;
    }
  }
  async function loadHistory() {
    if (!state?.history.nextBefore) return;
    const generation = privacyGeneration.current;
    await run(async () => {
      const page = await api("history", { before: state.history.nextBefore });
      if (generation !== privacyGeneration.current) return;
      for (const object of page.objects)
        loadedHistory.current.set(object.id, object);
      olderCursor.current = {
        hasMore: page.history.hasMore,
        nextBefore: page.history.nextBefore,
      };
    });
  }
  async function lockIdentity() {
    privacyGeneration.current++;
    requestSequence.current++;
    loadedHistory.current.clear();
    olderCursor.current = undefined;
    historyOwner.current = null;
    drafts.current = {};
    pendingSend.current = {};
    setUncertainOperation("");
    viewed.current.clear();
    setText("");
    setAttachments([]);
    setReply(undefined);
    setGroupManager(false);
    setReviewedEpochs({});
    setViewSite(undefined);
    setModal("");
    setCommandsOpen(false);
    setMessageToFocus("");
    setSelection("");
    setState((current) =>
      current
        ? {
            ...current,
            locked: true,
            identity: null,
            objects: [],
            contacts: [],
            collections: [],
            reports: [],
            outbox: [],
          }
        : current,
    );
    await run(() => api("lock", {}));
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!refreshInFlight.current) void refresh();
    }, 2000);
    const changed = () => {
      privacyGeneration.current++;
      requestSequence.current++;
      void refresh();
    };
    window.addEventListener("hashchange", changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("relayloom-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function run<T>(action: () => Promise<T>, success = "") {
    requestSequence.current++;
    setBusy(true);
    setError("");
    try {
      const r = await action();
      await refresh();
      if (success) setNotice(success);
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const me = state?.identity,
    objects = state?.objects ?? [],
    contacts = state?.contacts ?? [];
  const notifications = usePrivateMessageNotifications({
    identityId: me?.id ?? null,
    messages: objects,
    knownIds: state?.history?.availableIds,
    locked: !state || state.locked,
  });
  const eventsFor = (id: string, kind: string) =>
    objects.filter((o) => o.kind === kind && o.content.target === id);
  const legacyReadCount = (object: DisplayObject) =>
    new Set(
      eventsFor(object.id, "receipt")
        .filter(
          (event) =>
            event.author.id !== object.author.id &&
            object.readers.includes(event.author.id),
        )
        .map((event) => event.author.id),
    ).size;
  const legacyReadLabel = (object: DisplayObject) => {
    const count = legacyReadCount(object),
      total = object.readers.filter((id) => id !== object.author.id).length;
    return !total
      ? "Guardada localmente"
      : count === total
        ? "Lida"
        : count
          ? `Lida por ${count} de ${total}`
          : "Em espera";
  };
  const deleted = (id: string) =>
    objects.find((o) => o.id === id)?.deleted ||
    eventsFor(id, "delete").length > 0;
  const renderedText = (o: DisplayObject) =>
    o.editedText ??
    eventsFor(o.id, "edit").at(-1)?.content.text ??
    o.content.text;
  const messages = objects.filter((o) => o.kind === "message");
  const groups = objects.filter((o) => o.kind === "group");
  const conversationIds = [
    ...new Set([
      ...messages.map((o) => o.content.conversation!),
      ...groups.map((o) => o.id),
      ...groupWorkspace.groups.map((g) => g.id),
    ]),
  ];
  const allConversations = conversationIds
    .map((id) => {
      const ms = messages.filter((m) => m.content.conversation === id),
        group = groups.find((g) => g.id === id),
        authority = groupWorkspace.groups.find((g) => g.id === id),
        members =
          authority && id === selection
            ? (groupSnapshot?.members ?? [])
            : (group?.content.members ?? ms[0]?.content.members ?? []);
      return {
        id,
        group,
        authority,
        members,
        name:
          authority?.title ??
          (authority ? `Grupo de ${authority.creator.name}` : undefined) ??
          group?.content.title ??
          members
            .filter((m) => m.id !== me?.id)
            .map((m) => m.name)
            .join(", "),
        last: ms.at(-1),
      };
    })
    .sort((a, b) => (b.last?.created ?? 0) - (a.last?.created ?? 0));
  const conversations = allConversations.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      messages.some(
        (m) =>
          m.content.conversation === c.id &&
          (renderedText(m) ?? "").toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const selected = allConversations.find((c) => c.id === selection);
  const activeContact = selection.startsWith("contact:")
    ? contacts.find((c) => c.id === selection.slice(8))
    : undefined;
  const members =
    selected?.members ?? (activeContact && me ? [me, activeContact] : []);
  const activeMessages = messages.filter(
    (m) =>
      m.content.conversation === selection &&
      (!search ||
        (renderedText(m) ?? "").toLowerCase().includes(search.toLowerCase()) ||
        selected?.name?.toLowerCase().includes(search.toLowerCase())),
  );
  useEffect(() => {
    if (page === "messages")
      for (const m of activeMessages)
        if (m.author.id !== me?.id && !viewed.current.has(m.id)) {
          viewed.current.add(m.id);
          void api("view", { id: m.id }).catch(() =>
            viewed.current.delete(m.id),
          );
        }
  }, [selection, page, objects.length]);
  useEffect(() => {
    if (state?.siteDraft && loadedSite.current !== me?.id) {
      loadedSite.current = me!.id;
      setBlocks(state.siteDraft.blocks);
      setTheme(state.siteDraft.theme);
      return;
    }
    const latest = objects
      .filter((o) => o.kind === "site" && o.author.id === me?.id)
      .at(-1);
    if (latest && loadedSite.current !== me?.id) {
      loadedSite.current = me!.id;
      setBlocks(latest.content.blocks ?? []);
      setTheme(latest.content.theme ?? "sand");
    }
  }, [me?.id, objects.length]);
  useEffect(() => {
    if (nearBottom.current) {
      messageScroll.current?.scrollTo({
        top: messageScroll.current.scrollHeight,
      });
    } else setNewMessages(true);
  }, [selection, page, activeMessages.length]);
  async function publish(content: Content, recipients: string[] | "public") {
    const target = content.target
      ? objects.find((o) => o.id === content.target)
      : undefined;
    if (
      target?.content.groupEpoch &&
      target.content.conversation &&
      ["edit", "delete", "reaction", "comment"].includes(content.type)
    ) {
      const historical = content.type === "delete";
      const current = groupWorkspace.groups.find(
        (g) => g.id === target.content.conversation,
      );
      if (
        !historical &&
        (!current ||
          current.status !== "active" ||
          current.id !== selection ||
          !groupSnapshot ||
          groupWorkspace.snapshotHead !== current.head?.id)
      )
        throw new Error(
          "Revê a versão e os membros actuais do grupo antes de alterar a mensagem.",
        );
      content = {
        ...content,
        conversation: target.content.conversation,
        targetEpoch: target.content.groupEpoch,
        groupAudience: historical ? "historical" : "target",
        ...(!historical ? { groupEpoch: current!.head!.id } : {}),
      };
      recipients = historical
        ? target.readers
        : groupSnapshot!.members
            .filter((m) => target.readers.includes(m.id))
            .map((m) => m.id);
    }
    return api("publish", { content, recipients });
  }
  const targetReaders = (o: DisplayObject): string[] | "public" =>
    o.public ? "public" : o.readers;
  async function copy(value: string, message: string) {
    await run(() => navigator.clipboard.writeText(value), message);
  }
  async function toggleCollection(
    id: string,
    objectId: string,
    checked: boolean,
  ) {
    const previous = state!.collections
      .find((c) => c.id === id)!
      .objectIds.includes(objectId);
    const update = (value: boolean) =>
      setState((current) =>
        current
          ? {
              ...current,
              collections: current.collections.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      objectIds: [
                        ...c.objectIds.filter((item) => item !== objectId),
                        ...(value ? [objectId] : []),
                      ],
                    }
                  : c,
              ),
            }
          : current,
      );
    update(checked);
    const result = await run(() =>
      api("collection", { action: checked ? "add" : "remove", id, objectId }),
    );
    if (!result) update(previous);
  }
  const selectedCollectionItems = state?.collections.find(
    (c) => c.id === selectedCollection,
  )?.objectIds;
  const visiblePost = (o: DisplayObject) =>
    ["post", "alert"].includes(o.kind) &&
    !deleted(o.id) &&
    (page === "saved"
      ? (selectedCollectionItems ?? state!.saved).includes(o.id)
      : feedMode === "all" || state!.followedPostIds.includes(o.id));
  const changePage = (p: Page) => {
    if (p === "messages") nearBottom.current = true;
    setPage(p);
    setMobileMenu(false);
    setSearch("");
  };
  const action = (
    action: string,
    target: string,
    value = true,
    reason?: string,
  ) => api("action", { action, target, value, reason });
  function reaction(o: DisplayObject) {
    void run(() =>
      publish(
        {
          type: "reaction",
          target: o.id,
          emoji: "heart",
          value: !eventsFor(o.id, "reaction")
            .filter((r) => r.author.id === me?.id)
            .at(-1)?.content.value,
        },
        targetReaders(o),
      ),
    );
  }
  const hearts = (o: DisplayObject) =>
    [
      ...new Map(
        eventsFor(o.id, "reaction").map((r) => [r.author.id, r]),
      ).values(),
    ].filter((r) => r.content.value).length;
  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!groupCanSend) {
      setError("Revê os membros e a versão do grupo antes de enviar.");
      return;
    }
    const selectionAtSend = selection,
      generation = privacyGeneration.current,
      ownerAtSend = me?.id;
    const content: Content = {
        type: "message",
        text,
        ...(selected ? { conversation: selection } : {}),
        ...(selectedAuthority
          ? {
              groupEpoch: selectedAuthority.head!.id,
              groupAudience: reply ? ("target" as const) : ("epoch" as const),
              ...(reply ? { targetEpoch: reply.content.groupEpoch } : {}),
            }
          : {}),
        ...(reply ? { replyTo: reply.id } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
      recipients = members
        .filter(
          (m) => !selectedAuthority || !reply || reply.readers.includes(m.id),
        )
        .map((m) => m.id);
    const encoded = new TextEncoder().encode(
      JSON.stringify({ content, recipients, ttlMs: messageTTL }),
    );
    const signature = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (generation !== privacyGeneration.current) return;
    const operationId =
      pendingSend.current[selectionAtSend]?.signature === signature
        ? pendingSend.current[selectionAtSend].operationId
        : crypto.randomUUID();
    if (pendingSend.current[selectionAtSend]?.signature === signature) {
      const latest = await run(() => api("state"));
      if (!latest || generation !== privacyGeneration.current) return;
      if (latest.locked || latest.identity?.id !== ownerAtSend) {
        setError(
          "Desbloqueia a mesma identidade para verificar o envio anterior.",
        );
        return;
      }
      if (
        !(latest.outbox ?? []).some(
          (entry: OutboxItem) => entry.operationId === operationId,
        )
      ) {
        setUncertainOperation(operationId);
        setError(
          "A resposta anterior perdeu-se e este envio não está no registo conservado. Verifica a conversa antes de preparar um novo envio, para evitar duplicados.",
        );
        return;
      }
    }
    pendingSend.current[selectionAtSend] = { signature, operationId };
    const r = await run(() =>
      api("send", { operationId, content, recipients, ttlMs: messageTTL }),
    );
    if (r && !r.accepted) {
      setError(
        "Este envio não está disponível. Consulta o estado antes de preparar uma nova mensagem.",
      );
      return;
    }
    if (r && generation === privacyGeneration.current) {
      delete drafts.current[selectionAtSend];
      delete pendingSend.current[selectionAtSend];
      setUncertainOperation("");
      if (activeSelection.current !== selectionAtSend) return;
      setSelection(r.outbox.conversation);
      nearBottom.current = true;
      setText("");
      setAttachments([]);
      setReply(undefined);
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const selectedFiles = Array.from(files),
      target = activeSelection.current;
    await run(async () => {
      if (selectedFiles.length + attachments.length > 4)
        throw new Error("Máximo de quatro anexos");
      const next: Attachment[] = [];
      for (const f of selectedFiles) {
        if (f.size > 2_000_000)
          throw new Error("Neste marco, cada anexo pode ter até 2 MB");
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1]);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        next.push({
          name: f.name,
          mime: f.type || "application/octet-stream",
          data,
        });
      }
      if (activeSelection.current !== target)
        throw new Error(
          "A conversa mudou. Seleccione novamente os anexos para este destinatário.",
        );
      setAttachments((current) => {
        if (current.length + next.length > 4) {
          queueMicrotask(() => setError("Máximo de quatro anexos"));
          return current;
        }
        return [...current, ...next];
      });
    });
  }
  function reorder(from: number, to: number) {
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks],
      [block] = next.splice(from, 1);
    next.splice(to, 0, block);
    setBlocks(next);
    setNotice("Ordem dos blocos alterada");
  }
  const nav = [
    { id: "messages", label: "Conversas", icon: MessageCircle },
    { id: "feed", label: "A praça", icon: Globe2 },
    { id: "site", label: "A minha página", icon: Layers3 },
    { id: "saved", label: "Guardados", icon: Bookmark },
    { id: "network", label: "A rede", icon: Radio },
  ] as const;
  const commands: Command[] = commandsOpen
    ? [
        ...nav.map((item) => ({
          id: `page-${item.id}`,
          label: item.label,
          detail: "Ir para esta área",
          icon: item.icon,
          run: () => changePage(item.id),
        })),
        {
          id: "settings",
          label: "Definições",
          detail: "Aparência, privacidade e recursos",
          icon: Settings2,
          run: () => changePage("settings"),
        },
        {
          id: "new",
          label: "Nova conversa",
          detail: "Escolher uma pessoa",
          icon: Plus,
          run: () => setModal("conversation"),
        },
        {
          id: "post",
          label: "Partilhar algo",
          detail: "Escrever uma publicação na praça",
          icon: Pencil,
          run: () => setModal("post"),
        },
        {
          id: "peer",
          label: "Ligar um par",
          detail: "Adicionar uma ligação à rede",
          icon: Radio,
          run: () => setModal("peer"),
        },
        {
          id: "outbox",
          label: "Estado dos envios",
          detail: "Entrega, tentativas e prazo de validade",
          icon: Send,
          run: () => setModal("outbox"),
        },
        {
          id: "theme",
          label: dark ? "Usar tema claro" : "Usar tema escuro",
          detail: "Aparência deste dispositivo",
          icon: dark ? Sun : Moon,
          run: () => setDark(!dark),
        },
        {
          id: "lock",
          label: "Bloquear identidade",
          detail: "Fechar o acesso ao teu espaço privado",
          icon: LockKeyhole,
          run: () => {
            void lockIdentity();
          },
        },
        ...allConversations.map((c) => ({
          id: `conversation-${c.id}`,
          label: c.name || "Conversa",
          detail: "Abrir conversa",
          icon: MessageCircle,
          run: () => {
            changePage("messages");
            chooseConversation(c.id);
          },
        })),
        ...messages
          .filter((m) => !deleted(m.id) && renderedText(m))
          .slice()
          .reverse()
          .map((m) => ({
            id: m.id,
            label: renderedText(m)!,
            icon: MessageCircle,
            detail: `${allConversations.find((c) => c.id === m.content.conversation)?.name || "Conversa"} · ${m.author.name}`,
            run: () => {
              changePage("messages");
              chooseConversation(m.content.conversation!);
              nearBottom.current = false;
              setMessageToFocus(m.id);
            },
          })),
      ]
    : [];
  if (!state || state.locked)
    return (
      <div className="welcome">
        <header>
          <Logo />
          <button
            className="icon"
            onClick={() => setDark(!dark)}
            aria-label="Alternar tema"
          >
            {dark ? <Sun /> : <Moon />}
          </button>
        </header>
        <main className="welcome-grid">
          <section>
            <div className="eyebrow">
              <span className="live-dot" /> LIGAÇÕES QUE FICAM
            </div>
            <h1>
              Sempre
              <br />
              entre <em>nós.</em>
            </h1>
            <p className="welcome-copy">
              As tuas conversas. A tua comunidade.
              <br />
              Uma rede feita pelas pessoas que a usam.
            </p>
            <div className="weave" aria-hidden="true">
              <div />
              <div />
              <div />
              <span />
              <span />
              <span />
            </div>
            <div className="welcome-note">
              <ShieldCheck size={20} />
              <p>
                Identidade local. Conteúdo cifrado.
                <br />
                <strong>Sem um servidor central obrigatório.</strong>
              </p>
            </div>
          </section>
          <section className="onboarding">
            <div className="eyebrow">O TEU PONTO DE PARTIDA</div>
            <h2>
              {state?.initialized
                ? "Bom ter-te de volta."
                : "Um novo fio na rede."}
            </h2>
            <p>
              {state?.initialized
                ? "Desbloqueia a tua identidade neste dispositivo."
                : "Cria uma identidade. A tua chave fica num cofre cifrado neste dispositivo."}
            </p>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {!state ? (
              <button className="primary" onClick={refresh}>
                <RefreshCw size={18} /> Voltar a ligar ao nó
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(() =>
                    api(state.initialized ? "unlock" : "setup", {
                      name: data.get("name"),
                      password: data.get("password"),
                      ...(data.get("recovery")
                        ? { recovery: data.get("recovery") }
                        : {}),
                    }),
                  );
                }}
              >
                {!state.initialized && (
                  <label>
                    Como te chamas?
                    <input
                      name="name"
                      placeholder="O teu nome"
                      maxLength={64}
                      required
                      autoComplete="nickname"
                    />
                  </label>
                )}
                <label>
                  Frase-passe
                  <input
                    name="password"
                    type="password"
                    placeholder="Pelo menos 12 caracteres"
                    minLength={12}
                    maxLength={1024}
                    required
                    autoComplete={
                      state.initialized ? "current-password" : "new-password"
                    }
                  />
                </label>
                {!state.initialized && (
                  <details>
                    <summary>Já tenho uma cópia de recuperação</summary>
                    <label>
                      Cofre exportado
                      <textarea
                        name="recovery"
                        placeholder="Cola aqui o conteúdo do teu cofre cifrado"
                      />
                    </label>
                  </details>
                )}
                <button className="primary full" disabled={busy}>
                  {busy
                    ? "A proteger a identidade…"
                    : state.initialized
                      ? "Entrar na minha rede"
                      : "Criar identidade"}
                  <ArrowUpRight size={19} />
                </button>
                <div className="small-note">
                  <LockKeyhole size={14} /> A frase-passe não sai deste nó
                  local.
                </div>
              </form>
            )}
            <div className="experimental">
              <AlertTriangle size={17} />
              <p>
                Rede experimental. Não é infraestrutura de emergência validada
                nem substitui os serviços de emergência.
              </p>
            </div>
          </section>
        </main>
        <footer>
          RELAYLOOM <span>Conversar é criar caminhos.</span>
          <span>Construído para aproximar.</span>
        </footer>
      </div>
    );
  return (
    <div
      className={`shell ${page !== "messages" || !selection ? "has-mobile-dock" : ""}`}
    >
      <a className="skip" href="#main">
        Saltar para o conteúdo
      </a>
      <aside
        id="primary-sidebar"
        className={"sidebar " + (mobileMenu ? "mobile-open" : "")}
      >
        <Logo />
        <div className="workspace">
          <span className="workspace-icon">L</span>
          <div>
            <strong>O meu espaço</strong>
            <span>Rede pessoal · Experimental</span>
          </div>
        </div>
        <div className="nav-label">O QUE NOS LIGA</div>
        <nav aria-label="Navegação principal">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              aria-label={n.label}
              aria-description={
                n.id === "messages" && conversations.length > 0
                  ? `${conversations.length} conversas`
                  : undefined
              }
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => changePage(n.id)}
            >
              <n.icon size={20} />
              {n.label}
              {n.id === "messages" && conversations.length > 0 && (
                <span className="count">{conversations.length}</span>
              )}
              {page === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="relay-card">
          <div className="relay-orbit">
            <Radio size={24} />
            <span />
          </div>
          <strong>
            {state.settings.relay
              ? "Também és um caminho."
              : "A retransmissão está em pausa."}
          </strong>
          <p>
            {state.settings.relay
              ? "Este dispositivo ajuda conteúdos a chegar mais longe quando existe uma ligação."
              : "Podes voltar a ajudar a rede nas definições."}
          </p>
          <button onClick={() => changePage("network")}>
            Conhecer a minha rede <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className="settings-nav"
            onClick={() => changePage("settings")}
          >
            <Settings2 size={19} /> Definições
          </button>
          <div className="account">
            <Avatar name={me!.name} small />
            <div>
              <strong>{me!.name}</strong>
              <span>Identidade local</span>
            </div>
            <button
              className="icon"
              aria-label="Bloquear identidade"
              onClick={() => void lockIdentity()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon mobile-only"
            aria-label="Abrir navegação"
            aria-controls="primary-sidebar"
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            O meu espaço <span>/</span>
            <strong>
              {nav.find((n) => n.id === page)?.label ?? "Definições"}
            </strong>
          </div>
          <button
            className="command-trigger"
            onClick={() => setCommandsOpen(true)}
            aria-label="Pesquisar e navegar"
            aria-keyshortcuts="Control+k Meta+k"
          >
            <Search size={17} />
            <span>Pesquisar</span>
            <kbd>⌘ / Ctrl K</kbd>
          </button>
          {page === "messages" && selection && (
            <button
              className="icon compact-outbox"
              aria-label="Estado dos envios"
              onClick={() => setModal("outbox")}
            >
              <Send size={18} />
            </button>
          )}
          <div className={"connection-badge " + (offline ? "warning" : "")}>
            <span className="live-dot" />
            {offline
              ? "Nó desligado"
              : state.peers.some((p) => p.connected)
                ? `${state.peers.filter((p) => p.connected).length} ${state.peers.filter((p) => p.connected).length === 1 ? "ligação activa" : "ligações activas"}`
                : "À espera de pares"}
          </div>
          <button
            className="icon"
            onClick={() => setDark(!dark)}
            aria-label="Alternar tema"
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div className="error banner" role="alert">
              {error}
              <button
                className="icon"
                aria-label="Fechar erro"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {offline && (
            <div className="offline-banner" role="status">
              O nó local está indisponível. A vista fica em memória; volta a
              arrancar o nó para continuar.
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "messages"
                  ? "CADA CONVERSA, UMA LIGAÇÃO"
                  : page === "feed"
                    ? "HISTÓRIAS QUE NOS APROXIMAM"
                    : page === "site"
                      ? "UM CANTO DA REDE, TODO TEU"
                      : page === "network"
                        ? "FEITA POR PESSOAS, ENTRE PESSOAS"
                        : page === "saved"
                          ? "O QUE QUERES TER POR PERTO"
                          : "AO TEU RITMO"}
              </div>
              <h1>
                {page === "messages"
                  ? "As tuas conversas"
                  : page === "feed"
                    ? "Encontramo-nos na praça."
                    : page === "site"
                      ? "A tua presença, à tua maneira."
                      : page === "network"
                        ? "Somos o caminho."
                        : page === "saved"
                          ? "Vale a pena guardar."
                          : "Cuida do teu espaço."}
                <span className="title-dot">.</span>
              </h1>
            </div>
            {page === "messages" && (
              <div className="conversation-head-actions">
                <button
                  className="secondary"
                  aria-label={
                    state.capabilities?.dynamicGroups === false
                      ? "Grupos de leitores fixos"
                      : "Grupos e convites"
                  }
                  aria-describedby={
                    groupWorkspace.noticeCount > 0
                      ? "group-notice-count"
                      : undefined
                  }
                  onClick={openGroups}
                >
                  <Users size={16} />{" "}
                  {state.capabilities?.dynamicGroups === false
                    ? "Leitores fixos"
                    : "Grupos e convites"}
                  {groupWorkspace.noticeCount > 0 && (
                    <span
                      className="count"
                      id="group-notice-count"
                      aria-label={`${groupWorkspace.noticeCount} avisos de grupo por verificar`}
                    >
                      {groupWorkspace.noticeCount}
                    </span>
                  )}
                </button>
                <button
                  className="secondary"
                  aria-label="Estado dos envios"
                  onClick={() => setModal("outbox")}
                >
                  <Send size={16} /> Envios
                  {(state.outbox ?? []).filter((o) =>
                    ["pending", "blocked"].includes(o.status),
                  ).length > 0 && (
                    <span className="count">
                      {
                        (state.outbox ?? []).filter((o) =>
                          ["pending", "blocked"].includes(o.status),
                        ).length
                      }
                    </span>
                  )}
                </button>
                <button
                  className="primary"
                  onClick={() => setModal("conversation")}
                >
                  <Plus size={18} /> Nova conversa
                </button>
              </div>
            )}
            {page === "feed" && (
              <button className="primary" onClick={() => setModal("post")}>
                <Plus size={18} /> Partilhar algo
              </button>
            )}
            {page === "network" && (
              <button className="primary" onClick={() => setModal("peer")}>
                <Plus size={18} /> Ligar um par
              </button>
            )}
          </div>
          {["messages", "feed", "saved"].includes(page) &&
            state.history?.hasMore && (
              <div className="history-control">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={loadHistory}
                >
                  <ArrowUp size={16} /> Carregar histórico anterior
                </button>
                <span>
                  {objects.length} de {state.history.total} objectos autorizados
                  disponíveis
                </span>
              </div>
            )}
          {page === "messages" && (
            <div
              className={
                "messenger " +
                (selected || activeContact ? "has-selection" : "")
              }
            >
              <section
                className="conversation-list"
                aria-label="Lista de conversas"
              >
                <div className="list-top">
                  <h2>
                    Mensagens <span>{conversations.length}</span>
                  </h2>
                  <button
                    className="icon"
                    aria-label="Adicionar contacto"
                    onClick={() => setModal("contact")}
                  >
                    <Plus size={19} />
                  </button>
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Pesquisar conversas e mensagens"
                    placeholder="Procurar uma ligação…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="list-tabs">
                  <span className="active">Todas</span>
                  <button onClick={openGroups}>
                    Novo grupo <Users size={14} />
                  </button>
                </div>
                {conversations.map((c) => (
                  <button
                    className={
                      "conversation " + (selection === c.id ? "selected" : "")
                    }
                    key={c.id}
                    onClick={() => {
                      chooseConversation(c.id);
                    }}
                  >
                    <Avatar name={c.name || "Grupo"} />
                    <div>
                      <div className="conversation-title">
                        <strong>{c.name}</strong>
                        <time>{c.last ? date(c.last.created) : ""}</time>
                      </div>
                      <p>
                        {c.last
                          ? deleted(c.last.id)
                            ? "Mensagem eliminada"
                            : renderedText(c.last) || "Anexo"
                          : c.authority
                            ? groupStatus[c.authority.status]
                            : "O início de uma conversa"}
                      </p>
                    </div>
                  </button>
                ))}
                {!conversations.length && (
                  <div className="list-empty">
                    <MessageCircle size={25} />
                    <p>
                      Uma boa conversa começa
                      <br />
                      com um primeiro olá.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setModal("contact")}
                    >
                      Adicionar um contacto
                    </button>
                  </div>
                )}
                <div className="list-footer">
                  <LockKeyhole size={13} /> As conversas são cifradas entre
                  identidades.
                </div>
              </section>
              <section className="chat" aria-label="Conversa activa">
                {selected || activeContact ? (
                  <>
                    <header className="chat-header">
                      <button
                        className="icon mobile-only"
                        onClick={() => setSelection("")}
                        aria-label="Voltar às conversas"
                      >
                        <ArrowDown />
                      </button>
                      <Avatar
                        name={selected?.name || activeContact!.name}
                        small
                      />
                      <div>
                        <h2>{selected?.name || activeContact?.name}</h2>
                        <span>
                          <ShieldCheck size={13} /> Assinaturas verificadas ·{" "}
                          {selectedAuthority?.head?.body.members.length ??
                            members.length}{" "}
                          participantes
                        </span>
                      </div>
                      <button
                        className="icon"
                        aria-label="Ver participantes"
                        onClick={() =>
                          selectedAuthority
                            ? setGroupManager(true)
                            : setModal("participants")
                        }
                      >
                        <Users size={20} />
                      </button>
                    </header>
                    {selectedAuthority && !groupCanSend && (
                      <div className="group-epoch-review" role="status">
                        <span>
                          {selectedAuthority.status !== "active"
                            ? groupStatus[selectedAuthority.status]
                            : (groupSnapshot?.members.length ?? 0) < 2
                              ? "Convida alguém e aguarda a entrada para começar a conversar."
                              : "A versão do grupo mudou. O teu rascunho foi preservado; revê os destinatários."}
                        </span>
                        <button onClick={openGroups}>Rever grupo</button>
                      </div>
                    )}
                    <div
                      className="message-scroll"
                      role="log"
                      aria-label="Histórico de mensagens"
                      aria-live="polite"
                      aria-relevant="additions text"
                      ref={messageScroll}
                      onScroll={(e) => {
                        const el = e.currentTarget;
                        nearBottom.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                        if (nearBottom.current) setNewMessages(false);
                      }}
                    >
                      <div className="day-divider">
                        <span>Uma ligação só vossa</span>
                      </div>
                      <div className="privacy-note">
                        <LockKeyhole size={14} /> Só as identidades
                        destinatárias podem ler. Os pares podem retransmitir o
                        conteúdo cifrado.
                      </div>
                      {activeMessages.map((o) => (
                        <article
                          key={o.id}
                          id={`message-${o.id}`}
                          tabIndex={-1}
                          className={
                            "message " + (o.author.id === me?.id ? "own" : "")
                          }
                        >
                          <div className="bubble">
                            {members.length > 2 && (
                              <strong className="sender-name">
                                {o.author.name}
                              </strong>
                            )}
                            {o.content.replyTo && (
                              <blockquote>
                                {renderedText(
                                  objects.find(
                                    (x) => x.id === o.content.replyTo,
                                  ) ?? o,
                                )}
                              </blockquote>
                            )}
                            <p>
                              {deleted(o.id) ? (
                                <em>Mensagem eliminada pelo autor</em>
                              ) : (
                                renderedText(o)
                              )}
                            </p>
                            {!deleted(o.id) &&
                              o.content.attachments?.map((a, i) => (
                                <AttachmentView
                                  key={i}
                                  attachment={a}
                                  contentId={o.id}
                                  index={i}
                                />
                              ))}
                            <div className="message-meta">
                              {eventsFor(o.id, "edit").length > 0 && (
                                <span>editada</span>
                              )}
                              <time>{date(o.created)}</time>
                              {o.author.id === me?.id &&
                              state.outbox?.some(
                                (entry) => entry.id === o.id,
                              ) ? (
                                <DeliveryBadge
                                  item={state.outbox.find(
                                    (entry) => entry.id === o.id,
                                  )!}
                                  onOpen={() => setModal("outbox:" + o.id)}
                                />
                              ) : (
                                o.author.id === me?.id && (
                                  <span
                                    title={
                                      "Confirmações verificadas no histórico carregado: " +
                                      legacyReadCount(o)
                                    }
                                  >
                                    {legacyReadCount(o) ? (
                                      <>
                                        <CheckCheck size={15} />{" "}
                                        {legacyReadLabel(o)}
                                      </>
                                    ) : (
                                      <>
                                        <Check size={15} /> {legacyReadLabel(o)}
                                      </>
                                    )}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                          {!deleted(o.id) && (
                            <div className="message-actions">
                              <button
                                aria-label={`Responder a ${o.author.name}`}
                                onClick={() => setReply(o)}
                              >
                                <Reply size={14} />
                              </button>
                              <button
                                aria-label="Reagir à mensagem"
                                aria-pressed={
                                  !!eventsFor(o.id, "reaction")
                                    .filter((r) => r.author.id === me?.id)
                                    .at(-1)?.content.value
                                }
                                onClick={() => reaction(o)}
                              >
                                <Heart size={14} />
                                {hearts(o) || ""}
                              </button>
                              {o.author.id === me?.id && (
                                <>
                                  <button
                                    aria-label="Editar mensagem"
                                    onClick={() => setModal("edit:" + o.id)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    aria-label="Eliminar mensagem"
                                    onClick={() =>
                                      run(() =>
                                        publish(
                                          { type: "delete", target: o.id },
                                          targetReaders(o),
                                        ),
                                      )
                                    }
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                    {newMessages && (
                      <button
                        className="new-messages"
                        onClick={() => {
                          messageScroll.current?.scrollTo({
                            top: messageScroll.current.scrollHeight,
                          });
                          nearBottom.current = true;
                          setNewMessages(false);
                        }}
                      >
                        Novas mensagens <ArrowDown size={14} />
                      </button>
                    )}
                    <form className="composer" onSubmit={submitMessage}>
                      {uncertainOperation &&
                        pendingSend.current[selection]?.operationId ===
                          uncertainOperation && (
                          <div className="reply-preview">
                            <AlertTriangle size={16} />
                            <span>Envio anterior por confirmar.</span>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                delete pendingSend.current[selection];
                                setUncertainOperation("");
                                setError("");
                              }}
                            >
                              Preparar um novo envio
                            </button>
                          </div>
                        )}
                      {reply && (
                        <div className="reply-preview">
                          <Reply size={16} />
                          {renderedText(reply)}
                          <button
                            type="button"
                            className="icon"
                            aria-label="Cancelar resposta"
                            onClick={() => setReply(undefined)}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      )}
                      {attachments.length > 0 && (
                        <div className="attachment-preview">
                          {attachments.map((a) => (
                            <span key={a.name}>
                              <Paperclip size={13} />
                              {a.name}
                            </span>
                          ))}
                          <button
                            type="button"
                            onClick={() => setAttachments([])}
                          >
                            Remover
                          </button>
                        </div>
                      )}
                      <div className="composer-row">
                        <label
                          className="icon file-picker"
                          aria-label="Anexar ficheiro"
                        >
                          <Paperclip size={21} />
                          <input
                            type="file"
                            disabled={busy}
                            multiple
                            aria-label="Anexar ficheiro"
                            onChange={(e) => {
                              void addFiles(e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <textarea
                          aria-label="Escrever mensagem"
                          placeholder="Escreve uma mensagem…"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          maxLength={12000}
                          disabled={busy}
                          rows={1}
                        />
                        <VoiceRecorder
                          key={selection}
                          disabled={busy || offline || attachments.length >= 4}
                          onAttachment={(attachment) => {
                            setAttachments((current) => {
                              if (current.length >= 4) {
                                setError("Máximo de quatro anexos");
                                return current;
                              }
                              return [...current, attachment];
                            });
                          }}
                        />
                        <button
                          className="send"
                          aria-label="Enviar mensagem"
                          disabled={
                            busy ||
                            offline ||
                            !groupCanSend ||
                            (!text.trim() && !attachments.length)
                          }
                        >
                          <Send size={20} />
                        </button>
                      </div>
                      <div className="composer-hint">
                        <span>
                          <ShieldCheck size={12} /> Cifrada e assinada no teu
                          dispositivo
                        </span>
                        <label className="expiry-choice">
                          Prazo
                          <select
                            aria-label="Prazo da mensagem"
                            value={messageTTL}
                            onChange={(e) =>
                              setMessageTTL(Number(e.target.value))
                            }
                          >
                            <option value={30 * 86400_000}>30 dias</option>
                            <option value={7 * 86400_000}>7 dias</option>
                            <option value={86400_000}>1 dia</option>
                            <option value={3600_000}>1 hora</option>
                            <option value={300_000}>5 minutos</option>
                          </select>
                        </label>
                      </div>
                    </form>
                  </>
                ) : (
                  <Empty
                    title="Perto, mesmo à distância."
                    text="Escolhe uma conversa ou cria uma nova ligação. As mensagens ficam guardadas no teu dispositivo e seguem quando houver caminho."
                  >
                    <button
                      className="primary"
                      onClick={() => setModal("conversation")}
                    >
                      <Plus size={17} /> Começar uma conversa
                    </button>
                    <div className="empty-footer">
                      <span>
                        <LockKeyhole size={14} /> Privada por natureza
                      </span>
                      <span>
                        <Radio size={14} /> Entre pares
                      </span>
                    </div>
                  </Empty>
                )}
              </section>
            </div>
          )}
          {(page === "feed" || page === "saved") && (
            <div className="social-layout">
              <section>
                <div className="section-tabs">
                  {page === "feed" ? (
                    <div className="social-tabs">
                      <button
                        className={feedMode === "all" ? "active" : ""}
                        aria-pressed={feedMode === "all"}
                        onClick={() => setFeedMode("all")}
                      >
                        Na minha rede
                      </button>
                      <button
                        className={feedMode === "following" ? "active" : ""}
                        aria-pressed={feedMode === "following"}
                        onClick={() => setFeedMode("following")}
                      >
                        A seguir
                      </button>
                    </div>
                  ) : (
                    <span className="active">
                      {state.collections.find(
                        (c) => c.id === selectedCollection,
                      )?.title ?? "Todos os guardados"}
                    </span>
                  )}
                  {page === "feed" && (
                    <span>
                      {objects.filter((o) => o.kind === "post").length}{" "}
                      {objects.filter((o) => o.kind === "post").length === 1
                        ? "publicação em cache"
                        : "publicações em cache"}
                    </span>
                  )}
                </div>
                <div className="social-toolbar">
                  <button
                    className="import-content"
                    onClick={() => setModal("retrieve")}
                  >
                    <Download size={15} /> Obter conteúdo por endereço
                  </button>
                </div>
                {objects
                  .filter(visiblePost)
                  .reverse()
                  .map((o) => (
                    <article className="post" key={o.id}>
                      <header>
                        <Avatar name={o.author.name} small />
                        <div>
                          <strong>{o.author.name}</strong>
                          <span>
                            {date(o.created)} ·{" "}
                            {o.public ? "Público" : "Destinatários escolhidos"}
                          </span>
                        </div>
                        <ShieldCheck
                          size={17}
                          aria-label="Assinatura verificada"
                        />
                      </header>
                      {o.kind === "alert" && (
                        <div className="alert-provenance">
                          <AlertTriangle size={18} /> Alerta assinado ·
                          Exactidão não confirmada
                        </div>
                      )}
                      <p className="post-text">{renderedText(o)}</p>
                      {o.content.attachments?.map((a, i) => (
                        <AttachmentView
                          key={i}
                          attachment={a}
                          contentId={o.id}
                          index={i}
                        />
                      ))}
                      <div className="post-actions">
                        <button
                          onClick={() => reaction(o)}
                          aria-label="Gostar da publicação"
                          aria-pressed={
                            !!eventsFor(o.id, "reaction")
                              .filter((r) => r.author.id === me?.id)
                              .at(-1)?.content.value
                          }
                        >
                          <Heart size={18} />
                          {hearts(o) || "Gosto"}
                        </button>
                        <button onClick={() => setModal("comment:" + o.id)}>
                          <MessageCircle size={18} />
                          {eventsFor(o.id, "comment").length || "Comentar"}
                        </button>
                        <button
                          aria-label="Guardar publicação"
                          aria-pressed={state.saved.includes(o.id)}
                          className={state.saved.includes(o.id) ? "chosen" : ""}
                          onClick={() =>
                            run(() =>
                              action("save", o.id, !state.saved.includes(o.id)),
                            )
                          }
                        >
                          <Bookmark size={18} />
                        </button>
                        <button
                          aria-label="Mais opções da publicação"
                          onClick={() => setModal("post-options:" + o.id)}
                        >
                          <MoreHorizontal size={19} />
                        </button>
                      </div>
                      {eventsFor(o.id, "comment").map((c) => (
                        <p className="comment" key={c.id}>
                          <strong>{c.author.name}</strong> {c.content.text}
                        </p>
                      ))}
                    </article>
                  ))}
                {!objects.some(visiblePost) && (
                  <div className="card">
                    <Empty
                      icon={page === "saved" ? Bookmark : Globe2}
                      title={
                        page === "saved"
                          ? "Histórias para voltar a ler."
                          : "Há espaço para a tua história."
                      }
                      text={
                        page === "saved"
                          ? "Guarda publicações na praça para as reunir aqui. Fixar no armazenamento protege-as da limpeza automática."
                          : "Partilha a primeira publicação com os teus pares. A praça mostra conteúdo realmente recebido e verificado."
                      }
                    >
                      <button
                        className="primary"
                        onClick={() =>
                          page === "saved"
                            ? changePage("feed")
                            : setModal("post")
                        }
                      >
                        {page === "saved"
                          ? "Visitar a praça"
                          : "Escrever uma publicação"}
                        <ArrowUpRight size={16} />
                      </button>
                    </Empty>
                  </div>
                )}
              </section>
              <aside className="social-aside">
                {page === "saved" && (
                  <div className="card compact">
                    <CollectionManager
                      collections={state.collections}
                      selected={selectedCollection}
                      onSelect={setSelectedCollection}
                      onCommand={(command) =>
                        run(
                          () => api("collection", command),
                          "Colecção privada actualizada",
                        )
                      }
                    />
                  </div>
                )}
                <div className="editorial-card">
                  <div className="eyebrow">UMA REDE COM RAÍZES</div>
                  <h2>
                    O que lemos
                    <br />
                    pode ir <em>mais longe.</em>
                  </h2>
                  <p>
                    O conteúdo recebido fica disponível neste nó para outros
                    pares. A assinatura continua sempre a ser do autor.
                  </p>
                  <span>
                    <Leaf size={16} /> Partilhar o caminho, preservar a autoria.
                  </span>
                </div>
                <div className="card compact">
                  <h3>Pessoas e páginas</h3>
                  {contacts.length ? (
                    contacts.map((c) => (
                      <div className="person" key={c.id}>
                        <Avatar name={c.name} small />
                        <div>
                          <strong>{c.name}</strong>
                          <button
                            className="text-button"
                            onClick={() =>
                              run(() =>
                                action(
                                  "follow",
                                  c.id,
                                  !state.following.includes(c.id),
                                ),
                              )
                            }
                          >
                            {state.following.includes(c.id)
                              ? "A seguir"
                              : "Seguir localmente"}
                          </button>
                        </div>
                        {objects.some(
                          (o) => o.kind === "site" && o.author.id === c.id,
                        ) && (
                          <button
                            className="icon"
                            aria-label={`Ver página de ${c.name}`}
                            onClick={() => {
                              setViewSite(
                                objects
                                  .filter(
                                    (o) =>
                                      o.kind === "site" && o.author.id === c.id,
                                  )
                                  .at(-1),
                              );
                            }}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted">Os teus contactos aparecem aqui.</p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setModal("contact")}
                  >
                    <Plus size={14} /> Adicionar contacto
                  </button>
                </div>
              </aside>
            </div>
          )}
          {page === "site" && (
            <>
              <div className="builder-toolbar">
                <div className="segmented">
                  <button
                    className={!preview ? "active" : ""}
                    aria-pressed={!preview}
                    onClick={() => setPreview(false)}
                  >
                    <Pencil size={16} /> Editar
                  </button>
                  <button
                    className={preview ? "active" : ""}
                    aria-pressed={preview}
                    onClick={() => setPreview(true)}
                  >
                    <Eye size={16} /> Pré-visualizar
                  </button>
                </div>
                <label className="inline-label">
                  Paleta
                  <select
                    aria-label="Paleta da página"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="sand">Areia</option>
                    <option value="forest">Floresta</option>
                    <option value="ink">Tinta</option>
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api("site-draft", { blocks, theme }),
                      "Rascunho cifrado guardado neste dispositivo",
                    )
                  }
                >
                  <Bookmark size={16} /> Guardar rascunho
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => publish({ type: "site", blocks, theme }, "public"),
                      "Página assinada e publicada no armazenamento P2P",
                    )
                  }
                >
                  <Globe2 size={17} /> Publicar página
                </button>
              </div>
              <div className={"builder " + (preview ? "preview-only" : "")}>
                {!preview && (
                  <aside className="block-panel">
                    <div className="eyebrow">A TUA COMPOSIÇÃO</div>
                    <h3>
                      Pequenos blocos.
                      <br />
                      Um mundo teu.
                    </h3>
                    <p>
                      Arrasta para reordenar ou usa as setas. As setas também
                      funcionam por toque e teclado.
                    </p>
                    <div className="block-palette">
                      {(["hero", "text", "links", "callout"] as const).map(
                        (type) => (
                          <button
                            key={type}
                            disabled={blocks.length >= 24}
                            onClick={() =>
                              setBlocks([
                                ...blocks,
                                {
                                  id: crypto.randomUUID(),
                                  type,
                                  title:
                                    type === "hero"
                                      ? "Olá, mundo."
                                      : type === "text"
                                        ? "Uma nova história"
                                        : type === "links"
                                          ? "Vamos explorar"
                                          : "Fica por perto",
                                  body: "",
                                  ...(type === "links"
                                    ? { url: "https://example.org" }
                                    : {}),
                                },
                              ])
                            }
                          >
                            <Plus size={17} />
                            {
                              {
                                hero: "Capa",
                                text: "Texto",
                                links: "Ligação",
                                callout: "Destaque",
                              }[type]
                            }
                          </button>
                        ),
                      )}
                    </div>
                    <div className="safe-note">
                      <ShieldCheck size={20} />
                      <span>
                        Constrói a tua página com texto, destaques e ligações.
                        Escolhe os blocos e dá-lhes a tua voz.
                      </span>
                    </div>
                  </aside>
                )}
                <div className={"site-canvas " + theme}>
                  <div className="site-masthead">
                    <strong>{me!.name}</strong>
                    <span>Página pessoal · RelayLoom</span>
                  </div>
                  {blocks.map((block, i) => (
                    <section
                      key={block.id}
                      className={
                        "site-block " +
                        block.type +
                        (!preview ? " editable" : "")
                      }
                      draggable={!preview}
                      onDragStart={() => setDrag(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag !== undefined) reorder(drag, i);
                        setDrag(undefined);
                      }}
                    >
                      {!preview && (
                        <div className="block-controls">
                          <span>
                            <GripVertical size={15} />
                            {
                              {
                                hero: "Capa",
                                text: "Texto",
                                links: "Ligação",
                                callout: "Destaque",
                              }[block.type]
                            }
                          </span>
                          <button
                            aria-label={`Mover bloco ${i + 1} para cima`}
                            disabled={i === 0}
                            onClick={() => reorder(i, i - 1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            aria-label={`Mover bloco ${i + 1} para baixo`}
                            disabled={i === blocks.length - 1}
                            onClick={() => reorder(i, i + 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            aria-label={`Eliminar bloco ${i + 1}`}
                            onClick={() =>
                              setBlocks(blocks.filter((_, at) => at !== i))
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                      {preview ? (
                        <>
                          <h2>{block.title}</h2>
                          <p>{block.body}</p>
                          {block.url && (
                            <a
                              href={block.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Explorar <ArrowUpRight size={17} />
                            </a>
                          )}
                        </>
                      ) : (
                        <>
                          <input
                            aria-label={`Título do bloco ${i + 1}`}
                            value={block.title}
                            maxLength={120}
                            onChange={(e) =>
                              setBlocks(
                                blocks.map((b, at) =>
                                  at === i
                                    ? { ...b, title: e.target.value }
                                    : b,
                                ),
                              )
                            }
                          />
                          <textarea
                            aria-label={`Texto do bloco ${i + 1}`}
                            value={block.body}
                            placeholder="Escreve algo que seja teu…"
                            maxLength={4000}
                            onChange={(e) =>
                              setBlocks(
                                blocks.map((b, at) =>
                                  at === i ? { ...b, body: e.target.value } : b,
                                ),
                              )
                            }
                          />
                          {block.type === "links" && (
                            <input
                              aria-label={`Endereço do bloco ${i + 1}`}
                              type="url"
                              value={block.url ?? ""}
                              onChange={(e) =>
                                setBlocks(
                                  blocks.map((b, at) =>
                                    at === i
                                      ? { ...b, url: e.target.value }
                                      : b,
                                  ),
                                )
                              }
                            />
                          )}
                        </>
                      )}
                    </section>
                  ))}
                  <div className="site-footer">
                    Um pequeno espaço numa rede de pessoas.{" "}
                    <span>feito com relayloom</span>
                  </div>
                </div>
              </div>
            </>
          )}
          {page === "network" && (
            <>
              <div className="network-hero">
                <div>
                  <div className="eyebrow">
                    <span className="live-dot" />{" "}
                    {state.settings.relay
                      ? "RETRANSMISSÃO ACTIVA"
                      : "RETRANSMISSÃO EM PAUSA"}
                  </div>
                  <h2>
                    Cada pessoa é<br />
                    uma nova possibilidade.
                  </h2>
                  <p>
                    As ligações abaixo são reais. A disponibilidade depende de
                    um caminho entre pares e de dispositivos que mantenham o
                    conteúdo.
                  </p>
                  <button
                    className="light-button"
                    onClick={() => setModal("peer")}
                  >
                    Abrir um novo caminho <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="network-emblem" aria-hidden="true">
                  <Radio size={52} />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="metrics">
                <div>
                  <span>Pares ligados</span>
                  <strong>
                    {state.peers.filter((p) => p.connected).length}
                    <Radio size={22} />
                  </strong>
                  <small>Ligações entre dispositivos</small>
                </div>
                <div>
                  <span>Conteúdos neste nó</span>
                  <strong>
                    {state.storage.count}
                    <Layers3 size={22} />
                  </strong>
                  <small>{state.storage.pinned} fixados no armazenamento</small>
                </div>
                <div>
                  <span>Armazenamento utilizado</span>
                  <strong>
                    {bytes(state.storage.bytes)}
                    <Leaf size={22} />
                  </strong>
                  <small>
                    de {bytes(state.storage.quota)} disponíveis para a rede
                  </small>
                </div>
                <div>
                  <span>Pacotes encaminhados</span>
                  <strong>
                    {state.counters.forwarded}
                    <ArrowUpRight size={22} />
                  </strong>
                  <small>Contagem real desde o arranque</small>
                </div>
              </div>
              <section className="card">
                <div className="section-heading">
                  <h2>Ligações deste dispositivo</h2>
                  <span className="pill">
                    {state.capabilities?.autonomous
                      ? "Neste navegador"
                      : `TCP local: ${state.tcpPort}`}
                  </span>
                </div>
                {state.peers.length ? (
                  <div className="peer-table">
                    <div className="peer-row head">
                      <span>Par / endereço</span>
                      <span>Meio</span>
                      <span>Transferência</span>
                      <span>Estado</span>
                    </div>
                    {state.peers.map((p) => (
                      <div className="peer-row" key={p.id}>
                        <strong>{p.address}</strong>
                        <span>
                          {p.medium === "serial"
                            ? "Série"
                            : p.medium === "webrtc"
                              ? "WebRTC"
                              : p.medium === "websocket"
                                ? "WebSocket"
                                : p.medium === "reticulum" ? "Reticulum" : "TCP / IP"}
                        </span>
                        <span>
                          ↑ {bytes(p.sent)} · ↓ {bytes(p.received)}
                        </span>
                        <span className="pill">
                          {p.connected ? "Ligado" : "Desligado"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={Radio}
                    title="O próximo caminho começa aqui."
                    text="Troca o endereço de transporte com outro nó ou liga um dispositivo série suportado. Não há descoberta nem servidor de arranque obrigatório."
                  />
                )}
                {state.transportError && (
                  <p role="alert" className="error">
                    {state.transportError}
                  </p>
                )}
              </section>
              <div className="network-foot">
                <ShieldCheck />
                <p>
                  <strong>
                    Uma rede experimental, com limites transparentes.
                  </strong>
                  <br />
                  TCP usa sockets reais. Série pode usar dispositivos ou PTYs de
                  teste. BLE, Wi-Fi Direct e rádios físicos ainda não foram
                  validados. Não substitui serviços de emergência.
                </p>
                <button
                  className="danger-outline"
                  onClick={() => setModal("alert")}
                >
                  <AlertTriangle size={17} /> Criar alerta prioritário
                </button>
              </div>
            </>
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <section className="card">
                <h2>Identidade & confiança</h2>
                <div className="identity-card">
                  <Avatar name={me!.name} />
                  <div>
                    <h3>{me!.name}</h3>
                    <code>{short(me!.id)}</code>
                  </div>
                  <ShieldCheck />
                </div>
                <p className="muted">
                  Verifica a impressão da identidade por um canal de confiança.
                  Uma assinatura válida não comprova a identidade civil.
                </p>
                <label>
                  Cartão público da identidade
                  <textarea
                    readOnly
                    value={JSON.stringify(me)}
                    aria-label="Cartão público da identidade"
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() =>
                    copy(JSON.stringify(me), "Cartão público copiado")
                  }
                >
                  <Copy size={17} /> Copiar cartão público
                </button>
                <button
                  className="secondary"
                  onClick={() => setModal("export")}
                >
                  <Download size={17} /> Exportar cofre de recuperação
                </button>
                <p className="small-note">
                  Guarda o cofre e a frase-passe separadamente. Sem ambos, a
                  identidade não é recuperável.
                </p>
              </section>
              <section className="card">
                <h2>Dar à rede, ao teu ritmo</h2>
                <label className="toggle-row">
                  <div>
                    <strong>Retransmitir conteúdo</strong>
                    <span>
                      Permitir que este nó ajude a rede quando está a correr.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={state.settings.relay}
                    onChange={(e) =>
                      run(() => api("settings", { relay: e.target.checked }))
                    }
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Modo de baixo consumo</strong>
                    <span>
                      Adiar transferências em massa; manter mensagens
                      prioritárias.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={state.settings.lowPower}
                    onChange={(e) =>
                      run(() => api("settings", { lowPower: e.target.checked }))
                    }
                  />
                </label>
                <label>
                  Orçamento de armazenamento
                  <select
                    value={state.storage.quota}
                    onChange={(e) =>
                      run(() =>
                        api("settings", { quota: Number(e.target.value) }),
                      )
                    }
                  >
                    {[16, 32, 64, 128, 256, 512].map((m) => (
                      <option value={m * 1024 ** 2} key={m}>
                        {m} MB
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  Conteúdos não fixados podem ser removidos quando a quota é
                  atingida. Eliminar não apaga cópias noutros pares.
                </p>
                <NotificationSettings controller={notifications} />
                <h3>Leitura e acessibilidade</h3>
                <label className="toggle-row">
                  <div>
                    <strong>Liquid Glass</strong>
                    <span>
                      Transparência e profundidade. Efeitos reduzidos em baixo
                      consumo, alto contraste ou por preferência do sistema.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={glass}
                    onChange={(e) => setGlass(e.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Texto maior</strong>
                    <span>
                      Aumentar mensagens, controlos e informação importante.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={largeText}
                    onChange={(e) => setLargeText(e.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Alto contraste</strong>
                    <span>Reforçar texto, contornos e estados de ligação.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={highContrast}
                    onChange={(e) => setHighContrast(e.target.checked)}
                  />
                </label>
                <h3>Contactos</h3>
                {contacts.map((c) => (
                  <div className="person" key={c.id}>
                    <Avatar name={c.name} small />
                    <div>
                      <strong>{c.name}</strong>
                      <code>{short(c.id)}</code>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(() =>
                          action("block", c.id, !state.blocked.includes(c.id)),
                        )
                      }
                    >
                      {state.blocked.includes(c.id)
                        ? "Desbloquear"
                        : "Bloquear"}
                    </button>
                  </div>
                ))}
                <button
                  className="text-button"
                  onClick={() => setModal("contact")}
                >
                  <Plus size={15} /> Adicionar contacto
                </button>
                <h3>Denúncias locais</h3>
                <p className="muted">
                  {state.reports.length} registos neste dispositivo. Não são
                  enviados a um serviço central.
                </p>
              </section>
            </div>
          )}
          <footer className="app-footer">
            <span>
              <span className="live-dot" /> Guardado perto de ti. Partilhado
              entre nós.
            </span>
            <span>RELAYLOOM / EXPERIMENTAL</span>
          </footer>
        </main>
      </div>
      {(page !== "messages" || !selection) && !mobileMenu && (
        <nav className="mobile-dock" aria-label="Navegação rápida">
          {nav.map((item) => (
            <button
              key={item.id}
              aria-label={`Ir para ${item.label}`}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => changePage(item.id)}
            >
              <item.icon size={21} />
              <span>
                {item.id === "site"
                  ? "Página"
                  : item.id === "messages"
                    ? "Conversas"
                    : item.id === "feed"
                      ? "Praça"
                      : item.id === "network"
                        ? "Rede"
                        : "Guardados"}
              </span>
            </button>
          ))}
        </nav>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {commandsOpen && (
        <CommandPalette
          commands={commands}
          close={() => setCommandsOpen(false)}
        />
      )}
      {me && !state.locked && state.capabilities?.dynamicGroups !== false && (
        <GroupManager
          key={me.id}
          open={groupManager}
          workspace={groupWorkspace}
          identity={me}
          contacts={contacts}
          blocked={state.blocked}
          selected={selection}
          select={(id) => chooseConversation(id)}
          api={api}
          close={() => setGroupManager(false)}
          reviewAudience={() => {
            if (selectedAuthority?.head && groupSnapshot)
              setReviewedEpochs((current) => ({
                ...current,
                [selection]: selectedAuthority.head!.id,
              }));
          }}
          legacy={() => {
            setGroupManager(false);
            setModal("group");
          }}
        />
      )}
      {modal && (
        <Modal
          title={
            modal === "outbox" || modal.startsWith("outbox:")
              ? "O caminho dos teus envios"
              : modal === "contact"
                ? "Adicionar uma pessoa"
                : modal === "retrieve"
                  ? "Obter conteúdo da rede"
                  : modal === "conversation"
                    ? "Começar uma conversa"
                    : modal === "group"
                      ? "Criar um grupo privado"
                      : modal === "peer"
                        ? "Ligar um par"
                        : modal === "export"
                          ? "Guardar a tua identidade"
                          : modal === "participants"
                            ? "Quem está nesta conversa"
                            : modal === "alert"
                              ? "Criar alerta prioritário"
                              : modal.startsWith("edit:")
                                ? "Editar o teu conteúdo"
                                : modal.startsWith("comment:")
                                  ? "Juntar à conversa"
                                  : modal.startsWith("post-options:")
                                    ? "Opções da publicação"
                                    : "Uma história para partilhar"
          }
          close={() => {
            setModal("");
            setError("");
          }}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {(modal === "outbox" || modal.startsWith("outbox:")) && (
            <OutboxPanel
              entries={state.outbox ?? []}
              contacts={state.contacts}
              now={state.now}
              busy={busy}
              focusId={modal.startsWith("outbox:") ? modal.slice(7) : undefined}
              onRetry={(operationId) =>
                run(() => api("outbox-retry", { operationId }))
              }
            />
          )}
          {modal === "retrieve" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                  const result = await api("retrieve", { id: data.get("id") });
                  if (result.status === "unreadable")
                    throw new Error(
                      "Conteúdo disponível, mas esta identidade não tem autorização para o ler.",
                    );
                  setModal("");
                  return result;
                }, "Pedido efectuado. O conteúdo aparece quando um seeder o entregar e a leitura for autorizada.");
              }}
            >
              <p>
                Um endereço identifica o conteúdo. Não concede uma chave de
                leitura nem transfere a autoria.
              </p>
              <label>
                Endereço do conteúdo
                <input
                  name="id"
                  required
                  pattern="[a-f0-9]{64}"
                  minLength={64}
                  maxLength={64}
                  placeholder="64 caracteres hexadecimais"
                />
              </label>
              <button className="primary full" disabled={busy}>
                Pedir aos pares
              </button>
            </form>
          )}
          {modal === "contact" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void run(async () => {
                  await api("contact", {
                    contact: JSON.parse(String(d.get("card"))),
                  });
                  setModal("");
                }, "Contacto adicionado e assinatura verificada");
              }}
            >
              <p>
                Troca o cartão público com a outra pessoa. Compara a impressão
                da identidade por um canal de confiança.
              </p>
              <label>
                Cartão público do contacto
                <textarea
                  name="card"
                  rows={5}
                  required
                  placeholder="Cola aqui o cartão JSON da identidade"
                />
              </label>
              <button className="primary full" disabled={busy}>
                <ShieldCheck size={17} /> Verificar e adicionar
              </button>
            </form>
          )}
          {modal === "conversation" && (
            <>
              <p>Escolhe uma pessoa para começar uma conversa cifrada.</p>
              {contacts
                .filter((c) => !state.blocked.includes(c.id))
                .map((c) => (
                  <button
                    className="contact-choice"
                    key={c.id}
                    onClick={() => {
                      const existing = conversations.find(
                        (g) =>
                          !g.group &&
                          g.id.startsWith("dm:") &&
                          g.members.length === 2 &&
                          g.members.some((m) => m.id === c.id),
                      );
                      chooseConversation(existing?.id ?? "contact:" + c.id);
                      setModal("");
                      setPage("messages");
                    }}
                  >
                    <Avatar name={c.name} />
                    <div>
                      <strong>{c.name}</strong>
                      <code>{short(c.id)}</code>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              <button
                className="secondary full"
                onClick={() => setModal("contact")}
              >
                <Plus size={17} /> Adicionar uma pessoa
              </button>
            </>
          )}
          {modal === "group" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void run(async () => {
                  const ids = d.getAll("member").map(String);
                  if (!ids.length)
                    throw new Error("Escolhe pelo menos outra pessoa");
                  const group = await publish(
                    { type: "group", title: String(d.get("title")) },
                    ids,
                  );
                  chooseConversation(group.id);
                  setModal("");
                });
              }}
            >
              <p>
                Cada mensagem é cifrada para os membros escolhidos. A alteração
                de membros ainda não está disponível.
              </p>
              <label>
                Nome do grupo
                <input
                  name="title"
                  required
                  maxLength={80}
                  placeholder="Pessoas por perto"
                />
              </label>
              <fieldset>
                <legend>Participantes</legend>
                {contacts
                  .filter((c) => !state.blocked.includes(c.id))
                  .map((c) => (
                    <label className="check-option" key={c.id}>
                      <input name="member" type="checkbox" value={c.id} />
                      <Avatar name={c.name} small />
                      {c.name}
                    </label>
                  ))}
              </fieldset>
              <button
                className="primary full"
                disabled={busy || !contacts.length}
              >
                <Users size={17} /> Criar grupo
              </button>
            </form>
          )}
          {modal === "participants" && (
            <>
              {members.map((c) => (
                <div className="person" key={c.id}>
                  <Avatar name={c.name} small />
                  <div>
                    <strong>{c.name}</strong>
                    <code>{short(c.id)}</code>
                  </div>
                  {!contacts.some((x) => x.id === c.id) && c.id !== me!.id && (
                    <button
                      className="text-button"
                      onClick={() =>
                        run(
                          () => api("contact", { contact: c }),
                          "Contacto adicionado",
                        )
                      }
                    >
                      Adicionar
                    </button>
                  )}
                </div>
              ))}
              <p className="muted">
                A assinatura valida a identidade criptográfica. Confirma as
                impressões com as pessoas que conheces.
              </p>
            </>
          )}
          {modal === "peer" && !state.capabilities?.autonomous && (
            <>
              <p>
                Liga-te ao endereço TCP que o outro nó partilhou contigo. O
                controlo da aplicação continua apenas neste dispositivo.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void run(async () => {
                    await api("connect", {
                      host: String(d.get("host")),
                      port: Number(d.get("port")),
                    });
                    setModal("");
                  }, "Ligação configurada; a tentar contactar o par");
                }}
              >
                <label>
                  Endereço do par
                  <input
                    name="host"
                    required
                    defaultValue="127.0.0.1"
                    placeholder="192.168.1.20"
                  />
                </label>
                <label>
                  Porta TCP de transporte
                  <input
                    name="port"
                    required
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="Porta indicada pelo outro nó"
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  <Link size={17} /> Ligar por TCP
                </button>
              </form>
              {state.nativeRuntime === "Go" ? (
                <p className="muted">
                  O adaptador série ainda não está disponível neste núcleo
                  nativo. Podes ligar pares por TCP.
                </p>
              ) : (
                <details>
                  <summary>Dispositivo série</summary>
                  <p className="muted">
                    Um dispositivo série compatível ou PTY de teste. Isto não
                    configura nem valida um rádio físico.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      void run(async () => {
                        await api("serial", {
                          path: String(d.get("path")),
                          baud: Number(d.get("baud")),
                        });
                        setModal("");
                      }, "A abrir dispositivo série");
                    }}
                  >
                    <label>
                      Caminho do dispositivo
                      <input name="path" required placeholder="/dev/ttyUSB0" />
                    </label>
                    <label>
                      Velocidade
                      <select name="baud" defaultValue="115200">
                        <option>9600</option>
                        <option>57600</option>
                        <option>115200</option>
                      </select>
                    </label>
                    <button className="secondary full" disabled={busy}>
                      Ligar por série
                    </button>
                  </form>
                </details>
              )}
            </>
          )}
          {["post", "alert"].includes(modal) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const current = modal;
                void run(
                  async () => {
                    const recipients =
                      d.get("privacy") === "contacts"
                        ? contacts
                            .filter((c) => !state.blocked.includes(c.id))
                            .map((c) => c.id)
                        : "public";
                    await publish(
                      {
                        type: current === "alert" ? "alert" : "post",
                        text: String(d.get("text")),
                        ...(current === "alert" ? { priority: "sos" } : {}),
                      },
                      recipients,
                    );
                    setModal("");
                  },
                  current === "alert"
                    ? "Alerta assinado e colocado na rede com prioridade"
                    : "Publicação assinada e guardada",
                );
              }}
            >
              <p>
                {modal === "alert"
                  ? "A assinatura prova a autoria, não a exactidão. Indica o contexto e a hora; não publiques localização pessoal desnecessária."
                  : "O que te apetece partilhar com a tua rede?"}
              </p>
              <label>
                {modal === "alert"
                  ? "Informação do alerta"
                  : "A tua publicação"}
                <textarea
                  name="text"
                  rows={5}
                  required
                  maxLength={12000}
                  placeholder={
                    modal === "alert"
                      ? "O que se passa e quando foi observado?"
                      : "Uma ideia, uma história, um olá…"
                  }
                />
              </label>
              <label>
                Quem pode ler
                <select name="privacy">
                  <option value="public">Público — qualquer leitor</option>
                  <option value="contacts">Os meus contactos actuais</option>
                </select>
              </label>
              <p className="small-note">
                Os leitores podem guardar e semear cópias. A autoria continua a
                ser tua.
              </p>
              <button className="primary full" disabled={busy}>
                <Send size={17} />
                {modal === "alert" ? "Publicar alerta" : "Publicar"}
              </button>
            </form>
          )}
          {(modal.startsWith("comment:") || modal.startsWith("edit:")) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget),
                  target = objects.find((o) => o.id === modal.split(":")[1])!;
                void run(async () => {
                  await publish(
                    {
                      type: modal.startsWith("edit:") ? "edit" : "comment",
                      target: target.id,
                      text: String(d.get("text")),
                    },
                    targetReaders(target),
                  );
                  setModal("");
                }, "Actualização assinada e guardada");
              }}
            >
              <label>
                Texto
                <textarea
                  name="text"
                  required
                  rows={4}
                  maxLength={12000}
                  defaultValue={
                    modal.startsWith("edit:")
                      ? renderedText(
                          objects.find((o) => o.id === modal.split(":")[1])!,
                        )
                      : ""
                  }
                />
              </label>
              <button className="primary full" disabled={busy}>
                Guardar
              </button>
            </form>
          )}
          {modal.startsWith("post-options:") &&
            (() => {
              const o = objects.find((o) => o.id === modal.split(":")[1])!;
              return (
                <div className="option-list">
                  <button
                    onClick={() =>
                      run(
                        () => action("pin", o.id, !o.pinned),
                        o.pinned
                          ? "Conteúdo desafixado"
                          : "Conteúdo fixado no armazenamento",
                      )
                    }
                  >
                    <Bookmark size={18} />
                    {o.pinned
                      ? "Desafixar do armazenamento"
                      : "Fixar no armazenamento"}
                  </button>
                  <div className="collection-memberships">
                    <strong>Guardar numa colecção</strong>
                    {state.collections.length ? (
                      state.collections.map((c) => (
                        <label key={c.id}>
                          <input
                            type="checkbox"
                            checked={c.objectIds.includes(o.id)}
                            disabled={busy}
                            onChange={(e) =>
                              void toggleCollection(
                                c.id,
                                o.id,
                                e.target.checked,
                              )
                            }
                          />
                          {c.title}
                        </label>
                      ))
                    ) : (
                      <button
                        className="text-button"
                        onClick={() => {
                          setModal("");
                          changePage("saved");
                        }}
                      >
                        Criar uma colecção em Guardados
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => copy(o.id, "Endereço do conteúdo copiado")}
                  >
                    <Copy size={18} /> Copiar endereço do conteúdo
                  </button>
                  {o.author.id === me!.id ? (
                    <>
                      <button onClick={() => setModal("edit:" + o.id)}>
                        <Pencil size={18} /> Editar publicação
                      </button>
                      <button
                        onClick={() =>
                          run(async () => {
                            await publish(
                              { type: "delete", target: o.id },
                              targetReaders(o),
                            );
                            setModal("");
                          }, "Eliminação assinada; cópias remotas podem persistir")
                        }
                      >
                        <Trash2 size={18} /> Eliminar publicação
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() =>
                          run(async () => {
                            await action("block", o.author.id);
                            setModal("");
                          }, "Autor bloqueado neste dispositivo")
                        }
                      >
                        <ShieldCheck size={18} /> Bloquear este autor
                      </button>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const d = new FormData(e.currentTarget);
                          void run(async () => {
                            await action(
                              "report",
                              o.id,
                              true,
                              String(d.get("reason")),
                            );
                            setModal("");
                          }, "Denúncia guardada localmente");
                        }}
                      >
                        <label>
                          Motivo da denúncia
                          <textarea name="reason" required maxLength={500} />
                        </label>
                        <button className="secondary full">
                          Registar denúncia local
                        </button>
                      </form>
                    </>
                  )}
                </div>
              );
            })()}
          {modal === "export" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void run(async () => {
                  const { vault } = await api("export", {
                    password: String(d.get("password")),
                  });
                  const blob = URL.createObjectURL(
                    new Blob([vault], { type: "application/json" }),
                  );
                  const link = document.createElement("a");
                  link.href = blob;
                  link.download = `relayloom-${me!.id.slice(0, 8)}.vault.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(blob), 1000);
                  setModal("");
                }, "Exportação do cofre iniciada.");
              }}
            >
              <p>
                A cópia contém as tuas chaves cifradas. Guarda-a num lugar
                seguro e conserva a frase-passe separadamente.
              </p>
              <label>
                Frase-passe para esta cópia
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={1024}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="primary full" disabled={busy}>
                <Download size={17} /> Descarregar cofre cifrado
              </button>
            </form>
          )}
        </Modal>
      )}
      {viewSite && (
        <Modal
          title={`Página de ${viewSite.author.name}`}
          close={() => setViewSite(undefined)}
        >
          <div className={"site-canvas " + viewSite.content.theme}>
            <div className="site-masthead">
              <strong>{viewSite.author.name}</strong>
              <ShieldCheck size={18} />
            </div>
            {viewSite.content.blocks?.map((b) => (
              <section className={"site-block " + b.type} key={b.id}>
                <h2>{b.title}</h2>
                <p>{b.body}</p>
                {b.url && /^https:\/\//.test(b.url) && (
                  <a href={b.url} target="_blank" rel="noopener noreferrer">
                    Explorar <ArrowUpRight size={16} />
                  </a>
                )}
              </section>
            ))}
          </div>
          <p className="small-note">
            Assinatura verificada. Página lida a partir do armazenamento local;
            pode ser servida por este nó mesmo com o autor desligado.
          </p>
        </Modal>
      )}
    </div>
  );
}
const attachmentJobs: Array<() => void> = [];
let activeAttachmentJobs = 0;
function limitedAttachment<T>(action: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeAttachmentJobs++;
      action()
        .then(resolve, reject)
        .finally(() => {
          activeAttachmentJobs--;
          attachmentJobs.shift()?.();
        });
    };
    if (activeAttachmentJobs < 3) start();
    else attachmentJobs.push(start);
  });
}
function AttachmentView({
  attachment: a,
  contentId,
  index,
}: {
  attachment: Attachment;
  contentId: string;
  index: number;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [visible, setVisible] = useState(false),
    [retry, setRetry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let cancelled = false,
      objectUrl = "";
    setError("");
    void limitedAttachment(async () => {
      if (cancelled) return;
      const attachment: Attachment = a.data
        ? a
        : await api("attachment", { id: contentId, index }, controller.signal);
      if (cancelled) return;
      const raw = atob(attachment.data),
        bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      objectUrl = URL.createObjectURL(
        new Blob([bytes], { type: attachment.mime }),
      );
      setUrl(objectUrl);
    }).catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, retry, contentId, index, a.data, a.mime]);
  return (
    <div className="attachment" ref={element}>
      {url ? (
        <>
          {/^image\/(png|jpeg|webp|gif)$/.test(a.mime) && (
            <img src={url} alt={a.name} loading="lazy" />
          )}
          {/^audio\/(ogg|mpeg|webm|wav|mp4)$/.test(a.mime) && (
            <audio src={url} controls aria-label={a.name} />
          )}{" "}
          {/^video\/(mp4|webm|ogg)$/.test(a.mime) && (
            <video src={url} controls preload="metadata" aria-label={a.name} />
          )}
          <a href={url} download={a.name}>
            <FileText size={17} />
            <span>{a.name}</span>
            <Download size={16} />
          </a>
        </>
      ) : (
        <div className="attachment-loading">
          <FileText size={17} />
          <span>
            {a.name}
            {a.size !== undefined ? ` · ${bytes(a.size)}` : ""}
          </span>
          {error ? (
            <button className="text-button" onClick={() => setRetry(retry + 1)}>
              Voltar a carregar
            </button>
          ) : (
            <span role="status">A carregar…</span>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
