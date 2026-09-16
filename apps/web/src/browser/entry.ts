import { getLanguage } from "../i18n/core";
import { showStartupFailure } from "../startup";
import "../onboarding.css";
import { browserAPI } from "./client";
import { useLocalAPI } from "../api";
import "../style.css";
import "../liquid-glass.css";
import "./peers.css";
document.documentElement.lang = getLanguage();
try {
  const api = await browserAPI();
  useLocalAPI(api);
  const root = document.getElementById("root")!;
  root.removeAttribute("role");
  root.removeAttribute("aria-live");
  await import("../main");
} catch (error) {
  showStartupFailure(document.getElementById("root")!, error);
}

addEventListener("pageshow", (event) => {
  if ((event as PageTransitionEvent).persisted) location.reload();
});

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register(import.meta.env.BASE_URL + "browser/sw.js", {
      scope: import.meta.env.BASE_URL + "browser/",
      updateViaCache: "none",
    })
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      document.documentElement.dataset.offlineAssets = "ready";
    })
    .catch(() => {
      document.documentElement.dataset.offlineAssets = navigator.serviceWorker
        .controller
        ? "ready"
        : "unavailable";
    });
}
