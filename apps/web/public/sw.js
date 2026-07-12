const CACHE_NAME = "dashwise-cache-v2";

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

  const isGoogleFont =
    request.url.startsWith("https://fonts.googleapis.com/") ||
    request.url.startsWith("https://fonts.gstatic.com/");

  if (request.destination === "image" || isGoogleFont) {
    event.respondWith(
      caches.match(request).then(cachedRes => {
        if (cachedRes) {
          // Cached Geist assets can be used immediately while refreshing them
          // in the background for future visits.
          if (isGoogleFont) {
            event.waitUntil(
              fetch(request)
                .then(networkRes => caches.open(CACHE_NAME).then(cache => cache.put(request, networkRes)))
                .catch(() => undefined)
            );
          }
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
