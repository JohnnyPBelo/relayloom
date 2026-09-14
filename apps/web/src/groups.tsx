import React, { useEffect, useRef, useState } from "react";
import {
  Pencil,
  Check,
  ChevronRight,
  Clock3,
  LockKeyhole,
  Mail,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { PublicIdentity } from "../../../packages/core/src/index";
import type { GroupAuthorityView } from "../../../packages/groups/src/registry";
import type { GroupSnapshot } from "../../../packages/groups/src/certificates";
import type { NoticeEntry } from "../../../packages/groups/src/notices";
import "./groups.css";

export type GroupAPI = (
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<any>;
export const groupStatus: Record<GroupAuthorityView["status"], string> = {
  active: "Activo",
  "awaiting-proof": "A verificar o convite",
  joining: "A aguardar aprovação",
  removed: "Já não participas",
  left: "Saíste do grupo",
  "card-changed": "Cartão por verificar",
  "awaiting-snapshot": "A obter os membros",
  closed: "Encerrado",
  forked: "Provas em conflito",
  capacity: "Armazenamento limitado",
};
type Data = {
  owner: string;
  selected: string;
  groups: GroupAuthorityView[];
  snapshot: GroupSnapshot | null;
  snapshotHead: string;
  inbox: NoticeEntry[];
  outgoing: NoticeEntry[];
  noticeCount: number;
};

export function useGroupWorkspace(
  owner: string | null,
  selected: string,
  open: boolean,
  api: GroupAPI,
) {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    if (!owner) {
      setData(undefined);
      setError("");
      return;
    }
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const command = (body: unknown) =>
          api("group-command", body, controller.signal);
        const { groups, noticeCount } = await command({ action: "list" });
        const view = (groups as GroupAuthorityView[]).find(
          (g) => g.id === selected,
        );
        const snapshot = view?.head
          ? (
              await command({
                action: "private-state",
                groupId: view.id,
                epochId: view.head.id,
              })
            ).snapshot
          : null;
        const inbox = open
          ? (await command({ action: "notice-list" })).notices
          : [];
        const outgoing = open
          ? (await command({ action: "notice-outbox" })).notices
          : [];
        if (controller.signal.aborted) return;
        setData({
          owner,
          selected,
          groups,
          snapshot,
          snapshotHead: view?.head?.id ?? "",
          inbox,
          outgoing,
          noticeCount: noticeCount ?? 0,
        });
        setError("");
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [owner, selected, open, revision]);
  const current = data?.owner === owner ? data : undefined;
  return {
    groups: current?.groups ?? [],
    snapshot: current?.selected === selected ? current.snapshot : null,
    snapshotHead: current?.selected === selected ? current.snapshotHead : "",
    inbox: current?.inbox ?? [],
    outgoing: current?.outgoing ?? [],
    noticeCount: current?.noticeCount ?? 0,
    error,
    refresh,
  };
}
type Workspace = ReturnType<typeof useGroupWorkspace>;
type Pending = {
  operationId: string;
  body: any;
  success: (result: any) => void | Promise<void>;
};

export function GroupManager({
  workspace,
  identity,
  contacts,
  blocked,
  selected,
  select,
  api,
  close,
  reviewAudience,
  legacy,
  open,
}: {
  workspace: Workspace;
  identity: PublicIdentity;
  contacts: PublicIdentity[];
  blocked: string[];
  selected: string;
  select: (id: string) => void;
  api: GroupAPI;
  close: () => void;
  reviewAudience: () => void;
  legacy: () => void;
  open: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"groups" | "inbox">("groups");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<"leave" | "close" | string>("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, [open]);
  const group = workspace.groups.find((g) => g.id === selected);
  const snapshot =
    workspace.snapshotHead === group?.head?.id ? workspace.snapshot : null;
  const own = group?.creator.id === identity.id;
  const active = group?.status === "active" && !!snapshot;
  useEffect(() => {
    if (active && !own && message.includes("aguardar aprovação"))
      setMessage("Entrada aprovada. Já podes conversar com os membros.");
  }, [active, own]);
  useEffect(() => {
    setChosen([]);
    setConfirm("");
    setRename(null);
  }, [selected, group?.head?.id]);
  async function read(body: unknown) {
    return api("group-command", body);
  }
  async function perform(body: any, success: Pending["success"] = () => {}) {
    if (busy || pending) return;
    const operationId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await read({ ...body, operationId });
      if (!alive.current) return;
      await success(result);
      if (!alive.current) return;
      workspace.refresh();
    } catch (e) {
      if (!alive.current) return;
      setError((e as Error).message);
      setPending({ body, operationId, success });
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    try {
      const { operation } = await read({
        action: "operation",
        operationId: pending.operationId,
      });
      if (!alive.current) return;
      if (operation) {
        const { group } = await read({
          action: "state",
          groupId: operation.groupId,
        });
        // Locking unmounts this workspace. A late state must not run a callback
        // that still closes over the previous conversation and its private draft.
        if (!alive.current) return;
        await pending.success({ operation, group });
        if (!alive.current) return;
        setPending(undefined);
        setError("");
        workspace.refresh();
      } else
        setError(
          "A operação não consta do registo conservado. Revê o estado do grupo antes de preparar outra alteração.",
        );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function dismiss(id: string) {
    setBusy(true);
    setError("");
    try {
      await read({ action: "notice-dismiss", id });
      if (alive.current) workspace.refresh();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const approvals = workspace.inbox.filter(
    (e) =>
      e.notice.kind === "consent" &&
      e.notice.anchor.id === group?.id &&
      e.notice.parent.id === group?.head?.id,
  );
  const invitations = workspace.inbox.filter(
    (e) => e.notice.kind === "invitation",
  );
  const outgoing = workspace.outgoing.filter(
    (e) => e.notice.anchor.id === group?.id,
  );
  const canEdit = !!own && !!active && !pending;
  const commit = (
    members: PublicIdentity[],
    joins: unknown[],
    text = snapshot?.title ?? "",
  ) =>
    perform(
      {
        action: "commit",
        groupId: group!.id,
        expected: group!.head!.id,
        title: text,
        members,
        joins,
      },
      () => {
        setMessage(
          "Membros actualizados. As novas mensagens usam esta versão.",
        );
        setConfirm("");
      },
    );
  return (
    <dialog
      ref={dialog}
      className="group-manager"
      aria-labelledby="groups-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="gm-header">
        <div>
          <span className="eyebrow">AS PESSOAS, COM ESCOLHA</span>
          <h2 id="groups-title">Grupos e convites</h2>
        </div>
        <button className="icon" aria-label="Fechar grupos" onClick={close}>
          <X />
        </button>
      </header>
      <div className="gm-tabs" role="group" aria-label="Área de grupos">
        <button
          aria-pressed={tab === "groups"}
          onClick={() => setTab("groups")}
        >
          <Users size={17} /> Os meus grupos
        </button>
        <button aria-pressed={tab === "inbox"} onClick={() => setTab("inbox")}>
          <Mail size={17} /> Convites <span>{workspace.inbox.length}</span>
        </button>
      </div>
      {(error || workspace.error) && (
        <div className="gm-error" role="alert">
          {error || workspace.error}
        </div>
      )}
      {message && (
        <p className="gm-status" role="status">
          <Check size={16} /> {message}
        </p>
      )}
      {pending && (
        <section className="gm-recovery">
          <strong>Vamos confirmar o resultado</strong>
          <p>
            A resposta pode ter-se perdido. Verifica a alteração antes de a
            repetir.
          </p>
          <button disabled={busy} onClick={() => void recover()}>
            Verificar alteração
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPending(undefined);
              setError("");
              workspace.refresh();
            }}
          >
            Voltar a rever o grupo
          </button>
        </section>
      )}
      {tab === "inbox" ? (
        <div className="gm-inbox">
          {!workspace.inbox.length && (
            <div className="gm-empty">
              <Mail size={32} />
              <h3>Quando alguém te convidar, aparece aqui.</h3>
              <p>
                Receber um convite não te adiciona ao grupo. A entrada depende
                da tua escolha.
              </p>
            </div>
          )}
          {workspace.inbox.map((entry) => {
            const n = entry.notice,
              view = workspace.groups.find((g) => g.id === n.anchor.id),
              invited = n.kind === "invitation";
            const ready =
              invited &&
              view?.head?.id === n.parent.id &&
              !view.pendingConsent &&
              ["awaiting-proof", "joining", "removed", "left"].includes(
                view.status,
              );
            return (
              <article className="gm-invitation" key={n.certificate.id}>
                <div className="gm-symbol">
                  <UserPlus size={23} />
                </div>
                <div className="gm-invitation-body">
                  <span className="eyebrow">
                    {invited
                      ? "CONVITE PRIVADO"
                      : n.kind === "consent"
                        ? "PEDIDO DE ENTRADA"
                        : "PEDIDO DE SAÍDA"}
                  </span>
                  <h3>
                    {invited
                      ? `Convite de ${n.anchor.body.creator.name}`
                      : n.member.name}
                  </h3>
                  <p>
                    {view?.title || `Grupo de ${n.anchor.body.creator.name}`}
                  </p>
                  <small>
                    <ShieldCheck size={13} /> Identidade assinada ·{" "}
                    {n.anchor.body.creator.id.slice(0, 12)}
                  </small>
                  {invited && (
                    <p className="muted">
                      {n.parent.body.members.length}{" "}
                      {n.parent.body.members.length === 1
                        ? "membro nesta versão"
                        : "membros nesta versão"}
                      . A entrada não dá acesso às mensagens anteriores.
                    </p>
                  )}
                  <div className="gm-actions">
                    {invited &&
                      !view?.pendingConsent &&
                      view?.status !== "active" && (
                        <button
                          className="primary"
                          disabled={busy || !!pending}
                          onClick={() => {
                            if (ready)
                              void perform(
                                {
                                  action: "accept",
                                  groupId: n.anchor.id,
                                  expected: n.parent.id,
                                },
                                () => {
                                  select(n.anchor.id);
                                  setMessage(
                                    "Convite aceite. A aguardar aprovação do criador.",
                                  );
                                },
                              );
                            else
                              void perform(
                                { action: "notice-open", id: n.certificate.id },
                                () => {
                                  select(n.anchor.id);
                                  setMessage(
                                    "Convite aberto. A verificar a versão do grupo.",
                                  );
                                },
                              );
                          }}
                        >
                          {ready ? "Aceitar convite" : "Verificar convite"}
                        </button>
                      )}
                    {view?.pendingConsent && invited && (
                      <span className="gm-status">
                        <Clock3 size={15} /> A aguardar aprovação
                      </span>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => {
                        select(n.anchor.id);
                        setTab("groups");
                      }}
                    >
                      Ver grupo
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void dismiss(n.certificate.id)}
                    >
                      {invited &&
                      !view?.pendingConsent &&
                      view?.status !== "active"
                        ? "Recusar convite"
                        : "Arquivar aviso"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="gm-layout">
          <aside className="gm-list">
            <button
              className="primary full"
              onClick={() => {
                setCreating(true);
                setTitle("");
              }}
              disabled={busy || !!pending}
            >
              <Plus size={17} /> Criar grupo
            </button>
            {workspace.groups.map((g) => (
              <button
                className={`gm-group ${g.id === selected && !creating ? "selected" : ""}`}
                key={g.id}
                onClick={() => {
                  select(g.id);
                  setCreating(false);
                }}
              >
                <span>
                  <strong>{g.title || `Grupo de ${g.creator.name}`}</strong>
                  <small>{groupStatus[g.status]}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!workspace.groups.length && (
              <p className="muted">
                O teu próximo ponto de encontro começa aqui.
              </p>
            )}
            <button className="text-button gm-legacy" onClick={legacy}>
              Lista de leitores fixos
            </button>
          </aside>
          <section className="gm-detail">
            {creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform({ action: "create", title }, (r) => {
                    select(r.group.id);
                    setCreating(false);
                    setMessage(
                      "Grupo criado. Agora podes convidar as tuas pessoas.",
                    );
                  });
                }}
              >
                <span className="eyebrow">UM NOVO PONTO DE ENCONTRO</span>
                <h3>Quem queres ter por perto?</h3>
                <p>
                  Cria o grupo e envia convites privados. Cada pessoa escolhe
                  entrar; depois aprovas os membros desta versão.
                </p>
                <label>
                  Nome do novo grupo
                  <input
                    required
                    maxLength={80}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Pessoas por perto"
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !!pending || !title.trim()}
                >
                  <Plus size={17} /> Criar e convidar
                </button>
              </form>
            ) : !group ? (
              <div className="gm-empty">
                <Users size={36} />
                <h3>Um espaço escolhido por todos.</h3>
                <p>
                  Selecciona um grupo para rever os membros, ou abre os teus
                  convites.
                </p>
              </div>
            ) : (
              <>
                <div className="gm-group-title">
                  <div>
                    <span className="eyebrow">
                      {own
                        ? "CRIADO POR TI"
                        : `CRIADO POR ${group.creator.name.toUpperCase()}`}
                    </span>
                    <h3>{group.title || "Grupo privado"}</h3>
                  </div>
                  <span className={`gm-state ${active ? "active" : ""}`}>
                    {groupStatus[group.status]}
                  </span>
                </div>
                {canEdit && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setRename(snapshot!.title)}
                  >
                    <Pencil size={14} /> Editar nome do grupo
                  </button>
                )}
                {rename !== null && canEdit && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commit(snapshot!.members, [], rename);
                    }}
                  >
                    <label>
                      Novo nome do grupo
                      <input
                        required
                        maxLength={80}
                        value={rename}
                        onChange={(e) => setRename(e.target.value)}
                      />
                    </label>
                    <div className="gm-actions">
                      <button
                        className="primary"
                        disabled={busy || !rename.trim()}
                      >
                        Guardar nome
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRename(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
                <p className="gm-version">
                  <ShieldCheck size={15} />{" "}
                  {group.head
                    ? `Versão ${group.head.body.number} verificada neste dispositivo`
                    : "À espera das provas do grupo"}
                </p>
                {!active && (
                  <p className="gm-explainer">
                    {group.status === "joining"
                      ? "A tua escolha está assinada. O criador ainda precisa de aprovar a entrada."
                      : group.status === "closed"
                        ? "Este grupo foi encerrado. O histórico já recebido continua sujeito à tua retenção local."
                        : group.status === "left" || group.status === "removed"
                          ? "Não são enviados novos conteúdos em teu nome neste grupo."
                          : "A composição fica disponível quando os membros e a versão estiverem verificados."}
                  </p>
                )}
                {snapshot && (
                  <>
                    <div className="gm-section-title">
                      <h4>Membros desta versão</h4>
                      <span>{snapshot.members.length}</span>
                    </div>
                    <ul className="gm-members">
                      {snapshot.members.map((member) => (
                        <li key={member.id}>
                          <span className="gm-avatar">
                            {member.name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>
                              {member.name}
                              {member.id === identity.id ? " · Tu" : ""}
                            </strong>
                            <small>
                              {member.id === group.creator.id
                                ? "Criador · assina as alterações"
                                : member.id.slice(0, 12)}
                            </small>
                          </div>
                          {canEdit && member.id !== identity.id && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => setConfirm(member.id)}
                            >
                              Remover
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {own && active && (
                  <>
                    <form
                      className="gm-invite-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const card = contacts.find(
                          (c) =>
                            c.id ===
                            new FormData(e.currentTarget).get("contact"),
                        );
                        if (card)
                          void perform(
                            {
                              action: "invite",
                              groupId: group.id,
                              expected: group.head!.id,
                              card,
                            },
                            () =>
                              setMessage(
                                "Convite guardado. Segue quando existir um caminho.",
                              ),
                          );
                      }}
                    >
                      <label>
                        Convidar uma pessoa
                        <select
                          name="contact"
                          required
                          disabled={busy || !!pending}
                        >
                          <option value="">Escolher contacto verificado</option>
                          {contacts
                            .filter(
                              (c) =>
                                !blocked.includes(c.id) &&
                                !snapshot?.members.some((m) => m.id === c.id),
                            )
                            .map((c) => (
                              <option value={c.id} key={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button className="primary" disabled={busy || !!pending}>
                        <UserPlus size={16} /> Enviar convite
                      </button>
                    </form>
                    <p className="muted">
                      {outgoing.length
                        ? `${outgoing.length} ${outgoing.length === 1 ? "convite" : "convites"} à espera de resposta nesta versão.`
                        : "Os convites usam o cartão público que verificaste no contacto."}
                    </p>
                    {!!approvals.length && (
                      <section className="gm-approvals">
                        <h4>Pessoas que aceitaram</h4>
                        <p>
                          Revê as entradas em conjunto. Uma alteração de membros
                          requer convites da nova versão.
                        </p>
                        {approvals.map((e) => (
                          <label
                            className="check-option"
                            key={e.notice.certificate.id}
                          >
                            <input
                              type="checkbox"
                              checked={chosen.includes(e.notice.certificate.id)}
                              onChange={(event) =>
                                setChosen((prev) =>
                                  event.target.checked
                                    ? [...prev, e.notice.certificate.id]
                                    : prev.filter(
                                        (id) => id !== e.notice.certificate.id,
                                      ),
                                )
                              }
                            />
                            {e.notice.member.name}
                          </label>
                        ))}
                        <button
                          className="primary"
                          disabled={busy || !!pending || !chosen.length}
                          onClick={() => {
                            const values = approvals.filter((e) =>
                              chosen.includes(e.notice.certificate.id),
                            );
                            void commit(
                              [
                                ...snapshot!.members,
                                ...values.map((e) => e.notice.member),
                              ],
                              values.map((e) => e.notice.certificate),
                            );
                          }}
                        >
                          Aprovar entradas
                        </button>
                      </section>
                    )}
                  </>
                )}
                {confirm && (
                  <section
                    className="gm-confirm"
                    role="group"
                    aria-label="Confirmar alteração"
                  >
                    <strong>
                      {confirm === "close"
                        ? "Encerrar este grupo?"
                        : confirm === "leave"
                          ? "Sair deste grupo?"
                          : "Remover esta pessoa?"}
                    </strong>
                    <p>
                      As chaves e cópias já entregues não podem ser recolhidas.
                      A alteração afecta novos envios.
                    </p>
                    <button
                      disabled={busy || !!pending}
                      className="primary"
                      onClick={() => {
                        if (confirm === "close")
                          void perform(
                            {
                              action: "close",
                              groupId: group.id,
                              expected: group.head!.id,
                            },
                            () => {
                              setConfirm("");
                              setMessage("Grupo encerrado.");
                            },
                          );
                        else if (confirm === "leave")
                          void perform(
                            { action: "leave", groupId: group.id },
                            () => {
                              setConfirm("");
                              setMessage(
                                "Saíste. Os teus novos envios estão interrompidos.",
                              );
                            },
                          );
                        else
                          void commit(
                            snapshot!.members.filter((m) => m.id !== confirm),
                            [],
                          );
                      }}
                    >
                      Confirmar{" "}
                      {confirm === "close"
                        ? "encerramento"
                        : confirm === "leave"
                          ? "saída"
                          : "remoção"}
                    </button>
                    <button disabled={busy} onClick={() => setConfirm("")}>
                      Cancelar
                    </button>
                  </section>
                )}
                <div className="gm-bottom-actions">
                  {active && (
                    <button
                      className="primary"
                      disabled={busy || !!pending}
                      onClick={() => {
                        reviewAudience();
                        close();
                      }}
                    >
                      <Check size={16} /> Usar membros actuais
                    </button>
                  )}
                  {own && group.status === "active" && (
                    <button
                      disabled={busy || !!pending}
                      onClick={() => setConfirm("close")}
                    >
                      Encerrar grupo
                    </button>
                  )}
                  {!own && !group.locallyLeft && group.status !== "closed" && (
                    <button
                      disabled={busy || !!pending}
                      onClick={() => setConfirm("leave")}
                    >
                      Sair do grupo
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      <footer className="gm-footer">
        <LockKeyhole size={14} /> Convites privados. Entrada escolhida.
        Alterações assinadas pelo criador.
      </footer>
    </dialog>
  );
}
