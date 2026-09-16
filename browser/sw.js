/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-DaamxPVL.js","sha256":"89a6f9db2dc2de0298513657f7c676ad21353c1dac4ef2d5c3217d03bf6efb3a"},{"path":"/relayloom/assets/main-BsPYHxig.js","sha256":"dd12d3291bc872abf45f80e4a40c645234c20f0dcf6d8951017eefb4d9d44fd1"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-BbhE-K_a.js","sha256":"6e485459690551e494df7dd3ea02664f0ff643acc6589d87cd70f515a7bbd291"},{"path":"/relayloom/assets/peers-CVYQJxt3.css","sha256":"fa18bfd5c84245c9785a878344e0478b0c9085c821e0e57022b3613cf7f74c7f"},{"path":"/relayloom/assets/renderer-YCexiCJr.js","sha256":"0b26cff58104fae07e448f6ad7a9d34730e45f1c60b96ca488273366800795a0"},{"path":"/relayloom/assets/renderer-o1cZhAso.css","sha256":"fbc3a93352ecfd5268ead4a6b32083030e07168d82296c084b4e07eafb67965b"},{"path":"/relayloom/assets/site-studio-notices.txt","sha256":"75c009a409459b4fb9f62c1838d32a86e2d16805c8e8f6db930761b8615eccbb"},{"path":"/relayloom/assets/studio-CJLW_nY_.js","sha256":"1a07b879ea10c514d8f59b21af4c1a23451decb6380458c3cad84cde527beddd"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"4d7cafecb8a2382882ba81f4acbf8110c03e516d933648c635375738b20f69b8"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-y40Xh36O.js","sha256":"f7d823d2935ac500f3ff23f6fd7276a7f1fde238f28e55f2d621471cd6fad56b"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "2f290ea8db53eafcd45032dc8c215e575cb9df39a68fa6ed27d478050eff18fb";
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
