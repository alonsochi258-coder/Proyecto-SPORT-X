// SPORTX service worker v4
// - La app abre SIEMPRE desde el teléfono (no espera a la red), y se actualiza en segundo plano.
// - El SDK de Firebase (gstatic) también se guarda, para que la sesión funcione sin internet.
const C = "sportx-v4";
const FILES = ["./", "index.html", "firebase.js", "manifest.json", "icon-192.png", "icon-512.png"];
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";

self.addEventListener("install", e => e.waitUntil(
  caches.open(C).then(async c => {
    await c.addAll(FILES);
    // Precarga del SDK; si falla no pasa nada, se guarda solo al usarse con internet.
    await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f =>
      fetch(SDK + f).then(r => r.ok && c.put(SDK + f, r)).catch(() => {})));
  }).then(() => self.skipWaiting())
));

self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => clients.claim())
));

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;

  // Archivos del SDK de Firebase: primero la copia guardada, si no existe se pide y se guarda.
  if (url.href.startsWith(SDK)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); }
      return res;
    })));
    return;
  }

  // Solo archivos de la propia app (Firestore/Auth/Google van directo a la red).
  if (url.origin !== location.origin) return;

  // Primero lo guardado (abre al instante con Wi-Fi, datos o sin internet) y se actualiza en segundo plano.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); }
      return res;
    });
    if (hit) { net.catch(() => {}); return hit; }
    return net.catch(() => caches.match("index.html"));
  }));
});
