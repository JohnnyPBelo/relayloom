import { t } from "./i18n/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import "./notifications.css";

export interface NotificationMessage {
  id: string;
  kind: string;
  public: boolean;
  author: { id: string };
}
export interface PrivateNotificationOptions {
  identityId: string | null;
  /** Supply only the application's verified display objects, not unvalidated network payloads. */
  messages: readonly NotificationMessage[];
  knownIds?: readonly string[];
  locked?: boolean;
}
export interface PrivateNotificationController {
  enabled: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  busy: boolean;
  status: string;
  canEnable: boolean;
  enable: () => Promise<void>;
  disable: () => void;
}
const COOLDOWN_MS = 10_000;
const MAX_SEEN = 4096;
const GENERIC_BODY =
  "Tens novas mensagens privadas. Abre o RelayLoom para as ler.";
const preferenceKey = (id: string) => "relayloom-private-notifications:" + id;
function supported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof Notification === "function" &&
    typeof Notification.requestPermission === "function"
  );
}
function permission(): NotificationPermission | "unsupported" {
  return supported() ? Notification.permission : "unsupported";
}
function preference(id: string | null) {
  try {
    return !!id && localStorage.getItem(preferenceKey(id)) === "on";
  } catch {
    return false;
  }
}
function savePreference(id: string, enabled: boolean) {
  try {
    localStorage.setItem(preferenceKey(id), enabled ? "on" : "off");
    return true;
  } catch {
    return false;
  }
}

