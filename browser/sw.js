/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-c6IDH8XV.js","sha256":"ee370a866d707d2f7501c7a679a7126a433fed67b8d61eaed49743af14f6512f"},{"path":"/relayloom/assets/main-CNzCjPUV.js","sha256":"6b633fbe2925e285090487bc049d7e1b799cb12624f94bb8176a0bacd538768e"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-Cgn_ljoD.js","sha256":"75286749bcc6f2ff245af6ad385b5e39368501da49722867850228f259dac9d6"},{"path":"/relayloom/assets/peers-zdFnw8Ii.css","sha256":"e05138d7e12b9cad8dd98db964a3cbed83a7c4dc6f718de67e756e92b723dd04"},{"path":"/relayloom/assets/renderer-A2pya3rf.js","sha256":"de05a60636eb0c2e55a8f67a9ee629242c68238763ae2c468f0ab2f710689368"},{"path":"/relayloom/assets/renderer-AmIL56_-.css","sha256":"ad23c40ab4a8b0059642c62630fee31d541dfe2d2d16c62c99b390cc5ea867f6"},{"path":"/relayloom/assets/site-studio-notices.txt","sha256":"75c009a409459b4fb9f62c1838d32a86e2d16805c8e8f6db930761b8615eccbb"},{"path":"/relayloom/assets/studio-DxutNhUe.js","sha256":"0f7da9e78be2b54212f69fc6fe4274488d29f5ddeba0f79adf895c5adeed45d5"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"9b919363042752b02c3b966b35a3b20e6d15eb6bafb8226bbf79d048fc813d30"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-y40Xh36O.js","sha256":"f7d823d2935ac500f3ff23f6fd7276a7f1fde238f28e55f2d621471cd6fad56b"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "eac9e066670b8820fdd36f860c94934bb64c7ab97811b6e8e39a6de666d5170a";
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
