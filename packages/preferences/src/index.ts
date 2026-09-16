import { exactShape } from "../../core/src/protocol";
export type UIPreferences = {
  language?: "pt-PT" | "en-GB" | "es-ES";
  theme?: "light" | "dark";
  glass?: boolean;
  largeText?: boolean;
  highContrast?: boolean;
};
export const preferenceKeys = [
  "language",
  "theme",
  "glass",
  "largeText",
  "highContrast",
] as const;
export function validateUIPreferences(
  value: unknown,
): asserts value is UIPreferences {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactShape(value, Object.keys(value)) ||
    Object.keys(value).some((k) => !preferenceKeys.includes(k as any))
  )
    throw new Error("Preferências de interface inválidas");
  const p = value as UIPreferences;
  if (
    (Object.hasOwn(p, "language") &&
      (typeof p.language !== "string" ||
        !["pt-PT", "en-GB", "es-ES"].includes(p.language))) ||
    (Object.hasOwn(p, "theme") &&
      (typeof p.theme !== "string" || !["light", "dark"].includes(p.theme))) ||
    ["glass", "largeText", "highContrast"].some(
      (k) =>
        Object.hasOwn(p, k) && typeof p[k as keyof UIPreferences] !== "boolean",
    )
  )
    throw new Error("Preferências de interface inválidas");
}
