import React, { useSyncExternalStore } from "react";
import {
  getPreferencePhase,
  subscribePreferencePhase,
  retryPreferences,
} from "./device-preferences";
import { t } from "./i18n/core";
export function PreferenceStatus() {
  const phase = useSyncExternalStore(
    subscribePreferencePhase,
    getPreferencePhase,
    getPreferencePhase,
  );
  if (phase.state === "idle") return null;
  const message =
    phase.state === "saving"
      ? "A guardar as preferências neste perfil…"
      : phase.state === "load-failed"
        ? "Não foi possível ler as preferências deste perfil. Os dados da identidade não foram alterados."
        : !phase.native && phase.key === "language"
          ? "O idioma mudou nesta sessão, mas este navegador não permitiu guardar a preferência."
          : "As preferências aplicam-se nesta sessão, mas não foi possível guardá-las.";
  return (
    <div className="preference-status">
      <p role="status">{t(message)}</p>
      {phase.state !== "saving" && (
        <button
          type="button"
          className="text-button"
          onClick={() => void retryPreferences()}
        >
          {t("Tentar guardar as preferências")}
        </button>
      )}
    </div>
  );
}
