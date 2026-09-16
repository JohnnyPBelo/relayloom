import { t, getLanguage } from "./i18n/core";
import React, { useEffect, useRef, useState } from "react";
import { Copy, Link2, ShieldCheck } from "lucide-react";
import type { API } from "./api";

export type WebPeerState = { origin: string; expires: number } | null;
type Invitation = {
  origin: string;
  expires: number;
  token: string;
  endpoint: string;
  version: 1;
};

/** A temporary data-transport capability. Never uses or displays the control URL. */
export function WebInvitation({
  api,
  current,
}: {
  api: API;
  current?: WebPeerState;
}) {
  const [address, setAddress] = useState(""),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!invitation) return;
    const timer = setTimeout(
      () => {
        setInvitation(null);
        setStatus("O convite expirou. Cria outro para voltar a ligar.");
      },
      Math.max(0, invitation.expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [invitation]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(
          (e as Error).message || "Não foi possível concluir a operação.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const active =
    invitation ?? (current && current.expires > Date.now() ? current : null);
  return (
    <details className="web-invitation">
      <summary>{t("Usar a versão web neste dispositivo")}</summary>
      <div className="browser-peer-panel">
        <p>
          {t(
            "Abre o RelayLoom no navegador deste dispositivo e partilha este convite entre as duas aplicações. As mensagens podem seguir pela rede dos teus pares, sem escolheres um meio em cada envio.",
          )}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              let url: URL;
              try {
                url = new URL(address.trim());
              } catch {
                throw new Error("Introduz o endereço completo da versão web.");
              }
              if (
                !["https:", "http:"].includes(url.protocol) ||
                url.username ||
                url.password
              )
                throw new Error("Usa um endereço web sem credenciais.");
              const result = (await api("web-peer", {
                origin: url.origin,
              })) as Invitation;
              if (!alive.current) return;
              setInvitation(result);
              setStatus(
                "Convite criado. Cola-o em Ligar um par, na versão web.",
              );
            });
          }}
        >
          <label>
            {t("Endereço da versão web")}
            <input
              type="url"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              maxLength={2048}
              placeholder="https://…/browser/index.html"
              autoComplete="off"
            />
          </label>
          <button className="primary full" disabled={busy}>
            <Link2 size={17} />
            {active ? t("Renovar convite") : t("Criar convite")}
          </button>
        </form>
        {active && (
          <p className="muted">
            {t("Permitido para")} <strong>{active.origin}</strong> {t("até")}{" "}
            {new Intl.DateTimeFormat(getLanguage(), {
              hour: "2-digit",
              minute: "2-digit",
            }).format(active.expires)}
            {t(". Renovar fecha as ligações do convite anterior.")}
          </p>
        )}
        {invitation && (
          <section className="peer-code">
            <label>
              {t("Convite para a versão web")}
              <textarea
                readOnly
                value={JSON.stringify(invitation)}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={t("Convite para a versão web")}
              />
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(
                    JSON.stringify(invitation),
                  );
                  if (alive.current) setStatus("Convite copiado.");
                })
              }
            >
              <Copy size={16} />
              {t("Copiar convite")}
            </button>
          </section>
        )}
        {active && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("web-peer-stop", {});
                if (!alive.current) return;
                setInvitation(null);
                setStatus(
                  "Convite revogado. As ligações que o usavam foram fechadas.",
                );
              })
            }
          >
            {t("Revogar convite")}
          </button>
        )}
        {status && (
          <p role="status" className="peer-status">
            <ShieldCheck size={16} />
            {t(status)}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {t(error)}
          </p>
        )}
        <p className="muted">
          {t(
            "Este convite permite transportar conteúdo cifrado; não dá acesso à tua identidade nem acrescenta contactos. Bloquear a identidade mantém a ajuda à rede que autorizaste. Para fechar este caminho, revoga o convite. A ligação directa actual está limitada a este dispositivo.",
          )}
        </p>
      </div>
    </details>
  );
}
