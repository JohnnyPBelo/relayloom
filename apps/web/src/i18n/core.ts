import {
  readDevicePreference,
  recordPreference,
  registerPreferenceConsumer,
} from "../device-preferences";
import { messages } from "./messages";

export const LANGUAGES = [
  { code: "pt-PT", name: "Português (Portugal)" },
  { code: "en-GB", name: "English" },
  { code: "es-ES", name: "Español" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_KEY = "relayloom.language.v1";
export function resolveLanguage(value?: string | null): Language | undefined {
  const code =
    typeof value === "string" ? value.toLowerCase().split("-")[0] : undefined;
  return code === "pt"
    ? "pt-PT"
    : code === "en"
      ? "en-GB"
      : code === "es"
        ? "es-ES"
        : undefined;
}
function systemLanguage(): Language {
  if (typeof window === "undefined") return "pt-PT";
  return navigator.languages.map(resolveLanguage).find(Boolean) ?? "pt-PT";
}
function initialLanguage(): Language {
  return readDevicePreference("language") ?? systemLanguage();
}
let language: Language = initialLanguage();
const listeners = new Set<() => void>();
export const getLanguage = () => language;
function apply(value: Language) {
  language = value;
  if (typeof document !== "undefined") document.documentElement.lang = value;
  for (const listener of listeners) listener();
}
export function setLanguage(value: string): boolean {
  const chosen = LANGUAGES.find((l) => l.code === value)?.code;
  if (!chosen) throw new Error("Idioma não suportado");
  const saved = recordPreference("language", chosen);
  apply(chosen);
  return saved;
}
registerPreferenceConsumer("language", (value) =>
  apply(value ?? systemLanguage()),
);
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export type MessageValues = Record<string, string | number>;
/** Only interface copy is passed here. Authored content is never looked up. */
export function translate(
  source: string,
  values: MessageValues = {},
  locale = language,
  context?: string,
): string {
  const key = context ? `${context}::${source}` : source;
  const entry = Object.hasOwn(messages, key) ? messages[key] : undefined;
  const copy = locale === "pt-PT" ? source : (entry?.[locale] ?? source);
  return copy.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
export const t = translate;
export function tc(
  context: string,
  source: string,
  values: MessageValues = {},
) {
  return translate(source, values, language, context);
}
export function formatDate(value: number, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(language, options).format(value);
}
