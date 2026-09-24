/*
 * Service worker «АвтоЖурнала».
 *
 * Задача — чтобы приложение можно было установить на телефон и оно открывалось
 * без интернета. Кэшируется только оболочка (страница, стили, скрипты, иконки).
 * Запросы к /api никогда не кэшируются: данные должны быть свежими, а показывать
 * устаревшие цифры расходов опаснее, чем честно сообщить об отсутствии связи.
 */

const CACHE_NAME = 'avtozhurnal-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API всегда идёт в сеть.
  if (url.pathname.startsWith('/api')) return;

  // Переходы по приложению: сначала сеть, при отсутствии — сохранённая оболочка.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Статика: сначала кэш, затем сеть (с обновлением кэша).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
