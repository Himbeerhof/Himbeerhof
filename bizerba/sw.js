// Merge și fără internet: fișierele se iau întâi de pe internet, fără semnal din copia salvată.
const CACHE = "bz-v1", SHELL = ["./", "./index.html", "./app.js", "./bizerba.js", "./xlsx.js", "./manifest.webmanifest", "./icon-192.png", "./vendor/exceljs.min.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => { const q = e.request; if (q.method !== "GET" || new URL(q.url).origin !== location.origin) return;
  e.respondWith(fetch(q, { cache: "no-cache" }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(q, c)); } return r; }).catch(() => caches.match(q, { ignoreSearch: true }))); });
