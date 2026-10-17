const CACHE_PREFIX = 'isp-member-guide-';
const CACHE = `${CACHE_PREFIX}v1`;
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.open(CACHE).then(cache => fetch(event.request)
    .then(response => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cache.match(event.request).then(cached => cached ||
      (event.request.mode === 'navigate' ? cache.match('./index.html') : Response.error())))));
});
