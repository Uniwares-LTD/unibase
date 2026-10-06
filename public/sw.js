/* Only the public fallback is stored. No API, account, RSC or navigation data. */
const CACHE = "unitale-offline-v1";
const FALLBACK = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(FALLBACK, { cache: "reload", credentials: "omit" }))));
  // Normal worker lifecycle: do not interrupt open forms to activate an update.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("unitale-offline-") && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/__/auth/")) return;
  event.respondWith(fetch(request).catch(async () => (await caches.match(FALLBACK, { cacheName: CACHE })) || Response.error()));
});
