import React, { useState } from "react";
import {
  Check,
  CheckCheck,
  Clock3,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import type { OutboxItem } from "../../node/src/outbox";
import type { PublicIdentity } from "../../../packages/core/src/index";
import "./outbox.css";

export function deliveryLabel(item: OutboxItem): string {
  if (item.status === "expired") return "Prazo terminado";
  if (item.status === "unavailable") return "Conteúdo indisponível";
  if (item.status === "blocked") return "Envio suspenso";
  if (item.status === "superseded") return "Envio interrompido";
  if (
    item.status === "pending" &&
    item.groupEpoch &&
    !item.groupAuthority?.allowed
  )
    return "A confirmar o grupo";
  if (item.readCount === item.recipientCount)
    return item.recipientCount === 1 ? "Lida" : "Lida por todos";
  if (item.readCount)
    return `Lida por ${item.readCount} de ${item.recipientCount}`;
  if (item.receivedCount === item.recipientCount)
    return item.recipientCount === 1 ? "Recebida" : "Recebida por todos";
  if (item.receivedCount)
    return `Recebida por ${item.receivedCount} de ${item.recipientCount}`;
  return "Em espera";
}
function StatusIcon({ item }: { item: OutboxItem }) {
  return ["expired", "unavailable", "blocked", "superseded"].includes(
    item.status,
  ) ? (
    <AlertTriangle size={14} />
  ) : item.readCount ? (
    <CheckCheck size={15} />
  ) : item.receivedCount ? (
    <Check size={15} />
  ) : (
    <Clock3 size={14} />
  );
}
export function DeliveryBadge({
  item,
  onOpen,
}: {
  item: OutboxItem;
  onOpen: () => void;
}) {
  const label = deliveryLabel(item);
  return (
    <button
      type="button"
      className={"delivery-badge " + item.status}
      aria-label={"Estado do envio: " + label}
      onClick={onOpen}
    >
      <StatusIcon item={item} /> {label}
    </button>
  );
}
const when = (at: number) =>
  new Intl.DateTimeFormat("pt-PT", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
export function OutboxPanel({
  entries,
  contacts,
  now,
  busy,
  focusId,
  onRetry,
}: {
  entries: OutboxItem[];
  contacts: PublicIdentity[];
  now: number;
  busy: boolean;
  focusId?: string;
  onRetry: (operationId: string) => Promise<{ outbox: OutboxItem } | undefined>;
}) {
  const [filter, setFilter] = useState("all"),
    [expanded, setExpanded] = useState(focusId ?? ""),
    [limit, setLimit] = useState(30);
  const [feedback, setFeedback] = useState("");
  const pending = entries.filter((e) =>
    ["pending", "blocked"].includes(e.status),
  );
  const filtered = entries
    .filter(
      (e) =>
        filter === "all" ||
        (filter === "pending"
          ? ["pending", "blocked"].includes(e.status)
          : !["pending", "blocked"].includes(e.status)),
    )
    .sort((a, b) =>
      a.id === focusId
        ? -1
        : b.id === focusId
          ? 1
          : b.created - a.created || a.id.localeCompare(b.id),
    );
  return (
    <section
      className="outbox-panel"
      aria-label="Envios guardados neste dispositivo"
    >
      <div className="outbox-intro">
        <ShieldCheck size={23} />
        <div>
          <strong>Guardados aqui. Confirmados por cada pessoa.</strong>
          <p>
            O registo de envio fica cifrado neste dispositivo. Uma confirmação
            de um nó intermédio não significa que a pessoa recebeu a mensagem.
          </p>
        </div>
      </div>
      <div className="outbox-toolbar">
        <span>
          <strong>{pending.length}</strong> à espera de confirmação
        </span>
        <label>
          Mostrar{" "}
          <select
            aria-label="Filtrar envios"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos os envios</option>
            <option value="pending">Em espera</option>
            <option value="closed">Confirmados ou terminados</option>
          </select>
        </label>
      </div>
      {!entries.length && (
        <p className="outbox-empty">
          Ainda não há envios neste registo. As novas mensagens ficam aqui,
          mesmo quando não existe uma ligação.
        </p>
      )}
      {entries.length > 0 && !filtered.length && (
        <p className="outbox-empty">Não há envios neste estado.</p>
      )}
      <div className="outbox-list">
        {filtered.slice(0, limit).map((item) => {
          const open = expanded === item.id;
          const deadline = item.contentExpired
            ? "Prazo do conteúdo terminado"
            : "Prazo do conteúdo: " + when(item.expires);
          return (
            <article
              className={"outbox-card " + item.status}
              key={item.operationId}
              aria-label={"Envio: " + item.preview}
            >
              <button
                type="button"
                className="outbox-card-toggle"
                aria-expanded={open}
                aria-controls={"delivery-" + item.operationId}
                onClick={() => setExpanded(open ? "" : item.id)}
              >
                <span className="outbox-card-main">
                  <span className="outbox-preview">{item.preview}</span>
                  <span className="outbox-time">
                    {when(item.created)} · {item.recipientCount}{" "}
                    {item.recipientCount === 1
                      ? "destinatário"
                      : "destinatários"}
                  </span>
                </span>
                <span className="outbox-status">
                  <span>
                    <StatusIcon item={item} /> {deliveryLabel(item)}
                  </span>
                  <ChevronDown size={16} className={open ? "expanded" : ""} />
                </span>
              </button>
              {open && (
                <div
                  className="outbox-details"
                  id={"delivery-" + item.operationId}
                >
                  <p>
                    {deadline}.{" "}
                    {item.retained
                      ? "Conteúdo verificado disponível neste nó."
                      : "O conteúdo já não está disponível neste nó."}
                  </p>
                  {item.status === "blocked" && (
                    <p>
                      Há um destinatário bloqueado. Não serão iniciadas novas
                      tentativas locais. Cópias ou fragmentos já enviados não
                      podem ser recolhidos.
                    </p>
                  )}
                  {item.groupAuthority?.stop && (
                    <p>
                      O grupo mudou. Este envio não volta a ser tentado. Para
                      enviar uma nova mensagem, reveja os destinatários. As
                      confirmações já recebidas ficam neste registo.
                    </p>
                  )}
                  {item.status === "pending" &&
                    item.groupEpoch &&
                    !item.groupAuthority?.allowed && (
                      <p>
                        À espera de confirmar o estado do grupo. A mensagem
                        continua guardada.
                      </p>
                    )}
                  {item.lastError && (
                    <p className="outbox-error">{item.lastError}</p>
                  )}
                  <ul className="recipient-confirmations">
                    {item.recipients.map((recipient) => (
                      <li key={recipient.id}>
                        <span>
                          {contacts.find((c) => c.id === recipient.id)?.name ??
                            "Identidade " + recipient.id.slice(0, 10)}
                        </span>
                        <span>
                          {recipient.readAt !== undefined
                            ? "Leitura confirmada · " + when(recipient.readAt)
                            : recipient.receivedAt !== undefined
                              ? "Recepção confirmada · " +
                                when(recipient.receivedAt)
                              : "Sem confirmação"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="outbox-attempts">
                    <span>
                      {item.attempts}{" "}
                      {item.attempts === 1
                        ? "tentativa registada"
                        : "tentativas registadas"}
                    </span>
                    {item.status === "pending" && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          busy ||
                          now < item.lastAttemptAt + 2200 ||
                          (!!item.groupEpoch && !item.groupAuthority?.allowed)
                        }
                        onClick={async () => {
                          setFeedback("");
                          const result = await onRetry(item.operationId);
                          if (result)
                            setFeedback(
                              result.outbox.status === "pending"
                                ? "O envio continua guardado. A confirmação depende de uma ligação e do destinatário."
                                : "Estado do envio actualizado.",
                            );
                        }}
                      >
                        <RefreshCw size={14} /> Tentar novamente
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {filtered.length > limit && (
        <button
          type="button"
          className="secondary full"
          onClick={() => setLimit((n) => n + 30)}
        >
          Mostrar mais envios
        </button>
      )}
      <p
        className="outbox-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback}
      </p>
      <p className="outbox-note">
        Este registo conserva até 256 envios e preserva os que continuam
        pendentes. A identificação de repetições depende de o registo original
        ainda existir. O prazo limita novas obtenções de conteúdo. Não apaga
        cópias já recebidas. Uma rede disponível e os limites de armazenamento
        continuam a determinar a entrega.
      </p>
    </section>
  );
}
