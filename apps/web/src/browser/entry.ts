import { browserAPI } from "./client";
import { useLocalAPI } from "../api";
import "../style.css";
import "../liquid-glass.css";
import "./peers.css";
try {
  const api = await browserAPI();
  useLocalAPI(api);
  const root = document.getElementById("root")!;
  root.removeAttribute("role");
  root.removeAttribute("aria-live");
  await import("../main");
} catch (error) {
  const root = document.getElementById("root")!;
  root.replaceChildren();
  root.className = "browser-startup-error";
  const heading = document.createElement("h1");
  heading.textContent = "Não foi possível abrir este perfil";
  const message = document.createElement("p");
  message.textContent =
    error instanceof Error
      ? error.message
      : "Tenta abrir novamente o teu espaço.";
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = "Tentar novamente";
  button.onclick = () => location.reload();
  root.append(heading, message, button);
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
