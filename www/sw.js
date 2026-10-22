// Service worker: makes the app open and work with no internet.
//
// WHY a version number: the phone keeps the cached files until this file
// changes. Bump VERSION whenever any file in www/ changes, so the phone
// downloads the new version (the app then shows "App updated · Reload").

const VERSION = 'v21';
const CACHE = `tracker-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './default_config.json',
  './default_config.he.json',
  './default_config.ru.json',
  './exercise_library.json',
  './css/app.css',
  './js/about.js',
  './js/ai.js',
  './js/alerts.js',
  './js/app.js',
  './js/charts.js',
  './js/config.js',
  './js/eventEditor.js',
  './js/exercisePicker.js',
  './js/events.js',
  './js/exporter.js',
  './js/i18n.js',
  './js/icons.js',
  './js/library.js',
  './js/log.js',
  './js/record.js',
  './js/reminders.js',
  './js/settings.js',
  './js/stats.js',
  './js/storage.js',
  './js/theme.js',
  './js/training.js',
  './js/trainingEditor.js',
  './js/util.js',
  './js/welcome.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/shortcut-event.png',
  './icons/shortcut-training.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the browser's HTTP cache so a new VERSION
  // really fetches fresh files instead of stale copies.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first: the app opens instantly, even offline. Query strings are
// ignored so shortcut URLs like ./?log=headache still match index.html.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      return fetch(req);
    }),
  );
});
