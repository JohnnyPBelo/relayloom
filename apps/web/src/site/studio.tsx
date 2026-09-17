import { t, tc } from "../i18n/core";
import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Code2,
  Link2,
  MessageSquare,
  Heading,
  Quote,
  MousePointer2,
  Images,
  Minus,
  MoveVertical,
  Columns3,
  Newspaper,
  type LucideIcon,
  Copy,
  Download,
  Eye,
  FilePlus2,
  Globe2,
  GripVertical,
  ImagePlus,
  LayoutTemplate,
  Monitor,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import {
  SITE_BLOCKS,
  SITE_LIMITS,
  siteFallback,
  type SiteDocument,
  type SiteNode,
  type SiteNodeType,
} from "../../../../packages/content/src/site";
import type {
  Attachment,
  DisplayObject,
} from "../../../../packages/content/src/types";
import {
  cloneNode,
  countBlocks,
  duplicatePage,
  flatten,
  labels,
  mapNodes,
  movePage,
  newBlock,
  templateSite,
  validateStudio,
  type StudioValue,
} from "./model";
import { SiteNodeView, SiteSurface, nodeClass } from "./renderer";
import "./studio.css";
const blockIcons: Record<SiteNodeType, LucideIcon> = {
  hero: LayoutTemplate,
  text: Pencil,
  links: Link2,
  callout: MessageSquare,
  heading: Heading,
  quote: Quote,
  button: MousePointer2,
  image: ImagePlus,
  gallery: Images,
  divider: Minus,
  spacer: MoveVertical,
  columns: Columns3,
  posts: Newspaper,
};
export function SiteStudio({
  value,
  onChange,
  onSave,
  onPublish,
  owner,
  posts,
  busy,
  header,
  managedFeedback = false,
  publishDisabled = false,
  onActionError,
}: {
  value: StudioValue;
  onChange: (v: StudioValue) => void;
  onSave: (v: StudioValue) => Promise<unknown>;
  onPublish: (v: StudioValue) => Promise<unknown>;
  owner: string;
  posts: DisplayObject[];
  busy: boolean;
  header?: React.ReactNode;
  managedFeedback?: boolean;
  publishDisabled?: boolean;
  onActionError?: (error: Error) => void;
}) {
  const [pageId, setPage] = useState(value.site.home),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState(false),
    [viewport, setViewport] = useState<"desktop" | "mobile">("desktop"),
    [panel, setPanel] = useState<"blocks" | "design" | "code" | "templates">(
      "blocks",
    ),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [code, setCode] = useState(""),
    [revision, setRevision] = useState(0),
    [working, setWorking] = useState(false);
  const history = useRef<{ past: StudioValue[]; future: StudioValue[] }>({
    past: [],
    future: [],
  });
  const historySizes = useRef(new WeakMap<StudioValue, number>());
  function historyBytes(v: StudioValue) {
    let size = historySizes.current.get(v);
    if (size === undefined) {
      size = new TextEncoder().encode(JSON.stringify(v)).length;
      historySizes.current.set(v, size);
    }
    return size;
  }
  const tabsId = useId();
  const panels = ["blocks", "design", "templates", "code"] as const;
  function choosePanel(next: (typeof panels)[number]) {
    setPanel(next);
    if (next === "code")
      setCode(
        JSON.stringify(
          { format: "relayloom-site-project", version: 1, ...value },
          null,
          2,
        ),
      );
  }
  const drag = useRef<string | undefined>(undefined),
    upload = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const page =
    value.site.pages.find((p) => p.id === pageId) ??
    value.site.pages.find((p) => p.id === value.site.home)!;
  const tree = flatten(page.blocks),
    chosen = tree.find((x) => x.node.id === selected),
    disabled = busy || working,
    pageIndex = value.site.pages.findIndex((entry) => entry.id === page.id);
  function change(next: StudioValue, record = true) {
    if (record) {
      history.current.past.push(value);
      while (
        history.current.past.length > 40 ||
        history.current.past.reduce((n, v) => n + historyBytes(v), 0) >
          8 * 1024 * 1024
      )
        history.current.past.shift();
      history.current.future = [];
    }
    onChange(next);
    setRevision((x) => x + 1);
    setFeedback("Alterações por guardar");
    setError("");
  }
  function editDoc(fn: (s: SiteDocument) => void) {
    if (disabled) return;
    const next = { ...value, site: structuredClone(value.site) };
    fn(next.site);
    change(next);
  }
  function updateNode(id: string, patch: Partial<SiteNode>) {
    editDoc((s) => {
      const p = s.pages.find((p) => p.id === page.id)!;
      p.blocks = mapNodes(p.blocks, id, (n) => ({ ...n, ...patch }));
    });
  }
  function removeNode(id: string) {
    editDoc((s) => {
      const p = s.pages.find((p) => p.id === page.id)!;
      p.blocks = mapNodes(p.blocks, id, () => null);
    });
    setSelected("");
  }
  function insert(type: SiteNodeType, parent?: string) {
    if (countBlocks(value.site) >= SITE_LIMITS.blocks) {
      setError("Limite de 128 blocos atingido.");
      return;
    }
    const target = parent ? tree.find((x) => x.node.id === parent) : undefined;
    if (
      target &&
      (target.depth >= SITE_LIMITS.depth ||
        (target.node.children?.length ?? 0) >= 24)
    ) {
      setError("Esta composição atingiu o limite.");
      return;
    }
    if (!parent && page.blocks.length >= 24) {
      setError(
        "Esta página atingiu 24 blocos principais. Usa composições ou outra página.",
      );
      return;
    }
    const node = newBlock(type);
    editDoc((s) => {
      const p = s.pages.find((p) => p.id === page.id)!;
      if (parent)
        p.blocks = mapNodes(p.blocks, parent, (n) => ({
          ...n,
          children: [...(n.children ?? []), node],
        }));
      else p.blocks.push(node);
    });
    setSelected(node.id);
  }
  function reorder(id: string, offset: number) {
    editDoc((s) => {
      function move(nodes: SiteNode[]): SiteNode[] {
        const at = nodes.findIndex((n) => n.id === id);
        if (at >= 0) {
          const to = at + offset;
          if (to >= 0 && to < nodes.length) {
            const [n] = nodes.splice(at, 1);
            nodes.splice(to, 0, n);
          }
          return nodes;
        }
        return nodes.map((n) => ({
          ...n,
          ...(n.children ? { children: move(n.children) } : {}),
        }));
      }
      s.pages.find((p) => p.id === page.id)!.blocks = move(
        s.pages.find((p) => p.id === page.id)!.blocks,
      );
    });
  }
  function reparent(id: string, parent?: string) {
    const source = tree.find((x) => x.node.id === id);
    if (!source) return;
    if (parent && flatten([source.node]).some((x) => x.node.id === parent)) {
      setError("Uma composição não pode conter-se a si própria.");
      return;
    }
    const next = { ...value, site: structuredClone(value.site) },
      p = next.site.pages.find((p) => p.id === page.id)!;
    p.blocks = mapNodes(p.blocks, id, () => null);
    if (parent)
      p.blocks = mapNodes(p.blocks, parent, (n) => ({
        ...n,
        children: [...(n.children ?? []), structuredClone(source.node)],
      }));
    else p.blocks.push(structuredClone(source.node));
    try {
      validateStudio(next);
      change(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function drop(id: string, target: string) {
    const source = tree.find((x) => x.node.id === id),
      dest = tree.find((x) => x.node.id === target);
    if (!source || !dest) return;
    if (dest.node.type === "columns" && source.node.id !== dest.node.id) {
      reparent(id, dest.node.id);
      return;
    }
    if (source.parent !== dest.parent) {
      reparent(id, dest.parent);
      return;
    }
    const siblings = source.parent
      ? tree.find((x) => x.node.id === source.parent)!.node.children!
      : page.blocks;
    reorder(
      id,
      siblings.findIndex((n) => n.id === target) -
        siblings.findIndex((n) => n.id === id),
    );
  }
  function duplicate(id: string) {
    const source = tree.find((x) => x.node.id === id);
    if (!source) return;
    const count = flatten([source.node]).length;
    if (countBlocks(value.site) + count > 128) {
      setError("Limite de blocos atingido.");
      return;
    }
    const siblings = source.parent
      ? tree.find((x) => x.node.id === source.parent)!.node.children!
      : page.blocks;
    if (siblings.length >= 24) {
      setError("Não há espaço nesta composição.");
      return;
    }
    const clone = cloneNode(source.node);
    editDoc((s) => {
      function add(nodes: SiteNode[]): SiteNode[] {
        return nodes.flatMap((n) =>
          n.id === id
            ? [n, clone]
            : [{ ...n, ...(n.children ? { children: add(n.children) } : {}) }],
        );
      }
      s.pages.find((p) => p.id === page.id)!.blocks = add(
        s.pages.find((p) => p.id === page.id)!.blocks,
      );
    });
    setSelected(clone.id);
  }
  function addPage() {
    if (value.site.pages.length >= 12) return;
    const id = crypto.randomUUID();
    let count = value.site.pages.length + 1;
    while (value.site.pages.some((p) => p.slug === "pagina-" + count)) count++;
    editDoc((s) =>
      s.pages.push({
        id,
        slug: "pagina-" + count,
        title: t("Nova página"),
        blocks:
          countBlocks(value.site) < SITE_LIMITS.blocks
            ? [newBlock("hero")]
            : [],
      }),
    );
    setPage(id);
    setSelected("");
  }
  function deletePage() {
    if (page.id === value.site.home) return;
    const linked = value.site.pages.some((p) =>
      flatten(p.blocks).some((n) => n.node.url === "page:" + page.id),
    );
    if (linked) {
      setError("Remove primeiro as ligações para esta página.");
      return;
    }
    editDoc((s) => {
      s.pages = s.pages.filter((p) => p.id !== page.id);
    });
    setPage(value.site.home);
    setSelected("");
  }
  function duplicateSelectedPage() {
    if (disabled) return;
    try {
      const next = duplicatePage(value, page.id);
      change(next.value);
      setPage(next.pageId);
      setSelected("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function moveSelectedPage(direction: -1 | 1) {
    if (disabled) return;
    const site = movePage(value.site, page.id, direction);
    if (site !== value.site) change({ ...value, site });
  }
  async function action(kind: "save" | "publish") {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const region = trigger?.closest(".site-studio");
    let moved = false;
    const interacted = () => {
      moved = true;
    };
    const cleanup = () => {
      document.removeEventListener("pointerdown", interacted, true);
      document.removeEventListener("keydown", interacted, true);
    };
    document.addEventListener("pointerdown", interacted, true);
    document.addEventListener("keydown", interacted, true);
    setError("");
    setFeedback("");
    setWorking(true);
    try {
      validateStudio(value);
      await (kind === "save" ? onSave(value) : onPublish(value));
      if (mounted.current && !managedFeedback)
        setFeedback(
          kind === "save"
            ? "Rascunho cifrado guardado neste dispositivo"
            : "Página assinada e publicada no armazenamento P2P",
        );
    } catch (e) {
      if (mounted.current) {
        if (managedFeedback && onActionError) onActionError(e as Error);
        else setError((e as Error).message);
      }
    } finally {
      if (mounted.current) {
        setWorking(false);
        requestAnimationFrame(() => {
          cleanup();
          if (!mounted.current || moved || !region?.isConnected) return;
          const target =
            trigger?.isConnected && !trigger.matches(":disabled")
              ? trigger
              : region.querySelector<HTMLElement>(
                  "[data-site-followup]:enabled",
                );
          target?.focus({ preventScroll: true });
        });
      } else cleanup();
    }
  }
  async function files(list: FileList | null) {
    const incoming = Array.from(list ?? []);
    if (!incoming.length) return;
    setError("");
    setWorking(true);
    try {
      if (incoming.length + value.attachments.length > 4)
        throw new Error(
          "Podes incluir até quatro imagens, reutilizadas em várias páginas.",
        );
      if (
        incoming.some(
          (f) =>
            !/^image\/(png|jpeg|webp|gif)$/.test(f.type) ||
            f.size > 2 * 1024 * 1024,
        ) ||
        incoming.reduce((n, f) => n + f.size, 0) +
          value.attachments.reduce(
            (n, a) => n + Math.floor((a.data.length * 3) / 4),
            0,
          ) >
          2 * 1024 * 1024
      )
        throw new Error(
          "Escolhe imagens PNG, JPEG, WebP ou GIF, até 2 MB no total.",
        );
      const assets: Attachment[] = [];
      for (const file of incoming) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () =>
            reject(new Error("Não foi possível ler a imagem"));
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(file);
        });
        assets.push({ name: file.name.slice(0, 150), mime: file.type, data });
      }
      if (!mounted.current) return;
      const next = structuredClone(value),
        start = next.attachments.length;
      next.attachments.push(...assets);
      if (chosen && ["image", "gallery"].includes(chosen.node.type)) {
        next.site.pages.find((p) => p.id === page.id)!.blocks = mapNodes(
          page.blocks,
          chosen.node.id,
          (n) => ({
            ...n,
            media: [
              ...(n.media ?? []),
              ...assets.map((a, i) => ({ attachment: start + i, alt: a.name })),
            ].slice(0, n.type === "image" ? 1 : 4),
          }),
        );
      }
      change(next);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setWorking(false);
      if (upload.current) upload.current.value = "";
    }
  }
  function exportJSON() {
    validateStudio(value);
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { format: "relayloom-site-project", version: 1, ...value },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "relayloom-site.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const canUndo = history.current.past.length > 0,
    canRedo = history.current.future.length > 0;
  return (
    <section
      className="site-studio"
      aria-label={t("Estúdio do site")}
      data-revision={revision}
    >
      {header}
      <fieldset
        className="studio-controls"
        aria-label={t("Controlos do estúdio")}
        disabled={disabled}
        aria-busy={working}
      >
        <div className="studio-commandbar">
          <div className="segmented">
            <button
              aria-pressed={!preview}
              className={!preview ? "active" : ""}
              onClick={() => setPreview(false)}
            >
              <Pencil size={16} />
              {t("Editar")}
            </button>
            <button
              aria-pressed={preview}
              className={preview ? "active" : ""}
              onClick={() => setPreview(true)}
            >
              <Eye size={16} />
              {t("Pré-visualizar")}
            </button>
          </div>
          <div className="studio-history">
            <button
              className="icon"
              aria-label={t("Desfazer alteração do site")}
              disabled={!canUndo || disabled}
              onClick={() => {
                const old = history.current.past.pop()!;
                history.current.future.push(value);
                change(old, false);
              }}
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="icon"
              aria-label={t("Refazer alteração do site")}
              disabled={!canRedo || disabled}
              onClick={() => {
                const next = history.current.future.pop()!;
                history.current.past.push(value);
                change(next, false);
              }}
            >
              <RotateCw size={18} />
            </button>
          </div>
          <div className="studio-viewports">
            <button
              className="icon"
              aria-label={t("Pré-visualização larga")}
              aria-pressed={viewport === "desktop"}
              onClick={() => setViewport("desktop")}
            >
              <Monitor size={18} />
            </button>
            <button
              className="icon"
              aria-label={t("Pré-visualização móvel")}
              aria-pressed={viewport === "mobile"}
              onClick={() => setViewport("mobile")}
            >
              <Smartphone size={18} />
            </button>
          </div>
          <label className="inline-label">
            {t("Paleta")}
            <select
              aria-label={t("Paleta da página")}
              value={value.theme}
              onChange={(e) => change({ ...value, theme: e.target.value })}
            >
              <option value="sand">{t("Areia")}</option>
              <option value="forest">{t("Floresta")}</option>
              <option value="ink">{t("Tinta")}</option>
            </select>
          </label>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => void action("save")}
          >
            <Bookmark size={16} />
            {t("Guardar rascunho")}
          </button>
          <button
            className="primary"
            disabled={disabled || publishDisabled}
            onClick={() => void action("publish")}
          >
            <Globe2 size={16} />
            {t("Publicar página")}
          </button>
        </div>
        <div className="studio-feedback">
          {feedback && (
            <span role="status">
              <Check size={15} />
              {t(feedback)}
            </span>
          )}
          {error && (
            <span className="error" role="alert">
              {t(error)}
            </span>
          )}
          <small>
            {value.site.pages.length}
            {t("/12 páginas ·")} {countBlocks(value.site)}
            {t("/128 blocos ·")}{" "}
            {Math.ceil(
              value.attachments.reduce(
                (n, a) => n + (a.data.length * 3) / 4,
                0,
              ) / 1024,
            )}{" "}
            {t("KB de imagens")}
          </small>
        </div>
        <div
          className={"studio-workspace " + (preview ? "studio-preview" : "")}
        >
          {!preview && (
            <aside
              className="studio-sidebar"
              aria-label={t("Estrutura e ferramentas do site")}
            >
              <div className="studio-sidebar-heading">
                <span className="eyebrow">{t("O TEU PEQUENO UNIVERSO")}</span>
                <h2>{t("Uma ideia. Muitas páginas.")}</h2>
                <p>
                  {t("Organiza, compõe e publica. Cada detalhe tem lugar.")}
                </p>
              </div>
              <div className="studio-pages">
                <div className="section-heading">
                  <h3>{tc("studio", "Páginas")}</h3>
                  <button
                    className="icon"
                    aria-label={t("Adicionar página ao site")}
                    disabled={value.site.pages.length >= 12 || disabled}
                    onClick={addPage}
                  >
                    <FilePlus2 size={18} />
                  </button>
                </div>
                {value.site.pages.map((p) => (
                  <button
                    key={p.id}
                    className={p.id === page.id ? "active" : ""}
                    aria-pressed={p.id === page.id}
                    onClick={() => {
                      setPage(p.id);
                      setSelected("");
                    }}
                  >
                    <span>{p.title}</span>
                    <small>
                      {p.id === value.site.home ? t("Início") : "/" + p.slug}
                    </small>
                  </button>
                ))}
              </div>
              <div
                className="studio-tool-tabs"
                role="tablist"
                aria-label={t("Ferramentas do estúdio")}
                onKeyDown={(e) => {
                  const at = panels.indexOf(panel);
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 3
                        : e.key === "ArrowRight"
                          ? (at + 1) % 4
                          : e.key === "ArrowLeft"
                            ? (at + 3) % 4
                            : -1;
                  if (next < 0 || disabled) return;
                  e.preventDefault();
                  choosePanel(panels[next]);
                  (
                    e.currentTarget.querySelectorAll('[role="tab"]')[
                      next
                    ] as HTMLButtonElement
                  ).focus();
                }}
              >
                {panels.map((choice) => (
                  <button
                    role="tab"
                    id={tabsId + "-" + choice}
                    aria-controls={tabsId + "-panel"}
                    tabIndex={panel === choice ? 0 : -1}
                    aria-selected={panel === choice}
                    key={choice}
                    onClick={() => choosePanel(choice)}
                  >
                    {
                      {
                        blocks: t("Blocos"),
                        design: t("Estilo"),
                        templates: t("Modelos"),
                        code: t("Avançado"),
                      }[choice]
                    }
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id={tabsId + "-panel"}
                aria-labelledby={tabsId + "-" + panel}
              >
                {panel === "blocks" && (
                  <div className="studio-palette">
                    {SITE_BLOCKS.map((choice) => {
                      const Icon = blockIcons[choice];
                      return (
                        <button
                          key={choice}
                          onClick={() =>
                            insert(
                              choice,
                              chosen?.node.type === "columns"
                                ? chosen.node.id
                                : undefined,
                            )
                          }
                          disabled={disabled || countBlocks(value.site) >= 128}
                        >
                          <Icon size={20} aria-hidden="true" />
                          {t(labels[choice])}
                        </button>
                      );
                    })}
                    <p className="small-note">
                      {t(
                        "Selecciona uma composição para inserir dentro dela. Arrasta para ordenar; as setas funcionam por toque e teclado.",
                      )}
                    </p>
                  </div>
                )}
                {panel === "design" && (
                  <div className="studio-fields">
                    <label>
                      {t("Nome do site")}
                      <input
                        value={value.site.title}
                        maxLength={120}
                        onChange={(e) =>
                          editDoc((s) => {
                            s.title = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("Descrição curta")}
                      <textarea
                        value={value.site.description}
                        maxLength={500}
                        onChange={(e) =>
                          editDoc((s) => {
                            s.description = e.target.value;
                          })
                        }
                        aria-label={t("Descrição curta")}
                      />
                    </label>

                    <label>
                      {t("Tipografia")}
                      <select
                        aria-label={t("Tipografia")}
                        value={value.site.design.font}
                        onChange={(e) =>
                          editDoc((s) => {
                            s.design.font = e.target.value as any;
                          })
                        }
                      >
                        <option value="sans">{t("Contemporânea")}</option>
                        <option value="serif">{t("Editorial")}</option>
                        <option value="mono">{t("Monoespaçada")}</option>
                      </select>
                    </label>
                    <label>
                      {t("Largura do conteúdo")}
                      <select
                        aria-label={t("Largura do conteúdo")}
                        value={value.site.design.width}
                        onChange={(e) =>
                          editDoc((s) => {
                            s.design.width = e.target.value as any;
                          })
                        }
                      >
                        <option value="compact">{t("Concentrada")}</option>
                        <option value="standard">{t("Equilibrada")}</option>
                        <option value="wide">{t("Ampla")}</option>
                      </select>
                    </label>
                    <label>
                      {t("Cantos")}
                      <select
                        aria-label={t("Cantos")}
                        value={value.site.design.radius}
                        onChange={(e) =>
                          editDoc((s) => {
                            s.design.radius = e.target.value as any;
                          })
                        }
                      >
                        <option value="sharp">{t("Rectos")}</option>
                        <option value="soft">{t("Suaves")}</option>
                        <option value="round">{t("Redondos")}</option>
                      </select>
                    </label>
                    <label>
                      {t("Cor de detalhe")}
                      <input
                        type="color"
                        value={value.site.design.accent}
                        onChange={(e) =>
                          editDoc((s) => {
                            s.design.accent = e.target.value;
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                {panel === "templates" && (
                  <div className="studio-templates">
                    <p>
                      {t(
                        "Aplicar um modelo substitui a composição. Podes desfazer antes de guardar.",
                      )}
                    </p>
                    {(["journal", "portfolio", "community"] as const).map(
                      (choice) => (
                        <button
                          key={choice}
                          onClick={() => {
                            const next = templateSite(choice, owner);
                            change(next);
                            setPage(next.site.home);
                            setSelected("");
                          }}
                        >
                          <LayoutTemplate size={24} />
                          <strong>
                            {
                              {
                                journal: t("Caderno editorial"),
                                portfolio: t("Portefólio visual"),
                                community: t("Casa da comunidade"),
                              }[choice]
                            }
                          </strong>
                          <span>{t("Duas páginas · composição editável")}</span>
                        </button>
                      ),
                    )}
                  </div>
                )}
                {panel === "code" && (
                  <div className="studio-fields">
                    <p className="small-note">
                      {t(
                        "Edita a estrutura completa em JSON. Apenas blocos, estilos e dados suportados: sem scripts, HTML executável ou CSS arbitrário.",
                      )}
                    </p>
                    <label>
                      {t("Projecto declarativo")}
                      <textarea
                        className="studio-code"
                        aria-label={t("Projecto declarativo")}
                        value={code}
                        maxLength={3_500_000}
                        spellCheck={false}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>
                    <button
                      className="secondary"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(code);
                          if (
                            parsed.format !== "relayloom-site-project" ||
                            parsed.version !== 1 ||
                            Object.keys(parsed).some(
                              (k) =>
                                ![
                                  "format",
                                  "version",
                                  "site",
                                  "theme",
                                  "attachments",
                                ].includes(k),
                            )
                          )
                            throw new Error("Formato de projecto inválido");
                          const next: StudioValue = {
                            site: parsed.site,
                            theme: parsed.theme,
                            attachments: parsed.attachments,
                          };
                          validateStudio(next);
                          change(next);
                          setPage(next.site.home);
                          setSelected("");
                          setFeedback("Projecto validado e aplicado");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Code2 size={16} />
                      {t("Validar e aplicar")}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        try {
                          exportJSON();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Download size={16} />
                      {t("Exportar projecto")}
                    </button>
                  </div>
                )}
              </div>
              <div className="studio-assets">
                <h3>{t("Imagens do site")}</h3>
                <p>
                  {t(
                    "Até quatro imagens e 2 MB no total. Podes reutilizá-las em várias páginas.",
                  )}
                </p>
                <button
                  className="secondary"
                  onClick={() => upload.current?.click()}
                  disabled={disabled}
                >
                  <ImagePlus size={17} /> {t("Adicionar imagens")}
                </button>
                <input
                  hidden
                  ref={upload}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  aria-label={t("Adicionar imagens ao site")}
                  onChange={(e) => void files(e.target.files)}
                  disabled={disabled}
                />
                {value.attachments.map((a, i) => (
                  <div key={i}>
                    <span>{a.name}</span>
                    <button
                      className="icon"
                      aria-label={t("Remover imagem {index}", { index: i + 1 })}
                      onClick={() => {
                        const next = structuredClone(value);
                        next.attachments.splice(i, 1);
                        function remap(nodes: SiteNode[]): SiteNode[] {
                          return nodes.map((n) => ({
                            ...n,
                            ...(n.media
                              ? {
                                  media: n.media
                                    .filter((m) => m.attachment !== i)
                                    .map((m) => ({
                                      ...m,
                                      attachment:
                                        m.attachment > i
                                          ? m.attachment - 1
                                          : m.attachment,
                                    })),
                                }
                              : {}),
                            ...(n.children
                              ? { children: remap(n.children) }
                              : {}),
                          }));
                        }
                        for (const p of next.site.pages)
                          p.blocks = remap(p.blocks);
                        change(next);
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </aside>
          )}
          <div className={"studio-stage studio-viewport-" + viewport}>
            {!preview && (
              <div className="studio-page-meta">
                <label>
                  {t("Nome da página")}
                  <input
                    value={page.title}
                    disabled={disabled}
                    maxLength={80}
                    onChange={(e) =>
                      editDoc((s) => {
                        s.pages.find((p) => p.id === page.id)!.title =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  {t("Endereço da página")}
                  <input
                    value={page.slug}
                    disabled={disabled}
                    maxLength={40}
                    onChange={(e) =>
                      editDoc((s) => {
                        s.pages.find((p) => p.id === page.id)!.slug =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <div
                  className="studio-page-actions"
                  role="group"
                  aria-label={t("Organizar página")}
                >
                  <div className="studio-page-summary">
                    <span className="studio-page-position">
                      {t("Página {index} de {total}", {
                        index: pageIndex + 1,
                        total: value.site.pages.length,
                      })}
                    </span>
                    <button
                      className="text-button"
                      disabled={disabled || page.id === value.site.home}
                      onClick={() =>
                        editDoc((s) => {
                          s.home = page.id;
                        })
                      }
                    >
                      {t("Usar como início")}
                    </button>
                  </div>
                  <div className="studio-page-buttons">
                    <button
                      className="icon"
                      aria-label={t("Mover página para cima")}
                      title={t("Mover página para cima")}
                      disabled={disabled || pageIndex === 0}
                      onClick={() => moveSelectedPage(-1)}
                    >
                      <ArrowUp size={17} />
                    </button>
                    <button
                      className="icon"
                      aria-label={t("Mover página para baixo")}
                      title={t("Mover página para baixo")}
                      disabled={
                        disabled || pageIndex === value.site.pages.length - 1
                      }
                      onClick={() => moveSelectedPage(1)}
                    >
                      <ArrowDown size={17} />
                    </button>
                    <button
                      className="icon"
                      aria-label={t("Duplicar página seleccionada")}
                      title={t("Duplicar página seleccionada")}
                      disabled={
                        disabled ||
                        value.site.pages.length >= SITE_LIMITS.pages ||
                        countBlocks(value.site) + tree.length >
                          SITE_LIMITS.blocks
                      }
                      onClick={duplicateSelectedPage}
                    >
                      <Copy size={17} />
                    </button>
                    <button
                      className="icon"
                      aria-label={t("Eliminar página seleccionada")}
                      title={t("Eliminar página seleccionada")}
                      disabled={disabled || page.id === value.site.home}
                      onClick={deletePage}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </div>
            )}
            <SiteSurface
              site={value.site}
              theme={value.theme}
              pageId={page.id}
              onNavigate={(id) => {
                setPage(id);
                setSelected("");
              }}
            >
              {renderNodes(page.blocks)}
              {!preview && !page.blocks.length && (
                <button
                  className="studio-empty-page"
                  onClick={() => insert("hero")}
                >
                  <Plus size={24} />
                  {t("Começa esta página com uma capa")}
                </button>
              )}
            </SiteSurface>
          </div>
          {!preview && chosen && (
            <aside
              className="studio-inspector"
              aria-label={t("Propriedades do bloco")}
            >
              <div className="section-heading">
                <h3>{t(labels[chosen.node.type])}</h3>
                <button
                  className="icon"
                  aria-label={t("Fechar propriedades do bloco")}
                  onClick={() => setSelected("")}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="studio-fields">
                <label>
                  {t("Mover para composição")}
                  <select
                    aria-label={t("Mover para composição")}
                    value={chosen.parent ?? ""}
                    onChange={(e) =>
                      reparent(selected, e.target.value || undefined)
                    }
                  >
                    <option value="">{t("Raiz da página")}</option>
                    {tree
                      .filter(
                        (x) =>
                          x.node.type === "columns" &&
                          !flatten([chosen.node]).some(
                            (n) => n.node.id === x.node.id,
                          ),
                      )
                      .map((x) => (
                        <option key={x.node.id} value={x.node.id}>
                          {x.node.title ||
                            t("Composição ") +
                              (tree.findIndex((n) => n.node.id === x.node.id) +
                                1)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("Alinhamento")}
                  <select
                    aria-label={t("Alinhamento")}
                    value={chosen.node.style?.align ?? "left"}
                    onChange={(e) =>
                      updateNode(selected, {
                        style: {
                          ...chosen.node.style,
                          align: e.target.value as any,
                        },
                      })
                    }
                  >
                    <option value="left">{t("À esquerda")}</option>
                    <option value="center">{t("Ao centro")}</option>
                    <option value="right">{t("À direita")}</option>
                  </select>
                </label>
                <label>
                  {t("Fundo do bloco")}
                  <select
                    aria-label={t("Fundo do bloco")}
                    value={chosen.node.style?.tone ?? "surface"}
                    onChange={(e) =>
                      updateNode(selected, {
                        style: {
                          ...chosen.node.style,
                          tone: e.target.value as any,
                        },
                      })
                    }
                  >
                    <option value="surface">{t("Natural")}</option>
                    <option value="soft">{t("Suave")}</option>
                    <option value="accent">{t("Com detalhe")}</option>
                  </select>
                </label>
                <label>
                  {t("Espaçamento")}
                  <select
                    aria-label={t("Espaçamento")}
                    value={chosen.node.style?.space ?? "normal"}
                    onChange={(e) =>
                      updateNode(selected, {
                        style: {
                          ...chosen.node.style,
                          space: e.target.value as any,
                        },
                      })
                    }
                  >
                    <option value="compact">{t("Compacto")}</option>
                    <option value="normal">{t("Equilibrado")}</option>
                    <option value="large">{t("Amplo")}</option>
                  </select>
                </label>
                <label>
                  {t("Formato do texto")}
                  <select
                    aria-label={t("Formato do texto")}
                    value={chosen.node.format ?? "plain"}
                    onChange={(e) =>
                      updateNode(selected, { format: e.target.value as any })
                    }
                  >
                    <option value="plain">{t("Texto simples")}</option>
                    <option value="markdown">{t("Markdown seguro")}</option>
                  </select>
                </label>
                {["columns", "gallery"].includes(chosen.node.type) && (
                  <label>
                    {t("Número de colunas")}
                    <select
                      aria-label={t("Número de colunas")}
                      value={chosen.node.style?.columns ?? 2}
                      onChange={(e) =>
                        updateNode(selected, {
                          style: {
                            ...chosen.node.style,
                            columns: Number(e.target.value) as 1 | 2 | 3,
                          },
                        })
                      }
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {["links", "button", "hero", "callout"].includes(
                  chosen.node.type,
                ) && (
                  <label>
                    {t("Ligar a uma página")}
                    <select
                      aria-label={t("Ligar a uma página")}
                      value={
                        chosen.node.url?.startsWith("page:")
                          ? chosen.node.url
                          : ""
                      }
                      onChange={(e) =>
                        updateNode(selected, { url: e.target.value })
                      }
                    >
                      <option value="">{t("Sem ligação interna")}</option>
                      {value.site.pages.map((p) => (
                        <option key={p.id} value={"page:" + p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {chosen.node.type === "posts" && (
                  <label>
                    {t("Publicações visíveis")}
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={chosen.node.limit ?? 6}
                      onChange={(e) =>
                        updateNode(selected, { limit: Number(e.target.value) })
                      }
                    />
                  </label>
                )}
                {["image", "gallery"].includes(chosen.node.type) && (
                  <>
                    <p className="small-note">
                      {t(
                        "Selecciona imagens incluídas neste site. Os bytes seguem com a publicação assinada.",
                      )}
                    </p>
                    {value.attachments.map((a, i) => (
                      <label className="studio-asset-choice" key={i}>
                        <input
                          type="checkbox"
                          checked={
                            chosen.node.media?.some(
                              (m) => m.attachment === i,
                            ) ?? false
                          }
                          onChange={(e) =>
                            updateNode(selected, {
                              media: e.target.checked
                                ? chosen.node.type === "image"
                                  ? [{ attachment: i, alt: a.name }]
                                  : [
                                      ...(chosen.node.media ?? []),
                                      { attachment: i, alt: a.name },
                                    ]
                                : (chosen.node.media ?? []).filter(
                                    (m) => m.attachment !== i,
                                  ),
                            })
                          }
                        />
                        <span>{a.name}</span>
                      </label>
                    ))}
                    {chosen.node.media?.map((m, i) => (
                      <label key={i}>
                        {t("Descrição da imagem")} {i + 1}
                        <input
                          value={m.alt}
                          maxLength={300}
                          onChange={(e) =>
                            updateNode(selected, {
                              media: chosen.node.media!.map((v, at) =>
                                at === i ? { ...v, alt: e.target.value } : v,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </>
                )}
                <button
                  className="secondary"
                  onClick={() => duplicate(selected)}
                >
                  <Copy size={16} />
                  {t("Duplicar bloco")}
                </button>
                <p className="small-note">
                  {chosen.depth} {t("de")} {SITE_LIMITS.depth}{" "}
                  {t(
                    "níveis de composição. A posição pode ser alterada com as setas junto ao bloco.",
                  )}
                </p>
              </div>
            </aside>
          )}
        </div>
      </fieldset>
    </section>
  );
  function renderNodes(nodes: SiteNode[]): React.ReactNode {
    return nodes.map((node, at) => {
      const index = tree.findIndex((x) => x.node.id === node.id) + 1;
      return (
        <section
          key={node.id}
          className={
            nodeClass(node) +
            (!preview ? " editable" : "") +
            (selected === node.id && !preview ? " studio-selected" : "")
          }
          draggable={!preview && !disabled}
          onClick={(e) => {
            if (!preview) {
              e.stopPropagation();
              setSelected(node.id);
            }
          }}
          onDragStart={(e) => {
            e.stopPropagation();
            drag.current = node.id;
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (drag.current && !disabled) drop(drag.current, node.id);
            drag.current = undefined;
          }}
        >
          {!preview && (
            <div className="block-controls">
              <span>
                <GripVertical size={15} />
                {t(labels[node.type])}
              </span>
              <button
                aria-label={t("Mover bloco {index} para cima", {
                  index: index,
                })}
                disabled={at === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  reorder(node.id, -1);
                }}
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label={t("Mover bloco {index} para baixo", {
                  index: index,
                })}
                disabled={at === nodes.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  reorder(node.id, 1);
                }}
              >
                <ArrowDown size={15} />
              </button>
              <button
                aria-label={t("Duplicar bloco {index}", { index: index })}
                onClick={(e) => {
                  e.stopPropagation();
                  duplicate(node.id);
                }}
              >
                <Copy size={15} />
              </button>
              <button
                aria-label={t("Eliminar bloco {index}", { index: index })}
                onClick={(e) => {
                  e.stopPropagation();
                  removeNode(node.id);
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
          {preview ? (
            <SiteNodeView
              node={node}
              assets={value.attachments}
              posts={posts}
              onNavigate={setPage}
            />
          ) : (
            <>
              {!["divider", "spacer"].includes(node.type) && (
                <>
                  <input
                    aria-label={t("Título do bloco {index}", { index: index })}
                    value={node.title}
                    maxLength={120}
                    placeholder={t("Título (opcional)")}
                    onChange={(e) =>
                      updateNode(node.id, { title: e.target.value })
                    }
                  />
                  {node.type !== "columns" && (
                    <textarea
                      aria-label={t("Texto do bloco {index}", { index: index })}
                      value={node.body}
                      maxLength={4000}
                      placeholder={
                        node.format === "markdown"
                          ? t("Escreve em **Markdown**…")
                          : t("Escreve algo que seja teu…")
                      }
                      onChange={(e) =>
                        updateNode(node.id, { body: e.target.value })
                      }
                    />
                  )}
                </>
              )}
              {["links", "button"].includes(node.type) && (
                <input
                  aria-label={t("Endereço do bloco {index}", { index: index })}
                  value={node.url ?? ""}
                  placeholder={t(
                    "https://… ou escolhe uma página nas propriedades",
                  )}
                  maxLength={2000}
                  onChange={(e) => updateNode(node.id, { url: e.target.value })}
                />
              )}
              {node.type === "columns" ? (
                <div
                  className="studio-columns"
                  style={
                    {
                      "--columns": node.style?.columns ?? 2,
                    } as React.CSSProperties
                  }
                >
                  {renderNodes(node.children ?? [])}
                  {!node.children?.length && (
                    <button
                      className="studio-add-inner"
                      onClick={(e) => {
                        e.stopPropagation();
                        insert("text", node.id);
                      }}
                    >
                      <Plus size={18} />
                      {t("Adicionar dentro da composição")}
                    </button>
                  )}
                </div>
              ) : (
                ["image", "gallery", "divider", "spacer", "posts"].includes(
                  node.type,
                ) && (
                  <SiteNodeView
                    node={{ ...node, title: "", body: "" }}
                    assets={value.attachments}
                    posts={posts}
                    onNavigate={setPage}
                  />
                )
              )}
            </>
          )}
        </section>
      );
    });
  }
}
