// Service worker: rede primeiro (sempre a versão mais nova do app), cache só quando estiver sem internet (PWA offline).
const CACHE = 'motionframe-v99';
const SHELL = ['./', './index.html', './css/style.css', './js/main.js', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', (e) => {
  // 'reload': ignora o cache HTTP do servidor (senão a versão nova podia instalar com arquivos velhos)
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => r.ok && c.put(u, r)).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' }); // confere com o servidor toda vez
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
