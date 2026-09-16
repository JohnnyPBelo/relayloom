import React from "react";
import { createRoot } from "react-dom/client";
import { LanguageSelector, useLanguage } from "./i18n/selector";
import { t } from "./i18n/core";
function StartupFailure({ message }: { message: string }) {
  useLanguage();
  return (
    <section className="card">
      <LanguageSelector compact />
      <h1>{t("Não foi possível abrir este perfil")}</h1>
      <p role="alert">{t(message)}</p>
      <button className="primary" onClick={() => location.reload()}>
        {t("Tentar novamente")}
      </button>
    </section>
  );
}
export function showStartupFailure(root: HTMLElement, error: unknown) {
  root.replaceChildren();
  root.className = "browser-startup-error";
  root.removeAttribute("role");
  root.removeAttribute("aria-live");
  createRoot(root).render(
    <StartupFailure
      message={
        error instanceof Error
          ? error.message
          : "Tenta abrir novamente o teu espaço."
      }
    />,
  );
}
