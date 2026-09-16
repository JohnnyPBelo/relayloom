import {
  preferenceKeys,
  validateUIPreferences,
  type UIPreferences,
} from "../../../packages/preferences/src/index";
export type PreferenceKey = keyof UIPreferences;
const keys: Record<PreferenceKey, string> = {
  language: "relayloom.language.v1",
  theme: "relayloom-theme",
  glass: "relayloom-glass",
  largeText: "relayloom-large-text",
  highContrast: "relayloom-high-contrast",
};
type Phase = {
  state: "idle" | "saving" | "failed" | "load-failed";
  key?: PreferenceKey;
  native: boolean;
};
let phase: Phase = { state: "idle", native: false };
const statusListeners = new Set<() => void>(),
  consumers = new Map<PreferenceKey, Set<(value: any) => void>>(),
  edited = new Set<PreferenceKey>(),
  unsavedLocal = new Set<PreferenceKey>();
let current: UIPreferences = {},
  hydrated: UIPreferences | undefined,
  pending: UIPreferences = {},
  running = false;
let backend:
  | {
      read: () => Promise<unknown>;
      write: (patch: UIPreferences) => Promise<unknown>;
    }
  | undefined;
let loading: Promise<void> | undefined;
export const getPreferencePhase = () => phase;
export const subscribePreferencePhase = (fn: () => void) => {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
};
function status(state: Phase["state"], key?: PreferenceKey) {
  phase = { state, key, native: !!backend };
  for (const fn of statusListeners) fn();
}
function parse(key: PreferenceKey, raw: string | null) {
  if (raw === null) return undefined;
  const value = ["glass", "largeText", "highContrast"].includes(key)
    ? raw === "true"
      ? true
      : raw === "false"
        ? false
        : raw
    : raw;
  try {
    validateUIPreferences({ [key]: value });
    return value;
  } catch {
    return undefined;
  }
}
function local(key: PreferenceKey) {
  try {
    return parse(key, localStorage.getItem(keys[key]));
  } catch {
    return undefined;
  }
}
function cache(key: PreferenceKey, value: any) {
  try {
    localStorage.setItem(keys[key], String(value));
    return true;
  } catch {
    return false;
  }
}
function deliver(key: PreferenceKey, value: any) {
  for (const fn of consumers.get(key) ?? []) fn(value);
}
export function readDevicePreference<K extends PreferenceKey>(
  key: K,
): UIPreferences[K] {
  if (Object.hasOwn(current, key)) return current[key];
  return (backend ? hydrated?.[key] : local(key)) as UIPreferences[K];
}
export function registerPreferenceConsumer<K extends PreferenceKey>(
  key: K,
  fn: (value: UIPreferences[K]) => void,
) {
  let set = consumers.get(key);
  if (!set) {
    set = new Set();
    consumers.set(key, set);
  }
  set.add(fn);
  if (backend && hydrated && !edited.has(key)) fn(hydrated[key]);
  return () => {
    set!.delete(fn);
  };
}
export function configureNativePreferences(
  read: () => Promise<unknown>,
  write: (patch: UIPreferences) => Promise<unknown>,
) {
  if (backend) throw new Error("Preferências já configuradas");
  backend = { read, write };
  // Native loopback ports change between launches. Never inherit another
  // profile's per-origin browser cache before reading this profile's preferences.
  for (const key of preferenceKeys)
    if (!edited.has(key)) {
      delete current[key];
      deliver(key, undefined);
    }
}
export function ensureNativePreferences(): Promise<void> {
  if (!backend) return Promise.resolve();
  return (loading ??= (async () => {
    try {
      const value = await backend!.read();
      validateUIPreferences(value);
      hydrated = { ...value };
      for (const key of preferenceKeys)
        if (!edited.has(key)) {
          if (Object.hasOwn(value, key)) {
            (current as any)[key] = value[key];
            cache(key, value[key]);
          } else delete current[key];
          deliver(key, value[key]);
        }
      if (phase.state === "load-failed") status("idle");
    } catch {
      status("load-failed");
    }
  })());
}
async function drain() {
  if (!backend || running || !Object.keys(pending).length) return;
  running = true;
  status("saving");
  try {
    while (Object.keys(pending).length) {
      const batch = pending;
      pending = {};
      try {
        const result = await backend.write(batch);
        validateUIPreferences(result);
      } catch {
        pending = { ...batch, ...pending };
        status("failed");
        return;
      }
    }
    status("idle");
  } finally {
    running = false;
  }
}
export function recordPreference<K extends PreferenceKey>(
  key: K,
  value: NonNullable<UIPreferences[K]>,
): boolean {
  validateUIPreferences({ [key]: value });
  edited.add(key);
  (current as any)[key] = value;
  const saved = cache(key, value);
  if (backend) {
    pending = { ...pending, [key]: value };
    void drain();
    return true;
  }
  if (saved) unsavedLocal.delete(key);
  else unsavedLocal.add(key);
  if (unsavedLocal.size) status("failed", [...unsavedLocal][0]);
  else if (phase.state === "failed") status("idle");
  return saved;
}
export async function retryPreferences() {
  if (backend) {
    if (Object.keys(pending).length) {
      await drain();
      return;
    }
    loading = undefined;
    await ensureNativePreferences();
    return;
  }
  for (const key of unsavedLocal) {
    if (Object.hasOwn(current, key) && !cache(key, current[key])) {
      status("failed", key);
      return;
    }
    unsavedLocal.delete(key);
  }
  status("idle");
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    // Native preferences belong to the profile, not to a reusable loopback
    // origin. Another view's cache hydration is not a new user instruction.
    if (backend) return;
    const key = preferenceKeys.find((key) => keys[key] === event.key);
    if (!key) return;
    const value = parse(key, event.newValue);
    if (value === undefined) return;
    (current as any)[key] = value;
    unsavedLocal.delete(key);
    if (phase.state === "failed")
      status(unsavedLocal.size ? "failed" : "idle", [...unsavedLocal][0]);
    deliver(key, value);
  });
