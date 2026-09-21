/* Build-time asset integrity detects corruption; trust still depends on the serving origin. */
const ASSETS = [{"path":"/relayloom/assets/browser-DanGs70r.js","sha256":"c8b02308acf234d7a0d2282aeae802722755ef4712ab3d6e04623327bb4388cb"},{"path":"/relayloom/assets/editor-BOcVap7H.js","sha256":"23207b3e0175b6e7010f45eba4f2022e9352bda0e417e392181b80943cb60425"},{"path":"/relayloom/assets/editor-TdZUp6iQ.css","sha256":"25ab29c8c7dea223090852755c2a3d9124269e096b9e000e3cb32e272ef1ce1e"},{"path":"/relayloom/assets/history-DFAGJPMi.js","sha256":"24303b80a31e8d559ce5ea97aaeb29884c9534c2b4f14526795ebb2818b92b09"},{"path":"/relayloom/assets/history-DpTwHcHw.css","sha256":"18870a77b382eabb5af1512e99b3cf417a08bb4f5480162f1c8a58386e66e807"},{"path":"/relayloom/assets/main-DEi_Xkk3.css","sha256":"46f13f96e5f5ac7e0004b1463f8db8639f0ebcf13dcfed004b085215b91a3453"},{"path":"/relayloom/assets/main-gxOmc6EZ.js","sha256":"7e60a107cfde88181fd0d0014d5809a4a9dbef940082fc86b4d636db45943ec6"},{"path":"/relayloom/assets/manifest-BWKlX33v.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/assets/peers-B0Y1F-hX.js","sha256":"4840f758a99ca44856206b60766a45dcfb04e7492367230e21234488491faab0"},{"path":"/relayloom/assets/peers-CBwbv1q3.css","sha256":"a941e640c8f7db5762843c4d291485bb8f825648897f5c8d242ff9317988c1ba"},{"path":"/relayloom/assets/site-studio-notices.txt","sha256":"75c009a409459b4fb9f62c1838d32a86e2d16805c8e8f6db930761b8615eccbb"},{"path":"/relayloom/assets/visit-CGvL4M1P.js","sha256":"b6269f7e968988e2447fc7325043de38197e18952c3f8f78437cedea6b388106"},{"path":"/relayloom/browser/icon.svg","sha256":"e07d4044578707df6661e170be9e819ad252a9e6654a60858600de2963a4b35e"},{"path":"/relayloom/browser/index.html","sha256":"a85680aa6f2fec34aeb2ea7be93aa3a2af4eddae82428907c23bdd9ab7187a18"},{"path":"/relayloom/browser/manifest.webmanifest","sha256":"19128cfd05183584671ce8d8697e44011315a35bfb2425b920511bc6b56a9cee"},{"path":"/relayloom/browser/worker-DGzCVFVM.js","sha256":"e1d96999dcc02ed8a894970de36fc9fa952cd9b7dec034bc6bd7b703282194e3"}];
// Several installations can share a host (for example project Pages sites).
// An update must only evict this installation's old code caches.
const PREFIX =
  "relayloom-browser-assets-" +
  encodeURIComponent(self.registration.scope) +
  "-";
const CACHE = PREFIX + "b28cb4e26166ea188a51f7ef40c7ce21ea31d2a8ac960f2cfc10a321637ce71f";
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
