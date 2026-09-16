/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-C-37YlA4.js","sha256":"7404ee49b97724793d9d8a42cb3d54f8b1ce3328a55b6c5a3cbe12b24a4c01ae"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/main-DEn8GZLA.js","sha256":"5a0157cfef6b8c04564cc98ca0feb08783dac785824ba9645043a5e2943ab86b"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-DZsMHYJ_.js","sha256":"a3e39cc914e74715b4b78c36255cc248b4b6f43448b556b7ca1d0a542b8eedb7"},{"path":"/relayloom/assets/peers-zdFnw8Ii.css","sha256":"e05138d7e12b9cad8dd98db964a3cbed83a7c4dc6f718de67e756e92b723dd04"},{"path":"/relayloom/assets/renderer-BBLiJtR3.css","sha256":"476519e7584fbf6e65c6874a59875a727473d56dff1011efbf7f02326fae3c45"},{"path":"/relayloom/assets/renderer-CLixUSZB.js","sha256":"c6991bfedf96a568455c2a16f931b95bcb12d2f36ebdf98c5a8d30153978283a"},{"path":"/relayloom/assets/site-studio-notices.txt","sha256":"75c009a409459b4fb9f62c1838d32a86e2d16805c8e8f6db930761b8615eccbb"},{"path":"/relayloom/assets/studio-J06u9bW-.js","sha256":"6e842d405de83cdc6aa189de3de9e8d1d5f0a9839f4dba6f8cabcc9717477e38"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"ae7f229d4f08fb46b0d6819b1aee04deed84cf4c56cbdbec4bce6e3744e1d2a9"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-y40Xh36O.js","sha256":"f7d823d2935ac500f3ff23f6fd7276a7f1fde238f28e55f2d621471cd6fad56b"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "190c2547ba9ff5c2a3c47cf222ceb561e001e1ceb0b1e80c9a38cc960b5333bf";
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
