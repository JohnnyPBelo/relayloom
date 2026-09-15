/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-BXEPX-ae.js","sha256":"3ac7ffdccf96f975a6f217ab40006af58392961eade7649407b183615cb20197"},{"path":"/relayloom/assets/main-Bw6Dx0Yw.js","sha256":"93f39abd1d03d1379ace4e47dff744260d13bdfb4572339fd16a4f817a244138"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-CmHu2799.js","sha256":"8875276a52ac2edde9474cf0acbb8de8c32bbf8b9b6d549a5a05084f0cdcfa52"},{"path":"/relayloom/assets/peers-DTS2Ukre.css","sha256":"595931b274c7f381197339b3903f8b20d1a50bf3d284fa0e9b6654447df691d8"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"2a3a38267bb3a9093fef833008c2daae0d6cfac465bfd42a22de792785f8c0a0"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-DYwqrPOP.js","sha256":"5563ed93f9ce0d8d0edc47974828a9456a12b5de7223310d6558ad13cc23b108"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "672365fa2bf502664942176a224d4663eb64ad8972484fc64a2fa2888cbdbb93";
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
