// Aplicația (paginile și codul) se ia mereu întâi de pe internet, ca actualizările să ajungă imediat;
// fără internet se folosește copia salvată. Modelele OCR (mari) se iau din copia salvată.
const CACHE = "zscan-v3";
const BIG = ["./models/det.onnx", "./models/rec.onnx", "./models/keys.txt", "./ort/ort-wasm-simd-threaded.wasm", "./ort/ort-wasm-simd-threaded.mjs"];
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll([...SHELL, ...BIG])).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const isBig = /\/(models|ort)\//.test(new URL(req.url).pathname);
  if (isBig) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(resp => { if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return resp; })));
  } else {
    e.respondWith(fetch(req, { cache: "no-cache" }).then(resp => { if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return resp; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
