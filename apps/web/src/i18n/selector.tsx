import { PreferenceStatus } from "../preference-status";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import {
  getLanguage,
  LANGUAGES,
  setLanguage,
  subscribeLanguage,
  t,
} from "./core";
export function useLanguage() {
  const language = useSyncExternalStore(
    subscribeLanguage,
    getLanguage,
    getLanguage,
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return language;
}
export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  return (
    <div className={"language-picker" + (compact ? " compact" : "")}>
      <label>
        <span>
          <Languages size={17} aria-hidden="true" />
          {t("Idioma")}
        </span>
        <select
          aria-label={t("Idioma da aplicação")}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {!compact && (
        <p>
          {t(
            "A escolha aplica-se à interface. As mensagens e as páginas mantêm o texto original.",
          )}
        </p>
      )}
      <PreferenceStatus />
    </div>
  );
}
