/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-BS8Dlbyr.js","sha256":"9060fe690fb3f35e1bb025ecba80fc3466b65c79f04ca6f425abe5c136b48f4d"},{"path":"/relayloom/assets/main-B9cdVXOQ.js","sha256":"15c2cae350b22ad934cc1325d973993115a3266cfc6b5dabd5e3532d798c18e2"},{"path":"/relayloom/assets/main-DlKWjWzK.css","sha256":"6b64c0ac674f4a1b79d07be1c845e528aee076f6cfc5bc16932181eb4cf782ee"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-DTS2Ukre.css","sha256":"595931b274c7f381197339b3903f8b20d1a50bf3d284fa0e9b6654447df691d8"},{"path":"/relayloom/assets/peers-DTZ2M8Fl.js","sha256":"af97c0ef23ef18ac47d35e7e2759f211abc2b77838660d23e0a16ee3358ea374"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"3a74a45bb9f37a76be25dd48f389f7c196fdd0222cd6828eeef758681e54bf9a"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-DYwqrPOP.js","sha256":"5563ed93f9ce0d8d0edc47974828a9456a12b5de7223310d6558ad13cc23b108"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "c8a12f410f0c8c4108f4a4711de777693ca76f36cf5b773543a8fbbc9b1e5b33";
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
