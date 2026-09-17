import type { SiteVisitTarget } from "./site/visit";
import type { SiteRevision } from "../../../packages/sites/src/protocol";
import { contextFor, type PublishingSession, type SiteCatalogState } from "./site/publishing";
import { siteAddress } from "../../../packages/sites/src/protocol";
import {
  configureNativePreferences,
  ensureNativePreferences,
  readDevicePreference,
  recordPreference,
  registerPreferenceConsumer,
} from "./device-preferences";
import { WelcomeScreen } from "./welcome";
import { t, getLanguage } from "./i18n/core";
import { LanguageSelector, useLanguage } from "./i18n/selector";
import { WelcomeGuide } from "./onboarding";
import "./onboarding.css";
import { initialSite, type StudioValue } from "./site/model";
import {
  legacySite,
  siteFallback,
  type SiteDraft,
} from "../../../packages/content/src/site";
import { api, usesLocalAPI } from "./api";
import { BrowserPeerPanel } from "./browser/peers";
import { WebInvitation, type WebPeerState } from "./web-invitation";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { RelayParticipation } from "./relay-participation";
import { directConversationId } from "./conversation-id";

if (!usesLocalAPI())
  configureNativePreferences(
    () => api("ui-preferences"),
    (patch) => api("ui-preferences", patch),
  );

