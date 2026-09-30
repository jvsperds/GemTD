/* global self, caches, fetch, URL */
// Offline cache for the installed (served) build. Network-first so a redeploy shows up on the
// next load; the cache only answers when offline.
const CACHE = 'gemtd-v2';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))),
);
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  ),
);
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname.includes('/api/')) return; // profiles: never cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
