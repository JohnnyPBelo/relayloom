/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-CG-qgeoP.js","sha256":"5950f32352b7fa446512a259572e278653026f749590b05a42dc89ce1eff6185"},{"path":"/relayloom/assets/editor-DlP7ZRaP.js","sha256":"ed88455655456daf6524daf84b6abf2097f51d84273309fd4bec4a75b8ba2cc0"},{"path":"/relayloom/assets/editor-TdZUp6iQ.css","sha256":"25ab29c8c7dea223090852755c2a3d9124269e096b9e000e3cb32e272ef1ce1e"},{"path":"/relayloom/assets/history-BF0Gv_tB.js","sha256":"5b015393a9bc06a9d898a9e7906adcbab1dd3960c8aaf5c2a3b4d903614ebef6"},{"path":"/relayloom/assets/history-DpTwHcHw.css","sha256":"18870a77b382eabb5af1512e99b3cf417a08bb4f5480162f1c8a58386e66e807"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/main-DOOe6Q01.js","sha256":"2396fdc267f5eec81ec6241370ed0492c0f9bd4d7530557b8e7c294f47dee09f"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-BN731nYT.js","sha256":"d281d81eadf3e5c219e455de7381d9671c19c6d1ca5be8fc883eaced269947b2"},{"path":"/relayloom/assets/peers-CBwbv1q3.css","sha256":"a941e640c8f7db5762843c4d291485bb8f825648897f5c8d242ff9317988c1ba"},{"path":"/relayloom/assets/site-studio-notices.txt","sha256":"75c009a409459b4fb9f62c1838d32a86e2d16805c8e8f6db930761b8615eccbb"},{"path":"/relayloom/assets/visit-CN-RTPss.js","sha256":"d6a67ca920eb6ec0ce648e814ad1864661e7c05ae1866b2a804da4283b3c1476"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"24684eca5651b55835a8286ec2dc9a6b7b28a8b9dfbc465af9ace865217ac3dc"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-CxTgiVfr.js","sha256":"b8095e48b2dca51e57a0232f9e3e1a0f4d569a6015d1a9aa192dfebbb1947cf4"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "c66ae54e5c70867b8078327cab2bddd019f72f35c6d8a28fff72b6c136215368";
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
