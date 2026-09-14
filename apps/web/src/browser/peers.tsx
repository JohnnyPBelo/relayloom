import React, { useState } from "react";
import { ArrowRight, Copy, Link2, ShieldCheck } from "lucide-react";
import type { API } from "../api";
import "./peers.css";
export function BrowserPeerPanel({ api }: { api: API }) {
  const [tab, setTab] = useState<"offer" | "answer" | "native">("offer"),
    [input, setInput] = useState(""),
    [output, setOutput] = useState(""),
    [handle, setHandle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
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
        Abre um caminho directo para outro dispositivo. Troca os códigos por um
        canal em que confies.
      </p>
      <div className="peer-tabs" role="tablist" aria-label="Tipo de ligação">
        <button
          role="tab"
          aria-selected={tab === "offer"}
          disabled={busy}
          onClick={() => {
            setTab("offer");
            setError("");
          }}
        >
          Criar ligação
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
          Receber código
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
          App instalada
        </button>
      </div>
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
              Criar código de ligação
            </button>
          ) : (
            <p className="muted">
              Partilha o código abaixo. Depois cola a resposta recebida para
              concluir.
            </p>
          )}
          {handle && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api("peer-accept", { handle, signal: input });
                  setStatus("Ligação estabelecida. Já podem trocar conteúdo.");
                });
              }}
            >
              <label>
                Resposta do outro dispositivo
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  required
                  maxLength={64000}
                />
              </label>
              <button className="primary full" disabled={busy}>
                <ArrowRight size={17} />
                Concluir ligação
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
              setOutput(result.signal);
              setStatus("Devolve esta resposta a quem criou a ligação.");
            });
          }}
        >
          <label>
            Código de ligação recebido
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={64000}
            />
          </label>
          <button className="primary full" disabled={busy}>
            Criar resposta
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
            O convite é emitido pela app instalada para esta página:{" "}
            <strong>{location.origin}</strong>. Na app instalada neste
            dispositivo, abre A rede → Ligar um par → Usar a versão web neste
            dispositivo.
          </p>
          <label>
            Convite da aplicação instalada
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={8192}
            />
          </label>
          <button className="primary full" disabled={busy}>
            Ligar ao nó
          </button>
        </form>
      )}
      {output && (
        <section className="peer-code">
          <label>
            Código para partilhar
            <textarea
              readOnly
              value={output}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(output);
                setStatus("Código copiado.");
              })
            }
          >
            <Copy size={16} />
            Copiar código
          </button>
        </section>
      )}
      {status && (
        <p className="peer-status" role="status">
          <ShieldCheck size={16} />
          {status}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        Um código de rede não adiciona contactos nem dá acesso ao cofre. Uma
        ligação pode precisar de um caminho compatível entre redes; não existe
        um servidor de sinalização obrigatório.
      </p>
    </div>
  );
}
