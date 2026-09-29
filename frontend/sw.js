// Service worker de la app de [Empresa].
// Guarda una copia de la app en el móvil para que se abra aunque no haya cobertura.
// Los datos (Supabase) NUNCA se guardan aquí: los fichajes sin conexión los gestiona la propia app.

const CACHE = 'app-v3';          // cambiar el número si algún día hay que forzar una limpieza
const APP = ['./', './index.html', './supabase.js'];   // supabase.js va incluida en la app: no depende de ningún servidor externo

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase (datos, fichajes): siempre a la red, nunca desde la caché
  if (url.hostname.endsWith('supabase.co')) return;

  // Archivos propios de la app
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('admin.html')) return;          // el panel admin siempre necesita conexión
    const esPagina = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    if (esPagina) {
      // La página: primero la red (así siempre hay última versión); sin conexión, la copia guardada
      e.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copia)); }
            return res;
          })
          .catch(() => caches.match('./index.html', { ignoreSearch: true }))
      );
    } else {
      // Resto de archivos propios (supabase.js...): SIEMPRE la copia guardada primero.
      // (Un fallo anterior devolvía index.html en lugar de estos archivos y la app no arrancaba sin conexión.)
      e.respondWith(caches.match(req).then((guardada) => guardada || fetch(req)));
    }
    return;
  }

  // Librerías externas (supabase-js, iconos, fuentes): la copia guardada y, de fondo, se actualiza
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((guardada) => {
        const deRed = fetch(req)
          .then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; })
          .catch(() => guardada);
        return guardada || deRed;
      })
    )
  );
});
