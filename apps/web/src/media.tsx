import { t } from "./i18n/core";
import React, { useEffect, useId, useRef, useState } from "react";
import { Mic, Square, X, AudioLines } from "lucide-react";
import type { Attachment } from "../../node/src/node";
import "./media.css";

export interface VoiceRecorderProps {
  /** Receives a local draft attachment. Encryption and publication belong to the caller. */
  onAttachment: (attachment: Attachment) => void | Promise<void>;
  disabled?: boolean;
  /** Can lower, but cannot raise, the 2 MB hard limit. */
  maxBytes?: number;
  /** Can lower, but cannot raise, the two-minute hard limit. */
  maxDurationSeconds?: number;
}
type Phase = "idle" | "requesting" | "recording" | "finishing";
interface Session {
  cancelled: boolean;
  ending: boolean;
  parts: Blob[];
  bytes: number;
  startedAt: number;
  byteLimit: number;
  durationLimit: number;
  limitReached: boolean;
  failure?: string;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  interval?: ReturnType<typeof setInterval>;
  timeout?: ReturnType<typeof setTimeout>;
  reader?: FileReader;
}
const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
];
const length = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
function supportIssue() {
  if (typeof window === "undefined" || !window.isSecureContext)
    return "A gravação de voz requer uma ligação segura ou o nó local neste navegador.";
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  )
    return "Este navegador não permite gravar voz aqui. Podes anexar um ficheiro de áudio já guardado.";
  return "";
}
function captureError(error: unknown) {
  const name =
    error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "O acesso ao microfone não foi autorizado. Podes tentar novamente ou anexar um ficheiro de áudio.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "Não foi encontrado um microfone. Podes anexar um ficheiro de áudio já guardado.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "O microfone está ocupado ou indisponível. Fecha a outra gravação e tenta novamente.";
  if (name === "NotSupportedError")
    return "A captura de microfone não é suportada neste navegador ou ambiente. Podes anexar um ficheiro de áudio já guardado.";
  return "Não foi possível gravar a voz. Tenta novamente ou anexa um ficheiro de áudio.";
}
function release(session: Session, discard = false) {
  clearInterval(session.interval);
  clearTimeout(session.timeout);
  if (discard && session.recorder) {
    session.recorder.ondataavailable = null;
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        /* The tracks are still released below. */
      }
    }
  }
  for (const track of session.stream?.getTracks() ?? []) track.stop();
  if (discard) {
    session.parts = [];
    if (session.reader?.readyState === FileReader.LOADING)
      session.reader.abort();
  }
}