export function usePrivateMessageNotifications({
  identityId,
  messages,
  knownIds,
  locked = false,
}: PrivateNotificationOptions): PrivateNotificationController {
  const activeIdentity = !locked ? identityId : null;
  const [settings, setSettings] = useState({
    identity: activeIdentity,
    enabled: preference(activeIdentity),
  });
  const [allowed, setAllowed] = useState<
    NotificationPermission | "unsupported"
  >(permission);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const runtime = useRef({
    identity: activeIdentity,
    optedIn: preference(activeIdentity),
    generation: 0,
    mounted: false,
  });
  const baseline = useRef<{
    identity: string | null;
    initialized: boolean;
    seen: Set<string>;
  }>({ identity: null, initialized: false, seen: new Set() });
  const visible = useRef<Notification | undefined>(undefined);
  const pending = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    lastAttempt = useRef<number | null>(null);

  const closeVisible = useCallback(() => {
    const notice = visible.current;
    visible.current = undefined;
    if (notice) {
      notice.onclick = null;
      notice.onclose = null;
      notice.onerror = null;
      try {
        notice.close();
      } catch {
        /* Already closed or unsupported close operation. */
      }
    }
  }, []);
  const clearPending = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = false;
    lastAttempt.current = null;
    closeVisible();
  }, [closeVisible]);
  const pauseAfterFailure = useCallback(
    (message: string) => {
      const current = runtime.current;
      if (!current.mounted || !current.identity) return;
      current.optedIn = false;
      savePreference(current.identity, false);
      clearPending();
      setSettings({ identity: current.identity, enabled: false });
      setStatus(message);
    },
    [clearPending],
  );

  useEffect(() => {
    runtime.current.mounted = true;
    return () => {
      runtime.current.mounted = false;
      runtime.current.generation++;
      runtime.current.optedIn = false;
      clearPending();
    };
  }, [clearPending]);
  useEffect(() => {
    const current = runtime.current;
    current.generation++;
    current.identity = activeIdentity;
    current.optedIn = preference(activeIdentity);
    clearPending();
    baseline.current = {
      identity: activeIdentity,
      initialized: false,
      seen: new Set(),
    };
    setSettings({ identity: activeIdentity, enabled: current.optedIn });
    setAllowed(permission());
    setBusy(false);
    setStatus("");
  }, [activeIdentity, clearPending]);

  const show = useCallback(() => {
    timer.current = undefined;
    const current = runtime.current;
    if (
      !current.mounted ||
      !current.identity ||
      !current.optedIn ||
      !pending.current
    )
      return;
    const actual = permission();
    if (actual !== "granted") {
      setAllowed(actual);
      pending.current = false;
      closeVisible();
      return;
    }
    const wait =
      lastAttempt.current === null
        ? 0
        : Math.max(0, COOLDOWN_MS - (Date.now() - lastAttempt.current));
    if (wait) {
      timer.current = setTimeout(show, wait);
      return;
    }
    pending.current = false;
    lastAttempt.current = Date.now();
    closeVisible();
    const identity = current.identity,
      generation = current.generation;
    try {
      // No sender, conversation, message, identity ID, or remote resource enters the native notice.
      const notice = new Notification("RelayLoom", {
        body: t(GENERIC_BODY),
        tag: "relayloom-private-message",
        silent: true,
      });
      visible.current = notice;
      notice.onclick = () => {
        if (
          runtime.current.identity === identity &&
          runtime.current.generation === generation &&
          runtime.current.optedIn
        )
          window.focus();
        if (visible.current === notice) closeVisible();
      };
      notice.onclose = () => {
        if (visible.current === notice) visible.current = undefined;
      };
      notice.onerror = () => {
        if (
          runtime.current.identity === identity &&
          runtime.current.generation === generation
        )
          pauseAfterFailure(
            t(
              "O navegador não conseguiu mostrar o aviso. As notificações foram desactivadas nesta identidade.",
            ),
          );
      };
    } catch {
      pauseAfterFailure(
        t(
          "Este navegador não conseguiu criar uma notificação. Podes continuar a ler as mensagens na aplicação.",
        ),
      );
    }
  }, [closeVisible, pauseAfterFailure]);

  useEffect(() => {
    const ids = messages.map((message) => message.id),
      current = runtime.current;
    if (!activeIdentity || current.identity !== activeIdentity) return;
    if (
      !baseline.current.initialized ||
      baseline.current.identity !== activeIdentity
    ) {
      baseline.current = {
        identity: activeIdentity,
        initialized: true,
        seen: new Set([...(knownIds ?? []), ...ids].slice(-MAX_SEEN)),
      };
      return;
    }
    // The node's display store is bounded. If an integration supplies an oversized snapshot,
    // silently re-baseline rather than repeatedly notifying evicted IDs from that snapshot.
    if (ids.length > MAX_SEEN) {
      baseline.current.seen = new Set(
        [...(knownIds ?? []), ...ids].slice(-MAX_SEEN),
      );
      return;
    }
    const seen = baseline.current.seen;
    let received = false;
    for (const message of messages) {
      if (
        !seen.has(message.id) &&
        message.kind === "message" &&
        message.public === false &&
        message.author.id !== activeIdentity
      )
        received = true;
      seen.add(message.id);
    }
    for (const id of knownIds ?? []) seen.add(id);
    const present = new Set([...(knownIds ?? []), ...ids]);
    for (const id of seen) {
      if (seen.size <= MAX_SEEN) break;
      if (!present.has(id)) seen.delete(id);
    }
    if (received && current.optedIn && permission() === "granted") {
      pending.current = true;
      if (!timer.current) show();
    }
  }, [activeIdentity, messages, knownIds, show]);

  useEffect(() => {
    const sync = () => {
      if (!runtime.current.mounted) return;
      const actual = permission();
      setAllowed(actual);
      if (actual !== "granted") {
        clearPending();
      }
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [clearPending]);

  const enable = useCallback(async () => {
    const current = runtime.current,
      identity = current.identity;
    if (!current.mounted || !identity || busy) return;
    if (!supported()) {
      setAllowed("unsupported");
      setStatus(
        "Este navegador não disponibiliza notificações aqui. As mensagens continuam disponíveis na aplicação.",
      );
      return;
    }
    const generation = ++current.generation;
    setBusy(true);
    setStatus("À espera da tua escolha no pedido do navegador…");
    try {
      // Called only by the explicit settings button. Never request permission from an effect.
      const result =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      if (
        !current.mounted ||
        current.identity !== identity ||
        current.generation !== generation
      )
        return;
      setAllowed(result);
      if (result !== "granted") {
        current.optedIn = false;
        savePreference(identity, false);
        setSettings({ identity, enabled: false });
        clearPending();
        setStatus(
          result === "denied"
            ? "O navegador bloqueou as notificações. Não serão pedidos novos avisos enquanto a permissão estiver bloqueada."
            : "As notificações continuam desactivadas. Podes activá-las mais tarde.",
        );
        return;
      }
      current.optedIn = true;
      const saved = savePreference(identity, true);
      setSettings({ identity, enabled: true });
      setStatus(
        saved
          ? "Notificações privadas activadas para esta identidade."
          : "Notificações activadas nesta sessão. Não foi possível guardar a preferência neste navegador.",
      );
    } catch {
      if (
        current.mounted &&
        current.identity === identity &&
        current.generation === generation
      ) {
        current.optedIn = false;
        setSettings({ identity, enabled: false });
        setStatus(
          "Não foi possível pedir a permissão. As notificações continuam desactivadas.",
        );
      }
    } finally {
      if (
        current.mounted &&
        current.identity === identity &&
        current.generation === generation
      )
        setBusy(false);
    }
  }, [busy, clearPending]);
  const disable = useCallback(() => {
    const current = runtime.current;
    current.generation++;
    current.optedIn = false;
    clearPending();
    if (current.identity) {
      savePreference(current.identity, false);
      setSettings({ identity: current.identity, enabled: false });
    }
    setBusy(false);
    setStatus("Notificações desactivadas nesta identidade.");
  }, [clearPending]);

  const isSupported = allowed !== "unsupported" && supported();
  const enabled =
    settings.identity === activeIdentity &&
    settings.enabled &&
    allowed === "granted" &&
    !!activeIdentity;
  return {
    enabled,
    supported: isSupported,
    permission: allowed,
    busy,
    status,
    canEnable: !!activeIdentity && isSupported && allowed !== "denied",
    enable,
    disable,
  };
}

export function NotificationSettings({
  controller,
}: {
  controller: PrivateNotificationController;
}) {
  const {
    enabled,
    supported: available,
    permission: permissionState,
    busy,
    status,
    canEnable,
    enable,
    disable,
  } = controller;
  return (
    <section
      className="notification-settings"
      aria-label={t("Notificações privadas")}
    >
      <div className="notification-heading">
        {enabled ? (
          <Bell size={21} aria-hidden="true" />
        ) : (
          <BellOff size={21} aria-hidden="true" />
        )}
        <h3>{t("Notificações privadas")}</h3>
        <span className="notification-state">
          {enabled ? t("Activadas") : t("Desactivadas")}
        </span>
      </div>
      <p>
        {t(
          "Um aviso genérico quando chegam mensagens privadas novas, apenas enquanto a aplicação está aberta. O aviso não mostra o nome da pessoa nem o conteúdo da conversa.",
        )}
      </p>
      {!available && (
        <p className="notification-support">
          {t(
            "Este navegador não disponibiliza notificações aqui. Podes consultar as mensagens na aplicação.",
          )}
        </p>
      )}
      {available && permissionState === "denied" && (
        <p className="notification-support">
          {t(
            "As notificações estão bloqueadas nas permissões deste navegador.",
          )}
        </p>
      )}
      <div className="notification-actions">
        <button
          type="button"
          className={
            enabled || busy ? "notification-disable" : "notification-enable"
          }
          disabled={!enabled && !busy && !canEnable}
          onClick={() => {
            if (enabled || busy) disable();
            else void enable();
          }}
        >
          {enabled || busy ? (
            <BellOff size={17} aria-hidden="true" />
          ) : (
            <Bell size={17} aria-hidden="true" />
          )}
          {busy
            ? t("Cancelar activação")
            : enabled
              ? t("Desactivar notificações")
              : t("Activar notificações")}
        </button>
      </div>
      <p
        className="notification-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {t(status)}
      </p>
    </section>
  );
}
