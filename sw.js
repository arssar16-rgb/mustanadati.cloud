// عامل الخدمة: يخزّن هيكل التطبيق فقط ليعمل دون اتصال. لا يخزّن ملفات المستخدم ولا ردود Google.
const CACHE = 'mustanadati-shell-v2';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
  'js/core/arabic.js', 'js/core/search.js', 'js/core/crypto.js', 'js/core/errors.js', 'js/core/store.js', 'js/core/vault.js',
  'fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2', 'fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2', 'fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2',
  'fonts/ibm-plex-sans-arabic-latin-400-normal.woff2', 'fonts/ibm-plex-sans-arabic-latin-500-normal.woff2', 'fonts/ibm-plex-sans-arabic-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' يتجاوز ذاكرة المتصفح المؤقتة حتى لا يُخزَّن ملف قديم داخل إصدار جديد
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => {
      if (!r.ok) throw new Error('تعذّر تخزين ' + u);
      return c.put(u, r);
    }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // لا اعتراض لطلبات Google
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