export function VoiceRecorder({
  onAttachment,
  disabled = false,
  maxBytes = 2_000_000,
  maxDurationSeconds = 120,
}: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const active = useRef<Session | undefined>(undefined),
    mounted = useRef(false),
    restoreFocus = useRef(false),
    startButton = useRef<HTMLButtonElement>(null),
    stopButton = useRef<HTMLButtonElement>(null);
  const statusId = useId(),
    errorId = useId();
  const unavailable = supportIssue();
  const byteLimit = Number.isFinite(maxBytes)
    ? Math.max(1, Math.min(2_000_000, Math.floor(maxBytes)))
    : 2_000_000;
  const durationLimit = Number.isFinite(maxDurationSeconds)
    ? Math.max(1, Math.min(120, Math.floor(maxDurationSeconds)))
    : 120;
  const current = (session: Session) =>
    mounted.current && active.current === session && !session.cancelled;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = active.current;
      active.current = undefined;
      if (session) {
        session.cancelled = true;
        release(session, true);
      }
    };
  }, []);
  useEffect(() => {
    if (phase === "recording") stopButton.current?.focus();
    if (phase === "idle" && restoreFocus.current) {
      restoreFocus.current = false;
      startButton.current?.focus();
    }
  }, [phase]);

  function cancel() {
    const session = active.current;
    if (session) {
      session.cancelled = true;
      active.current = undefined;
      release(session, true);
    }
    restoreFocus.current = true;
    setPhase("idle");
    setSeconds(0);
    setError("");
    setStatus("Gravação cancelada. Não foi criado nenhum anexo.");
  }
  function fail(session: Session, message: string) {
    if (!current(session)) {
      release(session, true);
      return;
    }
    active.current = undefined;
    session.cancelled = true;
    release(session, true);
    restoreFocus.current = true;
    setPhase("idle");
    setStatus("");
    setError(message);
  }
  function stop(session: Session, limitReached = false) {
    if (!current(session) || session.ending) return;
    session.ending = true;
    session.limitReached = limitReached;
    clearInterval(session.interval);
    clearTimeout(session.timeout);
    setPhase("finishing");
    setStatus("A preparar o anexo de voz neste dispositivo…");
    try {
      if (!session.recorder || session.recorder.state === "inactive") {
        fail(session, t("A gravação terminou sem áudio. Tenta novamente."));
        return;
      }
      session.recorder.stop();
      // stop() queues the final data event; releasing tracks now ends microphone use immediately.
      for (const track of session.stream?.getTracks() ?? []) track.stop();
    } catch {
      fail(
        session,
        t("Não foi possível terminar a gravação. O microfone foi desligado."),
      );
    }
  }
  async function finish(session: Session) {
    release(session);
    if (!current(session)) return;
    if (session.failure) {
      fail(session, session.failure);
      return;
    }
    const mime = (session.recorder?.mimeType || session.parts[0]?.type || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = (
      {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
      } as Record<string, string>
    )[mime];
    if (!extension) {
      fail(
        session,
        t(
          "O formato gravado não é suportado. Podes anexar outro ficheiro de áudio.",
        ),
      );
      return;
    }
    const blob = new Blob(session.parts, { type: mime });
    session.parts = [];
    if (!blob.size) {
      fail(session, t("A gravação ficou vazia. Tenta novamente."));
      return;
    }
    if (blob.size > session.byteLimit) {
      fail(
        session,
        t(
          "A gravação excedeu o limite do anexo e foi descartada. Grava uma mensagem mais curta.",
        ),
      );
      return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = (session.reader = new FileReader());
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.onabort = () => reject(new Error("Leitura cancelada"));
        reader.readAsDataURL(blob);
      });
      if (!current(session)) return;
      await onAttachment({
        name: `voz-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
        mime,
        data,
      });
      if (!current(session)) return;
      active.current = undefined;
      restoreFocus.current = true;
      setPhase("idle");
      setSeconds(0);
      setError("");
      setStatus(
        session.limitReached
          ? "Limite de duração atingido. Voz adicionada aos anexos; envia a mensagem quando quiseres."
          : "Voz adicionada aos anexos. Envia a mensagem quando quiseres.",
      );
    } catch (e) {
      if (current(session))
        fail(
          session,
          e instanceof Error && e.message
            ? e.message
            : t("Não foi possível adicionar a gravação aos anexos."),
        );
    }
  }
  async function start() {
    if (disabled || active.current || unavailable) return;
    const session: Session = {
      cancelled: false,
      ending: false,
      parts: [],
      bytes: 0,
      startedAt: 0,
      byteLimit,
      durationLimit,
      limitReached: false,
    };
    active.current = session;
    setError("");
    setSeconds(0);
    setPhase("requesting");
    setStatus("À espera de autorização para usar o microfone…");
    try {
      // This is the only microphone request, reached only from the explicit record button.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      session.stream = stream;
      if (!current(session)) {
        release(session, true);
        return;
      }
      for (const track of stream.getAudioTracks())
        track.addEventListener(
          "ended",
          () => {
            if (current(session) && !session.ending)
              fail(
                session,
                t(
                  "O microfone foi desligado. A gravação foi descartada; podes tentar novamente.",
                ),
              );
          },
          { once: true },
        );
      const mimeType = MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) {
        fail(
          session,
          t(
            "Este navegador não tem um formato de gravação de voz suportado. Podes anexar um ficheiro de áudio.",
          ),
        );
        return;
      }
      const recorder = (session.recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64_000,
      }));
      recorder.ondataavailable = (event) => {
        if (!current(session) || !event.data.size) return;
        session.bytes += event.data.size;
        if (session.bytes > session.byteLimit) {
          session.failure = t(
            "A gravação excedeu o limite do anexo e foi descartada. Grava uma mensagem mais curta.",
          );
          session.parts = [];
          stop(session);
          return;
        }
        if (!session.failure) session.parts.push(event.data);
      };
      recorder.onerror = () =>
        fail(
          session,
          t(
            "A gravação falhou. O microfone foi desligado e o áudio foi descartado.",
          ),
        );
      recorder.onstop = () => {
        void finish(session);
      };
      recorder.start(250);
      session.startedAt = performance.now();
      setPhase("recording");
      setStatus(
        "A gravar voz. O áudio fica neste dispositivo até enviares a mensagem.",
      );
      session.interval = setInterval(() => {
        if (!current(session)) return;
        const elapsed = Math.floor(
          (performance.now() - session.startedAt) / 1000,
        );
        setSeconds(Math.min(elapsed, session.durationLimit));
        if (elapsed >= session.durationLimit) stop(session, true);
      }, 250);
      session.timeout = setTimeout(() => {
        if (current(session)) {
          setSeconds(session.durationLimit);
          stop(session, true);
        }
      }, session.durationLimit * 1000);
    } catch (e) {
      fail(session, captureError(e));
    }
  }

  const open = phase !== "idle" || !!status || !!error;
  return (
    <div className="voice-recorder">
      <button
        ref={startButton}
        type="button"
        className="voice-record-button"
        onClick={() => {
          void start();
        }}
        disabled={disabled || phase !== "idle" || !!unavailable}
        aria-label={t("Gravar mensagem de voz")}
        aria-describedby={unavailable ? statusId + "-support" : undefined}
        title={t("Gravar mensagem de voz")}
      >
        <Mic size={21} aria-hidden="true" />
      </button>
      {unavailable && (
        <span
          id={statusId + "-support"}
          className="voice-unavailable"
          role="status"
        >
          {unavailable}
        </span>
      )}
      {open && (
        <section className="voice-panel" aria-label={t("Gravação de voz")}>
          <div className="voice-panel-heading">
            <AudioLines size={19} aria-hidden="true" />
            <strong>
              {phase === "recording"
                ? t("A tua voz, por perto.")
                : phase === "requesting"
                  ? t("Ligar o microfone")
                  : phase === "finishing"
                    ? t("Preparar a gravação")
                    : t("Mensagem de voz")}
            </strong>
            {phase === "idle" && (
              <button
                type="button"
                className="voice-dismiss"
                aria-label={t("Fechar informação da gravação")}
                onClick={() => {
                  setStatus("");
                  setError("");
                }}
              >
                <X size={17} />
              </button>
            )}
          </div>
          <p id={statusId} role="status" aria-live="polite" aria-atomic="true">
            {t(status)}
          </p>
          {error && (
            <p id={errorId} role="alert" className="voice-error">
              {t(error)}
            </p>
          )}
          {phase === "recording" && (
            <>
              <output
                className="voice-duration"
                aria-label={t("Duração da gravação")}
                aria-live="off"
              >
                {length(seconds)}{" "}
                <span>
                  / {length(active.current?.durationLimit ?? durationLimit)}
                </span>
              </output>
              <p className="voice-limit">
                {t("Até")} {Math.round(byteLimit / 1000)}{" "}
                {t("KB. Pára automaticamente ao atingir o limite.")}
              </p>
            </>
          )}
          {(phase === "requesting" || phase === "recording") && (
            <div className="voice-actions">
              {phase === "recording" && (
                <button
                  ref={stopButton}
                  type="button"
                  className="voice-stop"
                  onClick={() => {
                    if (active.current) stop(active.current);
                  }}
                >
                  <Square size={14} aria-hidden="true" /> {t("Parar e anexar")}
                </button>
              )}
              <button type="button" className="voice-cancel" onClick={cancel}>
                <X size={16} aria-hidden="true" /> {t("Cancelar gravação")}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
