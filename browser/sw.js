/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-B1-ojTN3.js","sha256":"b50d1b4d1bc46784afce278245f92d2e270771912ffca0c3931ae923c9205d5c"},{"path":"/relayloom/assets/editor-BD7CSJlJ.js","sha256":"cf2315aed25d9a3ace79ab500a57ca33ca0033aa29d36a8a631a3e1e8a360375"},{"path":"/relayloom/assets/history-CtYMyyFE.css","sha256":"bea50f6353b677c5f7615bd9cfd9ec099e91ecea67761696aaf89c5991587de9"},{"path":"/relayloom/assets/history-DT_ra8Db.js","sha256":"bd7e12ccde19e32c052d52e468e9158b79fd777c6927c5841caa5e1b5554a4ed"},{"path":"/relayloom/assets/main-D4Jj5Cmn.js","sha256":"df0b934d54dc9e46b192895e15db35728c614c6ef42af46fd09ede9f7f58d219"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-BkpZf0fB.js","sha256":"c72356dc147c6a33995349075019d79cb9a132f65e3536ae8637896c5adc55fd"},{"path":"/relayloom/assets/peers-zdFnw8Ii.css","sha256":"e05138d7e12b9cad8dd98db964a3cbed83a7c4dc6f718de67e756e92b723dd04"},{"path":"/relayloom/assets/site-studio-notices.txt","sha256":"75c009a409459b4fb9f62c1838d32a86e2d16805c8e8f6db930761b8615eccbb"},{"path":"/relayloom/assets/visit-B39tfGPb.js","sha256":"4604c8118aee423df5f65084a96e99815f1c5a80ac74a847f6c025255d29c835"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"a62dc94025b8777852c8041911052339e0889b0d8f0dd5f3b523419105fe87e7"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-BRlztqZN.js","sha256":"975f673db9c2fc727a8bb0ba3b75a2f8247584ed5716836eb6341bc5fb666e99"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "0c0e8423526b9e95b77fa805a42b2c2b139c3c26095511ab8085aa8c0555232e";
const allowed = new Map(
  ASSETS.map((asset) => [
    new URL(asset.path, self.location.origin).href,
    asset,
  ]),
);
async function verify(response, asset) {
  const bytes = await response.clone().arrayBuffer();
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== asset.sha256)
    throw new Error("Application asset integrity failed");
  return response;
}
async function checked(asset) {
  const response = await fetch(
    new Request(asset.path, { cache: "no-store", credentials: "same-origin" }),
  );
  if (!response.ok || new URL(response.url).origin !== self.location.origin)
    throw new Error("Application asset unavailable");
  return verify(response, asset);
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        for (const asset of ASSETS)
          await cache.put(
            new URL(asset.path, self.location.origin).href,
            await checked(asset),
          );
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
      // A new version waits for old clients to close: no forced mixed-code upgrade.
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const asset = allowed.get(url.href);
  if (!asset) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        cached = await cache.match(url.href);
      if (cached) {
        try {
          return await verify(cached, asset);
        } catch {
          await cache.delete(url.href);
        }
      }
      const response = await checked(asset);
      await cache.put(url.href, response.clone());
      return response;
    })(),
  );
});
