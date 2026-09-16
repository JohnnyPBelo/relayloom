import { t, getLanguage } from "../i18n/core";
import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, Link2, ShieldCheck } from "lucide-react";
import type { RtcTransportPeer } from "../../../../packages/browser/src/rtc";
import type { API } from "../api";
import "./peers.css";
export function BrowserPeerPanel({ api }: { api: API }) {
  type Mode = "offer" | "answer" | "native";
  type Draft = {
    input: string;
    output: string;
    handle: string;
    status: string;
  };
  const empty = (): Draft => ({
    input: "",
    output: "",
    handle: "",
    status: "",
  });
  const [tab, setTab] = useState<Mode>("offer"),
    [drafts, setDrafts] = useState<Record<Mode, Draft>>({
      offer: empty(),
      answer: empty(),
      native: empty(),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [diagnostic, setDiagnostic] = useState<
      | (Partial<RtcTransportPeer<unknown>["diagnostics"]> & {
          unavailable?: boolean;
        })
      | null
    >(null),
    [copied, setCopied] = useState(false);
  const mounted = useRef(true),
    pendingHandles = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const handle of pendingHandles.current)
        void api("peer-close-pending", { handle }).catch(() => {});
      pendingHandles.current.clear();
    };
  }, [api]);
  const { input, output, handle, status } = drafts[tab];
  const update = (value: Partial<Draft>) =>
    setDrafts((old) => ({ ...old, [tab]: { ...old[tab], ...value } }));
  const setInput = (input: string) => update({ input });
  const setOutput = (output: string) => update({ output });
  const setHandle = (handle: string) => {
    if (!mounted.current) {
      void api("peer-close-pending", { handle }).catch(() => {});
      return;
    }
    pendingHandles.current.add(handle);
    update({ handle });
  };
  const setStatus = (status: string) => update({ status });
  useEffect(() => {
    setDiagnostic(null);
    setCopied(false);
    if (!handle || tab === "native") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await api("peer-status", { handle });
        if (active) setDiagnostic(value);
      } catch {
        if (active) setDiagnostic({ unavailable: true });
      }
      if (active) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, handle, tab]);
  const connected = diagnostic?.channel === "open" && !diagnostic?.closed;
  const ended = diagnostic?.closed || diagnostic?.unavailable;
  const connectionStatus = connected
    ? t("Ligação estabelecida. Já podem trocar conteúdo.")
    : ended
      ? t(
          "A ligação terminou. As mensagens em espera continuam guardadas; cria uma nova ligação.",
        )
      : diagnostic?.signalling === "have-local-offer"
        ? t(
            "À espera da resposta do outro dispositivo. Falta concluir a ligação aqui.",
          )
        : handle && tab === "answer"
          ? t(
              "Resposta criada. Falta colá-la no primeiro dispositivo e concluir a ligação.",
            )
          : handle && diagnostic?.ice === "checking"
            ? t("A procurar um caminho entre os dispositivos…")
            : status;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="browser-peer-panel">
      <p>
        {t(
          "Liga os dois dispositivos com um código e uma resposta. Mantém as páginas abertas e partilha os códigos por um canal de confiança.",
        )}
      </p>
      <details className="peer-guide">
        <summary>{t("Como ligar em três passos")}</summary>
        <p>
          {t("Começa na mesma rede Wi-Fi, sem isolamento entre dispositivos.")}
        </p>
        <ol className="peer-steps">
          <li>
            <strong>{t("Primeiro dispositivo")}</strong>{" "}
            {t("— cria e partilha o código de ligação.")}
          </li>
          <li>
            <strong>{t("Segundo dispositivo")}</strong>{" "}
            {t("— abre Receber código, cola-o e cria a resposta.")}
          </li>
          <li>
            <strong>{t("Primeiro dispositivo")}</strong>{" "}
            {t("— cola a resposta e conclui. Aguarda a confirmação nos dois.")}
          </li>
        </ol>
      </details>
      <div
        className="peer-tabs"
        role="tablist"
        aria-label={t("Tipo de ligação")}
      >
        <button
          role="tab"
          aria-selected={tab === "offer"}
          disabled={busy}
          onClick={() => {
            setTab("offer");
            setError("");
          }}
        >
          {t("Criar ligação")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "answer"}
          disabled={busy}
          onClick={() => {
            setTab("answer");
            setError("");
          }}
        >
          {t("Receber código")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "native"}
          disabled={busy}
          onClick={() => {
            setTab("native");
            setError("");
          }}
        >
          {t("App instalada")}
        </button>
      </div>
      {output && (
        <section className="peer-code">
          <label>
            {t("Código para partilhar")}
            <textarea
              readOnly
              value={output}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t("Código para partilhar")}
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(output);
                setCopied(true);
              })
            }
          >
            <Copy size={16} />
            {t("Copiar código")}
          </button>
        </section>
      )}
      {tab === "offer" && (
        <>
          {!handle ? (
            <button
              className="primary full"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api("peer-offer");
                  setHandle(result.handle);
                  setOutput(result.signal);
                  setStatus("Partilha este código com o outro dispositivo.");
                })
              }
            >
              <Link2 size={17} />
              {t("Criar código de ligação")}
            </button>
          ) : (
            <p className="muted">
              {t(
                "Partilha este código. Depois cola a resposta recebida para concluir.",
              )}
            </p>
          )}
          {handle && !connected && !ended && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api("peer-accept", { handle, signal: input });
                  setStatus(
                    "Resposta aceite. A confirmar o estado da ligação…",
                  );
                });
              }}
            >
              <label>
                {t("Resposta do outro dispositivo")}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  required
                  maxLength={64000}
                  aria-label={t("Resposta do outro dispositivo")}
                />
              </label>
              <button className="primary full" disabled={busy}>
                <ArrowRight size={17} />
                {t("Concluir ligação")}
              </button>
            </form>
          )}
        </>
      )}
      {tab === "answer" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await api("peer-answer", { signal: input });
              setHandle(result.handle);
              setOutput(result.signal);
              setStatus("Devolve esta resposta a quem criou a ligação.");
            });
          }}
        >
          <label>
            {t("Código de ligação recebido")}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={64000}
              aria-label={t("Código de ligação recebido")}
            />
          </label>
          <button className="primary full" disabled={busy || !!handle}>
            {t("Criar resposta")}
          </button>
        </form>
      )}
      {tab === "native" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api("peer-websocket", { invitation: JSON.parse(input) });
              setStatus("Ligação ao nó estabelecida.");
            });
          }}
        >
          <p className="muted">
            {t("O convite é emitido pela app instalada para esta página:")}{" "}
            <strong>{location.origin}</strong>
            {t(
              ". Na app instalada neste dispositivo, abre A rede → Ligar um par → Usar a versão web neste dispositivo.",
            )}
          </p>
          <label>
            {t("Convite da aplicação instalada")}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={8192}
              aria-label={t("Convite da aplicação instalada")}
            />
          </label>
          <button className="primary full" disabled={busy}>
            {t("Ligar ao nó")}
          </button>
        </form>
      )}
      {copied && <p role="status">{t("Código copiado.")}</p>}
      {connectionStatus && (
        <p className="peer-status" role="status">
          <ShieldCheck size={16} />
          {t(connectionStatus)}
        </p>
      )}
      {handle && tab !== "native" && !connected && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api("peer-close", { handle });
              pendingHandles.current.delete(handle);
              update(empty());
              setDiagnostic(null);
            })
          }
        >
          {t("Recomeçar ligação")}
        </button>
      )}
      {diagnostic && (
        <details className="peer-diagnostic">
          <summary>{t("Diagnóstico desta ligação")}</summary>
          <p>
            {t(
              "Sem mensagens, chaves, códigos de ligação ou endereços de rede.",
            )}
          </p>
          <pre aria-label={t("Diagnóstico sem dados pessoais")}>
            {JSON.stringify({ version: 1, ...diagnostic }, null, 2)}
          </pre>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(
                  JSON.stringify({ version: 1, ...diagnostic }, null, 2),
                );
              })
            }
          >
            <Copy size={16} /> {t("Copiar diagnóstico")}
          </button>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      <p className="muted">
        {t(
          "Um código de rede não adiciona contactos nem dá acesso ao cofre. Uma ligação precisa de um caminho compatível. Nesta versão, redes diferentes ou Wi-Fi com isolamento podem impedir a ligação: ainda não há travessia automática de NAT. Bluetooth directo entre browsers não está disponível.",
        )}
      </p>
    </div>
  );
}
