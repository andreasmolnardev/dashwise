const CACHE_NAME = "background-cache-v1";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const { request } = event;

  if (request.destination === "image") {
    event.respondWith(
      caches.match(request).then(cachedRes => {
        if (cachedRes) {
          return cachedRes;
        }

        return fetch(request).then(networkRes => {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, resClone));
          return networkRes;
        });
      })
    );
  }
});
