import {
  readDevicePreference,
  recordPreference,
  registerPreferenceConsumer,
} from "./device-preferences";
import { useEffect, useState } from "react";

/** Device preferences only. Never stores identity or message content. */
export function useAppearance(lowPower: boolean, highContrast: boolean) {
  const [glass, setGlassInternal] = useState(
    () => readDevicePreference("glass") ?? true,
  );
  const setGlass = (value: boolean) => {
    recordPreference("glass", value);
    setGlassInternal(value);
  };
  useEffect(
    () =>
      registerPreferenceConsumer("glass", (value) =>
        setGlassInternal(value ?? true),
      ),
    [],
  );
  useEffect(() => {
    const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast = matchMedia("(prefers-contrast: more)");
    const forced = matchMedia("(forced-colors: active)");
    const update = () => {
      document.documentElement.dataset.effects =
        glass &&
        !lowPower &&
        !highContrast &&
        !transparency.matches &&
        !contrast.matches &&
        !forced.matches
          ? "glass"
          : "reduced";
    };
    update();
    const preferences = [transparency, contrast, forced];
    preferences.forEach((p) => p.addEventListener("change", update));
    return () =>
      preferences.forEach((p) => p.removeEventListener("change", update));
  }, [glass, lowPower, highContrast]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const root = document.documentElement;
      root.style.setProperty(
        "--visible-height",
        `${viewport?.height ?? innerHeight}px`,
      );
      root.style.setProperty("--visible-top", `${viewport?.offsetTop ?? 0}px`);
      root.dataset.keyboard =
        viewport && viewport.scale === 1 && innerHeight - viewport.height > 150
          ? "open"
          : "closed";
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return { glass, setGlass };
}