const SiteStudio = lazy(() =>
  import("./site/editor").then((m) => ({ default: m.SiteEditor })),
);
const SiteVisit = lazy(() =>
  import("./site/visit").then((m) => ({ default: m.SiteVisit })),
);
type State = {
  capabilities?: { autonomous?: boolean; dynamicGroups?: boolean };
  nativeRuntime?: string;
  webPeer?: WebPeerState;
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
  siteDraft: SiteDraft | null;
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
  new Intl.DateTimeFormat(getLanguage(), {
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
            'button[data-action="outbox"]',
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
        <button className="icon" onClick={close} aria-label={t("Fechar")}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  useLanguage();
  const [state, setState] = useState<State>(),
    [page, setPage] = useState<Page>("messages"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false),
    [dark, setDarkInternal] = useState(
      readDevicePreference("theme") === "dark",
    ),
    [modal, setModal] = useState(""),
    [selection, setSelection] = useState(""),
    [search, setSearch] = useState(""),
    [text, setText] = useState(""),
    [reply, setReply] = useState<DisplayObject>(),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [viewSite, setViewSite] = useState<SiteVisitTarget>(),
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
  const [studioValue, setStudioValue] = useState<StudioValue>(() =>
    initialSite(""),
  );
  const [siteSession, setSiteSession] = useState<(PublishingSession & { generation: number }) | undefined>();
  const [siteLoading, setSiteLoading] = useState(false),
    [siteLoadError, setSiteLoadError] = useState(""),
    [siteLoadVersion, setSiteLoadVersion] = useState(0);
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
  const [largeText, setLargeTextInternal] = useState(
      readDevicePreference("largeText") ?? false,
    ),
    [highContrast, setHighContrastInternal] = useState(
      readDevicePreference("highContrast") ?? false,
    );
  const setDark = (value: boolean) => {
    recordPreference("theme", value ? "dark" : "light");
    setDarkInternal(value);
  };
  const setLargeText = (value: boolean) => {
    recordPreference("largeText", value);
    setLargeTextInternal(value);
  };
  const setHighContrast = (value: boolean) => {
    recordPreference("highContrast", value);
    setHighContrastInternal(value);
  };
  useEffect(() => {
    const remove = [
      registerPreferenceConsumer("theme", (value) =>
        setDarkInternal(value === "dark"),
      ),
      registerPreferenceConsumer("largeText", (value) =>
        setLargeTextInternal(value ?? false),
      ),
      registerPreferenceConsumer("highContrast", (value) =>
        setHighContrastInternal(value ?? false),
      ),
    ];
    return () => remove.forEach((fn) => fn());
  }, []);
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
      await ensureNativePreferences();
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
    loadedSite.current = "";
    setStudioValue(initialSite(""));
    setSiteSession(undefined);
    setSiteLoadError("");
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
            siteDraft: null,
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
      ? t("Guardada localmente")
      : count === total
        ? t("Lida")
        : count
          ? t("Lida por {count} de {total}", { count, total })
          : t("Em espera");
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
  const storedConversations = conversationIds
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
          (authority
            ? t("Grupo de {name}", { name: authority.creator.name })
            : undefined) ??
          group?.content.title ??
          members
            .filter((m) => m.id !== me?.id)
            .map((m) => m.name)
            .join(", "),
        last: ms.at(-1),
      };
    })
    .sort((a, b) => (b.last?.created ?? 0) - (a.last?.created ?? 0));
  const directConversation = (contactId: string) =>
    storedConversations.find(
      (c) =>
        !c.group &&
        !c.authority &&
        c.id.startsWith("dm:") &&
        c.members.length === 2 &&
        c.members.some((m) => m.id === contactId),
    );
  // A saved contact is an actionable conversation entry even before the first
  // message. It does not invent history or publish an empty signed object.
  const contactConversations = contacts
    .filter(
      (c) =>
        c.id !== me?.id &&
        !state?.blocked.includes(c.id) &&
        !directConversation(c.id),
    )
    .map((c) => ({
      id: directConversationId(me!.id, c.id),
      name: c.name,
      members: me ? [me, c] : [],
      group: undefined,
      authority: undefined,
      last: undefined,
    }));
  const allConversations = [...storedConversations, ...contactConversations];
  const conversations = allConversations.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      messages.some(
        (m) =>
          m.content.conversation === c.id &&
          (renderedText(m) ?? "").toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const activeContact = selection.startsWith("contact:")
    ? contacts.find((c) => c.id === selection.slice(8))
    : undefined;
  const selected =
    allConversations.find((c) => c.id === selection) ??
    (activeContact ? directConversation(activeContact.id) : undefined);
  const members =
    selected?.members ?? (activeContact && me ? [me, activeContact] : []);
  const activeMessages = messages.filter(
    (m) =>
      m.content.conversation === (selected?.id ?? selection) &&
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
    if (!me) {
      loadedSite.current = "";
      setStudioValue(initialSite(""));
      setSiteSession(undefined);
      return;
    }
    if (page !== "site" || (loadedSite.current === me.id && siteSession?.generation === privacyGeneration.current)) return;
    const owner = me.id,
      generation = privacyGeneration.current;
    let active = true,
      resolved = false;
    loadedSite.current = owner;
    setSiteLoading(true);
    setSiteLoadError("");
    void (async () => {
      const address = siteAddress(owner, "profile");
      let catalog: SiteCatalogState = await api("site-command", { action: "state", address });
      let data = await api("site-draft-load", {});
      let editing = data?.editing;
      let defaultRecipients: "public" | string[] = data ? [] : "public";
      if (!editing && catalog.number > 0) {
        defaultRecipients = [];
        const current = await api("site-command", { action: "resolve", address });
        catalog = current.state;
        if (current.status === "available") {
          defaultRecipients = current.object.public ? "public" : current.object.readers.filter((id:string) => id !== owner).sort();
          if (!data) {
            data = current.object.content;
            editing = catalog.nextSequence === null ? undefined : contextFor(owner, catalog, undefined, defaultRecipients);
          }
        }
      } else if (!editing && catalog.heads.length === 0) {
        const latest = objects
          .filter((o) => o.kind === "site" && o.author.id === owner && !o.content.siteRevision)
          .sort((a,b) => b.created - a.created || b.id.localeCompare(a.id))[0];
        if (latest) {
          const previous = await api("view", { id: latest.id });
          defaultRecipients = previous.public ? "public" : previous.readers.filter((id:string) => id !== owner).sort();
          data ??= previous.content;
        }
      }
      if (!editing && catalog.number === 0 && catalog.pending.length === 0 && catalog.nextSequence !== null)
        editing = contextFor(owner, catalog, undefined, defaultRecipients);
      if (!active || generation !== privacyGeneration.current) return;
      setStudioValue(
        data
          ? {
              site: data.site ?? legacySite(data.blocks ?? [], me.name),
              theme: data.theme ?? "sand",
              attachments: data.attachments ?? [],
            }
          : initialSite(me.name),
      );
      setSiteSession({editing, catalog, generation, defaultRecipients});
      resolved = true;
    })()
      .catch((e) => {
        if (active) {
          setSiteLoadError((e as Error).message);
          loadedSite.current = "";
        }
      })
      .finally(() => {
        if (active) setSiteLoading(false);
      });
    return () => {
      active = false;
      if (!resolved && loadedSite.current === owner) loadedSite.current = "";
    };
  }, [me?.id, page, siteLoadVersion, privacyGeneration.current]);
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
        ...(selected ? { conversation: selected.id } : {}),
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
      recipients = [
        ...new Set(
          members
            .filter(
              (m) =>
                !selectedAuthority || !reply || reply.readers.includes(m.id),
            )
            .map((m) => m.id),
        ),
      ].sort();
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
  const nav = [
    { id: "messages", label: t("Conversas"), icon: MessageCircle },
    { id: "feed", label: t("A praça"), icon: Globe2 },
    { id: "site", label: t("A minha página"), icon: Layers3 },
    { id: "saved", label: t("Guardados"), icon: Bookmark },
    { id: "network", label: t("A rede"), icon: Radio },
  ] as const;
  const commands: Command[] = commandsOpen
    ? [
        ...nav.map((item) => ({
          id: `page-${item.id}`,
          label: item.label,
          detail: t("Ir para esta área"),
          icon: item.icon,
          run: () => changePage(item.id),
        })),
        {
          id: "settings",
          label: t("Definições"),
          detail: t("Aparência, privacidade e recursos"),
          icon: Settings2,
          run: () => changePage("settings"),
        },
        {
          id: "new",
          label: t("Nova conversa"),
          detail: t("Escolher uma pessoa"),
          icon: Plus,
          run: () => setModal("conversation"),
        },
        {
          id: "post",
          label: t("Partilhar algo"),
          detail: t("Escrever uma publicação na praça"),
          icon: Pencil,
          run: () => setModal("post"),
        },
        {
          id: "peer",
          label: t("Ligar um par"),
          detail: t("Adicionar uma ligação à rede"),
          icon: Radio,
          run: () => setModal("peer"),
        },
        {
          id: "outbox",
          label: t("Estado dos envios"),
          detail: t("Entrega, tentativas e prazo de validade"),
          icon: Send,
          run: () => setModal("outbox"),
        },
        {
          id: "theme",
          label: dark ? t("Usar tema claro") : t("Usar tema escuro"),
          detail: t("Aparência deste dispositivo"),
          icon: dark ? Sun : Moon,
          run: () => setDark(!dark),
        },
        {
          id: "lock",
          label: t("Bloquear identidade"),
          detail: t("Fechar o acesso ao teu espaço privado"),
          icon: LockKeyhole,
          run: () => {
            void lockIdentity();
          },
        },
        ...allConversations.map((c) => ({
          id: `conversation-${c.id}`,
          label: c.name || t("Conversa"),
          detail: t("Abrir conversa"),
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
            detail: `${allConversations.find((c) => c.id === m.content.conversation)?.name || t("Conversa")} · ${m.author.name}`,
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
      <WelcomeScreen
        logo={<Logo />}
        ready={!!state}
        initialized={!!state?.initialized}
        busy={busy}
        error={t(error)}
        dark={dark}
        setDark={setDark}
        largeText={largeText}
        setLargeText={setLargeText}
        highContrast={highContrast}
        setHighContrast={setHighContrast}
        onReconnect={refresh}
        onAuthenticate={(values) => {
          void run(() => api(state?.initialized ? "unlock" : "setup", values));
        }}
      />
    );

  return (
    <div
      className={`shell ${page !== "messages" || !selection ? "has-mobile-dock" : ""}`}
    >
      <a className="skip" href="#main">
        {t("Saltar para o conteúdo")}
      </a>
      <aside
        id="primary-sidebar"
        className={"sidebar " + (mobileMenu ? "mobile-open" : "")}
      >
        <Logo />
        <div className="workspace">
          <span className="workspace-icon">L</span>
          <div>
            <strong>{t("O meu espaço")}</strong>
            <span>{t("Rede pessoal · Experimental")}</span>
          </div>
        </div>
        <div className="nav-label">{t("O QUE NOS LIGA")}</div>
        <nav aria-label={t("Navegação principal")}>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              aria-label={n.label}
              aria-description={
                n.id === "messages" && conversations.length > 0
                  ? t(
                      conversations.length === 1
                        ? t("{count} conversa")
                        : t("{count} conversas"),
                      { count: conversations.length },
                    )
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
              ? t("Também és um caminho.")
              : t("A retransmissão está em pausa.")}
          </strong>
          <p>
            {state.settings.relay
              ? t(
                  "Este dispositivo ajuda conteúdos a chegar mais longe quando existe uma ligação.",
                )
              : t(
                  "Activa a tua participação em A rede e liga outros dispositivos.",
                )}
          </p>
          <button onClick={() => changePage("network")}>
            {t("Conhecer a minha rede")} <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className="settings-nav"
            onClick={() => changePage("settings")}
          >
            <Settings2 size={19} /> {t("Definições")}
          </button>
          <div className="account">
            <Avatar name={me!.name} small />
            <div>
              <strong>{me!.name}</strong>
              <span>{t("Identidade local")}</span>
            </div>
            <button
              className="icon"
              aria-label={t("Bloquear identidade")}
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
            aria-label={t("Abrir navegação")}
            aria-controls="primary-sidebar"
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            {t("O meu espaço")} <span>/</span>
            <strong>
              {nav.find((n) => n.id === page)?.label ?? t("Definições")}
            </strong>
          </div>
          <button
            className="command-trigger"
            onClick={() => setCommandsOpen(true)}
            aria-label={t("Pesquisar e navegar")}
            aria-keyshortcuts="Control+k Meta+k"
          >
            <Search size={17} />
            <span>{t("Pesquisar")}</span>
            <kbd>⌘ / Ctrl K</kbd>
          </button>
          {page === "messages" && selection && (
            <button
              className="icon compact-outbox"
              data-action="outbox"
              aria-label={t("Estado dos envios")}
              onClick={() => setModal("outbox")}
            >
              <Send size={18} />
            </button>
          )}
          <div className={"connection-badge " + (offline ? "warning" : "")}>
            <span className="live-dot" />
            {offline
              ? t("Nó desligado")
              : state.peers.some((p) => p.connected)
                ? `${state.peers.filter((p) => p.connected).length} ${state.peers.filter((p) => p.connected).length === 1 ? t("ligação activa") : t("ligações activas")}`
                : t("À espera de pares")}
          </div>
          <button
            className="icon"
            onClick={() => setDark(!dark)}
            aria-label={t("Alternar tema")}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div className="error banner" role="alert">
              {t(error)}
              <button
                className="icon"
                aria-label={t("Fechar erro")}
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {offline && (
            <div className="offline-banner" role="status">
              {t(
                "O nó local está indisponível. A vista fica em memória; volta a arrancar o nó para continuar.",
              )}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "messages"
                  ? t("CADA CONVERSA, UMA LIGAÇÃO")
                  : page === "feed"
                    ? t("HISTÓRIAS QUE NOS APROXIMAM")
                    : page === "site"
                      ? t("UM CANTO DA REDE, TODO TEU")
                      : page === "network"
                        ? t("FEITA POR PESSOAS, ENTRE PESSOAS")
                        : page === "saved"
                          ? t("O QUE QUERES TER POR PERTO")
                          : t("AO TEU RITMO")}
              </div>
              <h1>
                {page === "messages"
                  ? t("As tuas conversas")
                  : page === "feed"
                    ? t("Encontramo-nos na praça.")
                    : page === "site"
                      ? t("A tua presença, à tua maneira.")
                      : page === "network"
                        ? t("Somos o caminho.")
                        : page === "saved"
                          ? t("Vale a pena guardar.")
                          : t("Cuida do teu espaço.")}
                <span className="title-dot">.</span>
              </h1>
            </div>
            {page === "messages" && (
              <div className="conversation-head-actions">
                <button
                  className="secondary"
                  aria-label={
                    state.capabilities?.dynamicGroups === false
                      ? t("Grupos de leitores fixos")
                      : t("Grupos e convites")
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
                    ? t("Leitores fixos")
                    : t("Grupos e convites")}
                  {groupWorkspace.noticeCount > 0 && (
                    <span
                      className="count"
                      id="group-notice-count"
                      aria-label={t(
                        groupWorkspace.noticeCount === 1
                          ? t("{count} aviso de grupo por verificar")
                          : t("{count} avisos de grupo por verificar"),
                        { count: groupWorkspace.noticeCount },
                      )}
                    >
                      {groupWorkspace.noticeCount}
                    </span>
                  )}
                </button>
                <button
                  className="secondary"
                  aria-label={t("Estado dos envios")}
                  onClick={() => setModal("outbox")}
                >
                  <Send size={16} /> {t("Envios")}
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
                  <Plus size={18} /> {t("Nova conversa")}
                </button>
              </div>
            )}
            {page === "feed" && (
              <button className="primary" onClick={() => setModal("post")}>
                <Plus size={18} /> {t("Partilhar algo")}
              </button>
            )}
            {page === "network" && (
              <button className="primary" onClick={() => setModal("peer")}>
                <Plus size={18} /> {t("Ligar um par")}
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
                  <ArrowUp size={16} /> {t("Carregar histórico anterior")}
                </button>
                <span>
                  {objects.length} {t("de")} {state.history.total}{" "}
                  {t("objectos autorizados disponíveis")}
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
                aria-label={t("Lista de conversas")}
              >
                <div className="list-top">
                  <h2>
                    {t("Mensagens")} <span>{conversations.length}</span>
                  </h2>
                  <button
                    className="icon"
                    aria-label={t("Adicionar contacto")}
                    onClick={() => setModal("contact")}
                  >
                    <Plus size={19} />
                  </button>
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label={t("Pesquisar conversas e mensagens")}
                    placeholder={t("Procurar uma ligação…")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="list-tabs">
                  <span className="active">{t("Todas")}</span>
                  <button onClick={openGroups}>
                    {t("Novo grupo")} <Users size={14} />
                  </button>
                </div>
                {conversations.map((c) => (
                  <button
                    className={
                      "conversation " +
                      (selection === c.id || selected?.id === c.id
                        ? "selected"
                        : "")
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
                            ? t("Mensagem eliminada")
                            : renderedText(c.last) || t("Anexo")
                          : c.authority
                            ? t(groupStatus[c.authority.status])
                            : c.group
                              ? t("O início de uma conversa")
                              : t("Contacto guardado · começar conversa")}
                      </p>
                    </div>
                  </button>
                ))}
                {!conversations.length && (
                  <div className="list-empty">
                    <MessageCircle size={25} />
                    <p>
                      {t("Uma boa conversa começa")}
                      <br />
                      {t("com um primeiro olá.")}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setModal("contact")}
                    >
                      {t("Adicionar um contacto")}
                    </button>
                  </div>
                )}
                <div className="list-footer">
                  <LockKeyhole size={13} />{" "}
                  {t("As conversas são cifradas entre identidades.")}
                </div>
              </section>
              <section className="chat" aria-label={t("Conversa activa")}>
                {selected || activeContact ? (
                  <>
                    <header className="chat-header">
                      <button
                        className="icon mobile-only"
                        onClick={() => setSelection("")}
                        aria-label={t("Voltar às conversas")}
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
                          <ShieldCheck size={13} />{" "}
                          {t("Assinaturas verificadas ·")}{" "}
                          {selectedAuthority?.head?.body.members.length ??
                            members.length}{" "}
                          {t("participantes")}
                        </span>
                      </div>
                      <button
                        className="icon"
                        aria-label={t("Ver participantes")}
                        onClick={() =>
                          selectedAuthority
                            ? setGroupManager(true)
                            : setModal("participants")
                        }
                      >
                        <Users size={20} />
                      </button>
                    </header>
                    {state.capabilities?.autonomous &&
                      !state.peers.some((p) => p.connected) && (
                        <div className="conversation-route-note" role="status">
                          <p>
                            {t(
                              "Sem dispositivos ligados. As mensagens ficam em espera até haver um caminho. Guardar o cartão adiciona o contacto; falta trocar o código de ligação e a resposta em A rede.",
                            )}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setModal("peer")}
                          >
                            {t("Ligar outro dispositivo")}
                          </button>
                        </div>
                      )}
                    {selectedAuthority && !groupCanSend && (
                      <div className="group-epoch-review" role="status">
                        <span>
                          {selectedAuthority.status !== "active"
                            ? t(groupStatus[selectedAuthority.status])
                            : (groupSnapshot?.members.length ?? 0) < 2
                              ? t(
                                  "Convida alguém e aguarda a entrada para começar a conversar.",
                                )
                              : t(
                                  "A versão do grupo mudou. O teu rascunho foi preservado; revê os destinatários.",
                                )}
                        </span>
                        <button onClick={openGroups}>{t("Rever grupo")}</button>
                      </div>
                    )}
                    <div
                      className="message-scroll"
                      role="log"
                      aria-label={t("Histórico de mensagens")}
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
                        <span>{t("Uma ligação só vossa")}</span>
                      </div>
                      <div className="privacy-note">
                        <LockKeyhole size={14} />{" "}
                        {t(
                          "Só as identidades destinatárias podem ler. Os pares podem retransmitir o conteúdo cifrado.",
                        )}
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
                                <em>{t("Mensagem eliminada pelo autor")}</em>
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
                                <span>{t("editada")}</span>
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
                                      t(
                                        "Confirmações verificadas no histórico carregado: ",
                                      ) + legacyReadCount(o)
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
                                aria-label={t("Responder a {name}", {
                                  name: o.author.name,
                                })}
                                onClick={() => setReply(o)}
                              >
                                <Reply size={14} />
                              </button>
                              <button
                                aria-label={t("Reagir à mensagem")}
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
                                    aria-label={t("Editar mensagem")}
                                    onClick={() => setModal("edit:" + o.id)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    aria-label={t("Eliminar mensagem")}
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
                        {t("Novas mensagens")} <ArrowDown size={14} />
                      </button>
                    )}
                    <form className="composer" onSubmit={submitMessage}>
                      {uncertainOperation &&
                        pendingSend.current[selection]?.operationId ===
                          uncertainOperation && (
                          <div className="reply-preview">
                            <AlertTriangle size={16} />
                            <span>{t("Envio anterior por confirmar.")}</span>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                delete pendingSend.current[selection];
                                setUncertainOperation("");
                                setError("");
                              }}
                            >
                              {t("Preparar um novo envio")}
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
                            aria-label={t("Cancelar resposta")}
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
                            {t("Remover")}
                          </button>
                        </div>
                      )}
                      <div className="composer-row">
                        <label
                          className="icon file-picker"
                          aria-label={t("Anexar ficheiro")}
                        >
                          <Paperclip size={21} />
                          <input
                            type="file"
                            disabled={busy}
                            multiple
                            aria-label={t("Anexar ficheiro")}
                            onChange={(e) => {
                              void addFiles(e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <textarea
                          aria-label={t("Escrever mensagem")}
                          placeholder={t("Escreve uma mensagem…")}
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
                          aria-label={t("Enviar mensagem")}
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
                          <ShieldCheck size={12} />{" "}
                          {t("Cifrada e assinada no teu dispositivo")}
                        </span>
                        <label className="expiry-choice">
                          {t("Prazo")}
                          <select
                            aria-label={t("Prazo da mensagem")}
                            value={messageTTL}
                            onChange={(e) =>
                              setMessageTTL(Number(e.target.value))
                            }
                          >
                            <option value={30 * 86400_000}>
                              {t("30 dias")}
                            </option>
                            <option value={7 * 86400_000}>{t("7 dias")}</option>
                            <option value={86400_000}>{t("1 dia")}</option>
                            <option value={3600_000}>{t("1 hora")}</option>
                            <option value={300_000}>{t("5 minutos")}</option>
                          </select>
                        </label>
                      </div>
                    </form>
                  </>
                ) : (
                  <Empty
                    title={t("Perto, mesmo à distância.")}
                    text={t(
                      "Escolhe uma conversa ou cria uma nova ligação. As mensagens ficam guardadas no teu dispositivo e seguem quando houver caminho.",
                    )}
                  >
                    <button
                      className="primary"
                      onClick={() => setModal("conversation")}
                    >
                      <Plus size={17} /> {t("Começar uma conversa")}
                    </button>
                    <div className="empty-footer">
                      <span>
                        <LockKeyhole size={14} /> {t("Privada por natureza")}
                      </span>
                      <span>
                        <Radio size={14} /> {t("Entre pares")}
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
                        {t("Na minha rede")}
                      </button>
                      <button
                        className={feedMode === "following" ? "active" : ""}
                        aria-pressed={feedMode === "following"}
                        onClick={() => setFeedMode("following")}
                      >
                        {t("A seguir")}
                      </button>
                    </div>
                  ) : (
                    <span className="active">
                      {state.collections.find(
                        (c) => c.id === selectedCollection,
                      )?.title ?? t("Todos os guardados")}
                    </span>
                  )}
                  {page === "feed" && (
                    <span>
                      {objects.filter((o) => o.kind === "post").length}{" "}
                      {objects.filter((o) => o.kind === "post").length === 1
                        ? t("publicação em cache")
                        : t("publicações em cache")}
                    </span>
                  )}
                </div>
                <div className="social-toolbar">
                  <button
                    className="import-content"
                    onClick={() => setModal("retrieve")}
                  >
                    <Download size={15} /> {t("Obter conteúdo por endereço")}
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
                            {o.public
                              ? t("Público")
                              : t("Destinatários escolhidos")}
                          </span>
                        </div>
                        <ShieldCheck
                          size={17}
                          aria-label={t("Assinatura verificada")}
                        />
                      </header>
                      {o.kind === "alert" && (
                        <div className="alert-provenance">
                          <AlertTriangle size={18} />{" "}
                          {t("Alerta assinado · Exactidão não confirmada")}
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
                          aria-label={t("Gostar da publicação")}
                          aria-pressed={
                            !!eventsFor(o.id, "reaction")
                              .filter((r) => r.author.id === me?.id)
                              .at(-1)?.content.value
                          }
                        >
                          <Heart size={18} />
                          {hearts(o) || t("Gosto")}
                        </button>
                        <button onClick={() => setModal("comment:" + o.id)}>
                          <MessageCircle size={18} />
                          {eventsFor(o.id, "comment").length || t("Comentar")}
                        </button>
                        <button
                          aria-label={t("Guardar publicação")}
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
                          aria-label={t("Mais opções da publicação")}
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
                          ? t("Histórias para voltar a ler.")
                          : t("Há espaço para a tua história.")
                      }
                      text={
                        page === "saved"
                          ? t(
                              "Guarda publicações na praça para as reunir aqui. Fixar no armazenamento protege-as da limpeza automática.",
                            )
                          : t(
                              "Partilha a primeira publicação com os teus pares. A praça mostra conteúdo realmente recebido e verificado.",
                            )
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
                          ? t("Visitar a praça")
                          : t("Escrever uma publicação")}
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
                  <div className="eyebrow">{t("UMA REDE COM RAÍZES")}</div>
                  <h2>
                    {t("O que lemos")}
                    <br />
                    {t("pode ir")} <em>{t("mais longe.")}</em>
                  </h2>
                  <p>
                    {t(
                      "O conteúdo recebido fica disponível neste nó para outros pares. A assinatura continua sempre a ser do autor.",
                    )}
                  </p>
                  <span>
                    <Leaf size={16} />{" "}
                    {t("Partilhar o caminho, preservar a autoria.")}
                  </span>
                </div>
                <div className="card compact">
                  <h3>{t("Pessoas e páginas")}</h3>
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
                              ? t("A seguir")
                              : t("Seguir localmente")}
                          </button>
                        </div>
                        {objects.some(
                          (o) => o.kind === "site" && o.author.id === c.id,
                        ) && (
                          <button
                            className="icon"
                            aria-label={t("Ver página de {name}", {
                              name: c.name,
                            })}
                            onClick={() => setViewSite({author:c})}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      {t("Os teus contactos aparecem aqui.")}
                    </p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setModal("contact")}
                  >
                    <Plus size={14} /> {t("Adicionar contacto")}
                  </button>
                </div>
              </aside>
            </div>
          )}
          {page === "site" &&
            (siteLoading || (!siteSession && !siteLoadError) ? (
              <section className="card" role="status">
                {t("A abrir o teu projecto cifrado…")}
              </section>
            ) : siteLoadError ? (
              <section className="card">
                <p role="alert">{siteLoadError}</p>
                <button
                  className="secondary"
                  onClick={() => setSiteLoadVersion((v) => v + 1)}
                >
                  {t("Voltar a carregar rascunho")}
                </button>
              </section>
            ) : (
              <Suspense
                fallback={<p role="status">{t("A abrir o estúdio…")}</p>}
              >
                <SiteStudio
                  key={me!.id}
                  value={studioValue}
                  onChange={setStudioValue}
                  owner={me!.name}
                  ownerId={me!.id}
                  knownVersions={objects.filter(o => o.kind === "site" && o.author.id === me!.id && (o.content.siteRevision as SiteRevision | undefined)?.body?.name === "profile").map(o => o.id).sort().join(":" )}
                  contacts={contacts}
                  blocked={state.blocked}
                  session={siteSession!}
                  onSession={next => setSiteSession(current => current && current.generation === siteSession!.generation ? {...current, ...next} : current)}
                  isActive={() => privacyGeneration.current === siteSession!.generation}
                  onView={object => {
                    const revision = object.content.siteRevision as SiteRevision | undefined;
                    setViewSite({author:object.author, ...(revision ? {name:revision.body.name,revisionId:revision.id} : {legacyId:object.id})});
                  }}
                  onSaved={refresh}
                  posts={objects
                    .filter(
                      (o) =>
                        o.kind === "post" &&
                        o.author.id === me!.id &&
                        !o.deleted,
                    )
                    .sort((a, b) => b.created - a.created)}
                  busy={busy}
                />
              </Suspense>
            ))}
          {page === "network" && (
            <>
              <div className="network-hero">
                <div>
                  <div className="eyebrow">
                    <span className="live-dot" />{" "}
                    {state.settings.relay
                      ? t("RETRANSMISSÃO PERMITIDA")
                      : t("RETRANSMISSÃO EM PAUSA")}
                  </div>
                  <h2>
                    {t("Cada pessoa é")}
                    <br />
                    {t("uma nova possibilidade.")}
                  </h2>
                  <p>
                    {t(
                      "As ligações abaixo são reais. A disponibilidade depende de um caminho entre pares e de dispositivos que mantenham o conteúdo.",
                    )}
                  </p>
                  <button
                    className="light-button"
                    onClick={() => setModal("peer")}
                  >
                    {t("Abrir um novo caminho")} <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="network-emblem" aria-hidden="true">
                  <Radio size={52} />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <RelayParticipation
                enabled={state.settings.relay}
                peers={state.peers.filter((p) => p.connected).length}
                autonomous={state.capabilities?.autonomous === true}
                busy={busy}
                onChange={(relay) => run(() => api("settings", { relay }))}
                onConnect={() => setModal("peer")}
              />
              <div className="metrics">
                <div>
                  <span>{t("Pares ligados")}</span>
                  <strong>
                    {state.peers.filter((p) => p.connected).length}
                    <Radio size={22} />
                  </strong>
                  <small>{t("Ligações entre dispositivos")}</small>
                </div>
                <div>
                  <span>{t("Conteúdos neste nó")}</span>
                  <strong>
                    {state.storage.count}
                    <Layers3 size={22} />
                  </strong>
                  <small>
                    {state.storage.pinned} {t("fixados no armazenamento")}
                  </small>
                </div>
                <div>
                  <span>{t("Armazenamento utilizado")}</span>
                  <strong>
                    {bytes(state.storage.bytes)}
                    <Leaf size={22} />
                  </strong>
                  <small>
                    {t("de")} {bytes(state.storage.quota)}{" "}
                    {t("disponíveis para a rede")}
                  </small>
                </div>
                <div>
                  <span>{t("Pacotes encaminhados")}</span>
                  <strong>
                    {state.counters.forwarded}
                    <ArrowUpRight size={22} />
                  </strong>
                  <small>{t("Contagem real desde o arranque")}</small>
                </div>
              </div>
              <section className="card">
                <div className="section-heading">
                  <h2>{t("Ligações deste dispositivo")}</h2>
                  <span className="pill">
                    {state.capabilities?.autonomous
                      ? t("Neste navegador")
                      : t("TCP local: {port}", { port: state.tcpPort })}
                  </span>
                </div>
                {state.peers.length ? (
                  <div className="peer-table">
                    <div className="peer-row head">
                      <span>{t("Par / endereço")}</span>
                      <span>{t("Meio")}</span>
                      <span>{t("Transferência")}</span>
                      <span>{t("Estado")}</span>
                    </div>
                    {state.peers.map((p) => (
                      <div className="peer-row" key={p.id}>
                        <strong>{p.address}</strong>
                        <span>
                          {p.medium === "serial"
                            ? t("Série")
                            : p.medium === "webrtc"
                              ? "WebRTC"
                              : p.medium === "websocket"
                                ? "WebSocket"
                                : p.medium === "reticulum"
                                  ? "Reticulum"
                                  : "TCP / IP"}
                        </span>
                        <span>
                          ↑ {bytes(p.sent)} · ↓ {bytes(p.received)}
                        </span>
                        <span className="pill">
                          {p.connected ? t("Ligado") : t("Desligado")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={Radio}
                    title={t("O próximo caminho começa aqui.")}
                    text={
                      state.capabilities?.autonomous
                        ? t(
                            "Usa Ligar um par para trocar códigos com outro navegador ou aceitar um convite de uma app instalada. Adicionar o cartão de uma pessoa não estabelece esta ligação.",
                          )
                        : t(
                            "Troca o endereço de transporte com outro nó ou liga um dispositivo série suportado. Não há descoberta nem servidor de arranque obrigatório.",
                          )
                    }
                  />
                )}
                {state.transportError && (
                  <p role="alert" className="error">
                    {t(state.transportError)}
                  </p>
                )}
              </section>
              <div className="network-foot">
                <ShieldCheck />
                <p>
                  <strong>
                    {t("Uma rede experimental, com limites transparentes.")}
                  </strong>
                  <br />
                  {t(
                    "TCP usa sockets reais. Série pode usar dispositivos ou PTYs de teste. BLE, Wi-Fi Direct e rádios físicos ainda não foram validados. Não substitui serviços de emergência.",
                  )}
                </p>
                <button
                  className="danger-outline"
                  onClick={() => setModal("alert")}
                >
                  <AlertTriangle size={17} /> {t("Criar alerta prioritário")}
                </button>
              </div>
            </>
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <section className="card">
                <LanguageSelector />
                <details className="setup-help">
                  <summary>{t("Primeiros passos")}</summary>
                  <WelcomeGuide />
                </details>
              </section>
              <section className="card">
                <h2>{t("Identidade & confiança")}</h2>
                <div className="identity-card">
                  <Avatar name={me!.name} />
                  <div>
                    <h3>{me!.name}</h3>
                    <code>{short(me!.id)}</code>
                  </div>
                  <ShieldCheck />
                </div>
                <p className="muted">
                  {t(
                    "Verifica a impressão da identidade por um canal de confiança. Uma assinatura válida não comprova a identidade civil.",
                  )}
                </p>
                <label>
                  {t("Cartão público da identidade")}
                  <textarea
                    readOnly
                    value={JSON.stringify(me)}
                    aria-label={t("Cartão público da identidade")}
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() =>
                    copy(JSON.stringify(me), "Cartão público copiado")
                  }
                >
                  <Copy size={17} /> {t("Copiar cartão público")}
                </button>
                <button
                  className="secondary"
                  onClick={() => setModal("export")}
                >
                  <Download size={17} /> {t("Exportar cofre de recuperação")}
                </button>
                <p className="small-note">
                  {t(
                    "Guarda o cofre e a frase-passe separadamente. Sem ambos, a identidade não é recuperável.",
                  )}
                </p>
              </section>
              <section className="card">
                <h2>{t("Dar à rede, ao teu ritmo")}</h2>
                <label className="toggle-row">
                  <div>
                    <strong>{t("Retransmitir conteúdo")}</strong>
                    <span>
                      {t(
                        "Permitir que este nó ajude a rede quando está a correr.",
                      )}
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
                    <strong>{t("Modo de baixo consumo")}</strong>
                    <span>
                      {t(
                        "Adiar transferências em massa; manter mensagens prioritárias.",
                      )}
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
                  {t("Orçamento de armazenamento")}
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
                  {t(
                    "Conteúdos não fixados podem ser removidos quando a quota é atingida. Eliminar não apaga cópias noutros pares.",
                  )}
                </p>
                <NotificationSettings controller={notifications} />
                <h3>{t("Leitura e acessibilidade")}</h3>
                <label className="toggle-row">
                  <div>
                    <strong>Liquid Glass</strong>
                    <span>
                      {t(
                        "Transparência e profundidade. Efeitos reduzidos em baixo consumo, alto contraste ou por preferência do sistema.",
                      )}
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
                    <strong>{t("Texto maior")}</strong>
                    <span>
                      {t(
                        "Aumentar mensagens, controlos e informação importante.",
                      )}
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
                    <strong>{t("Alto contraste")}</strong>
                    <span>
                      {t("Reforçar texto, contornos e estados de ligação.")}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={highContrast}
                    onChange={(e) => setHighContrast(e.target.checked)}
                  />
                </label>
                <h3>{t("Contactos")}</h3>
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
                        ? t("Desbloquear")
                        : t("Bloquear")}
                    </button>
                  </div>
                ))}
                <button
                  className="text-button"
                  onClick={() => setModal("contact")}
                >
                  <Plus size={15} /> {t("Adicionar contacto")}
                </button>
                <h3>{t("Denúncias locais")}</h3>
                <p className="muted">
                  {state.reports.length}{" "}
                  {t(
                    "registos neste dispositivo. Não são enviados a um serviço central.",
                  )}
                </p>
              </section>
            </div>
          )}
          <footer className="app-footer">
            <span>
              <span className="live-dot" />{" "}
              {t("Guardado perto de ti. Partilhado entre nós.")}
            </span>
            <span>RELAYLOOM / EXPERIMENTAL</span>
          </footer>
        </main>
      </div>
      {(page !== "messages" || !selection) && !mobileMenu && (
        <nav className="mobile-dock" aria-label={t("Navegação rápida")}>
          {nav.map((item) => (
            <button
              key={item.id}
              aria-label={t("Ir para {area}", { area: item.label })}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => changePage(item.id)}
            >
              <item.icon size={21} />
              <span>
                {item.id === "site"
                  ? t("Página")
                  : item.id === "messages"
                    ? t("Conversas")
                    : item.id === "feed"
                      ? t("Praça")
                      : item.id === "network"
                        ? t("Rede")
                        : t("Guardados")}
              </span>
            </button>
          ))}
        </nav>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {t(notice)}
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
              ? t("O caminho dos teus envios")
              : modal === "contact"
                ? t("Adicionar uma pessoa")
                : modal === "retrieve"
                  ? t("Obter conteúdo da rede")
                  : modal === "conversation"
                    ? t("Começar uma conversa")
                    : modal === "group"
                      ? t("Criar um grupo privado")
                      : modal === "peer"
                        ? t("Ligar um par")
                        : modal === "export"
                          ? t("Guardar a tua identidade")
                          : modal === "participants"
                            ? t("Quem está nesta conversa")
                            : modal === "alert"
                              ? t("Criar alerta prioritário")
                              : modal.startsWith("edit:")
                                ? t("Editar o teu conteúdo")
                                : modal.startsWith("comment:")
                                  ? t("Juntar à conversa")
                                  : modal.startsWith("post-options:")
                                    ? t("Opções da publicação")
                                    : t("Uma história para partilhar")
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
                {t(
                  "Um endereço identifica o conteúdo. Não concede uma chave de leitura nem transfere a autoria.",
                )}
              </p>
              <label>
                {t("Endereço do conteúdo")}
                <input
                  name="id"
                  required
                  pattern="[a-f0-9]{64}"
                  minLength={64}
                  maxLength={64}
                  placeholder={t("64 caracteres hexadecimais")}
                />
              </label>
              <button className="primary full" disabled={busy}>
                {t("Pedir aos pares")}
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
                {t(
                  "Troca o cartão público com a outra pessoa. Compara a impressão da identidade por um canal de confiança.",
                )}
              </p>
              <label>
                {t("Cartão público do contacto")}
                <textarea
                  name="card"
                  rows={5}
                  required
                  placeholder={t("Cola aqui o cartão JSON da identidade")}
                  aria-label={t("Cartão público do contacto")}
                />
              </label>
              <button className="primary full" disabled={busy}>
                <ShieldCheck size={17} /> {t("Verificar e adicionar")}
              </button>
            </form>
          )}
          {modal === "conversation" && (
            <>
              <p>
                {t("Escolhe uma pessoa para começar uma conversa cifrada.")}
              </p>
              {contacts
                .filter((c) => !state.blocked.includes(c.id))
                .map((c) => (
                  <button
                    className="contact-choice"
                    key={c.id}
                    onClick={() => {
                      const existing = allConversations.find(
                        (g) =>
                          !g.group &&
                          g.id.startsWith("dm:") &&
                          g.members.length === 2 &&
                          g.members.some((m) => m.id === c.id),
                      );
                      chooseConversation(
                        existing?.id ?? directConversationId(me!.id, c.id),
                      );
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
                <Plus size={17} /> {t("Adicionar uma pessoa")}
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
                {t(
                  "Cada mensagem é cifrada para os membros escolhidos. A alteração de membros ainda não está disponível.",
                )}
              </p>
              <label>
                {t("Nome do grupo")}
                <input
                  name="title"
                  required
                  maxLength={80}
                  placeholder={t("Pessoas por perto")}
                />
              </label>
              <fieldset>
                <legend>{t("Participantes")}</legend>
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
                <Users size={17} /> {t("Criar grupo")}
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
                      {t("Adicionar")}
                    </button>
                  )}
                </div>
              ))}
              <p className="muted">
                {t(
                  "A assinatura valida a identidade criptográfica. Confirma as impressões com as pessoas que conheces.",
                )}
              </p>
            </>
          )}
          {modal === "peer" && state.capabilities?.autonomous && (
            <BrowserPeerPanel api={api} />
          )}
          {modal === "peer" && !state.capabilities?.autonomous && (
            <>
              <WebInvitation api={api} current={state.webPeer} />
              <p>
                {t(
                  "Liga-te ao endereço TCP que o outro nó partilhou contigo. O controlo da aplicação continua apenas neste dispositivo.",
                )}
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
                  {t("Endereço do par")}
                  <input
                    name="host"
                    required
                    defaultValue="127.0.0.1"
                    placeholder="192.168.1.20"
                  />
                </label>
                <label>
                  {t("Porta TCP de transporte")}
                  <input
                    name="port"
                    required
                    type="number"
                    min={1}
                    max={65535}
                    placeholder={t("Porta indicada pelo outro nó")}
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  <Link size={17} /> {t("Ligar por TCP")}
                </button>
              </form>
              {state.nativeRuntime === "Go" ? (
                <p className="muted">
                  {t(
                    "O adaptador série ainda não está disponível neste núcleo nativo. Podes ligar pares por TCP.",
                  )}
                </p>
              ) : (
                <details>
                  <summary>{t("Dispositivo série")}</summary>
                  <p className="muted">
                    {t(
                      "Um dispositivo série compatível ou PTY de teste. Isto não configura nem valida um rádio físico.",
                    )}
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
                      {t("Caminho do dispositivo")}
                      <input name="path" required placeholder="/dev/ttyUSB0" />
                    </label>
                    <label>
                      {t("Velocidade")}
                      <select name="baud" defaultValue="115200">
                        <option>9600</option>
                        <option>57600</option>
                        <option>115200</option>
                      </select>
                    </label>
                    <button className="secondary full" disabled={busy}>
                      {t("Ligar por série")}
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
                  ? t(
                      "A assinatura prova a autoria, não a exactidão. Indica o contexto e a hora; não publiques localização pessoal desnecessária.",
                    )
                  : t("O que te apetece partilhar com a tua rede?")}
              </p>
              <label>
                {modal === "alert"
                  ? t("Informação do alerta")
                  : t("A tua publicação")}
                <textarea
                  name="text"
                  rows={5}
                  required
                  maxLength={12000}
                  placeholder={
                    modal === "alert"
                      ? t("O que se passa e quando foi observado?")
                      : t("Uma ideia, uma história, um olá…")
                  }
                  aria-label={
                    modal === "alert"
                      ? t("Informação do alerta")
                      : t("A tua publicação")
                  }
                />
              </label>
              <label>
                {t("Quem pode ler")}
                <select name="privacy">
                  <option value="public">
                    {t("Público — qualquer leitor")}
                  </option>
                  <option value="contacts">
                    {t("Os meus contactos actuais")}
                  </option>
                </select>
              </label>
              <p className="small-note">
                {t(
                  "Os leitores podem guardar e semear cópias. A autoria continua a ser tua.",
                )}
              </p>
              <button className="primary full" disabled={busy}>
                <Send size={17} />
                {modal === "alert" ? t("Publicar alerta") : t("Publicar")}
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
                {t("Texto")}
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
                  aria-label={t("Texto")}
                />
              </label>
              <button className="primary full" disabled={busy}>
                {t("Guardar")}
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
                      ? t("Desafixar do armazenamento")
                      : t("Fixar no armazenamento")}
                  </button>
                  <div className="collection-memberships">
                    <strong>{t("Guardar numa colecção")}</strong>
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
                        {t("Criar uma colecção em Guardados")}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => copy(o.id, "Endereço do conteúdo copiado")}
                  >
                    <Copy size={18} /> {t("Copiar endereço do conteúdo")}
                  </button>
                  {o.author.id === me!.id ? (
                    <>
                      <button onClick={() => setModal("edit:" + o.id)}>
                        <Pencil size={18} /> {t("Editar publicação")}
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
                        <Trash2 size={18} /> {t("Eliminar publicação")}
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
                        <ShieldCheck size={18} /> {t("Bloquear este autor")}
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
                          {t("Motivo da denúncia")}
                          <textarea
                            name="reason"
                            required
                            maxLength={500}
                            aria-label={t("Motivo da denúncia")}
                          />
                        </label>
                        <button className="secondary full">
                          {t("Registar denúncia local")}
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
                {t(
                  "A cópia contém as tuas chaves cifradas. Guarda-a num lugar seguro e conserva a frase-passe separadamente.",
                )}
              </p>
              <label>
                {t("Frase-passe para esta cópia")}
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
                <Download size={17} /> {t("Descarregar cofre cifrado")}
              </button>
            </form>
          )}
        </Modal>
      )}
      {viewSite && (
        <Modal
          title={t("Página de {name}", { name: viewSite.author.name })}
          close={() => setViewSite(undefined)}
        >
          <Suspense fallback={<p role="status">{t("A abrir o site…")}</p>}>
            <SiteVisit target={viewSite} knownVersions={objects.filter(o => o.kind === "site" && o.author.id === viewSite.author.id && (o.content.siteRevision as SiteRevision | undefined)?.body?.name === (viewSite.name ?? "profile")).map(o => o.id).sort().join(":")} legacy={objects.filter(o => o.kind === "site" && o.author.id === viewSite.author.id && !o.content.siteRevision)} posts={objects.filter(o => o.kind === "post" && o.author.id === viewSite.author.id && !o.deleted).sort((a,b) => b.created - a.created)}/>
          </Suspense>
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
              {t("Voltar a carregar")}
            </button>
          ) : (
            <span role="status">{t("A carregar…")}</span>
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
