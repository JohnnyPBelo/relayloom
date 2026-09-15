/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = __RELAYLOOM_ASSETS__;
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + __RELAYLOOM_VERSION__;
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
