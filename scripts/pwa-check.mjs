#!/usr/bin/env node
/**
 * Проверка готовности приложения к установке на телефон.
 *
 * Что проверяется: манифест и его обязательные поля, иконки нужных размеров,
 * наличие service worker и его реальная регистрация в браузере, а также то,
 * что оболочка приложения отдаётся сервером.
 *
 * Запуск (сервер должен быть поднят и собран):
 *   BASE_URL=http://localhost:4000 node scripts/pwa-check.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const CHROME_BIN = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9444);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── 1. Манифест ─────────────────────────────────────────────── */

const manifestResponse = await fetch(`${BASE}/manifest.webmanifest`);
const manifest = await manifestResponse.json();
check('Манифест отдаётся сервером', manifestResponse.ok && manifestResponse.status === 200);
check('В манифесте есть название и короткое имя', Boolean(manifest.name && manifest.short_name), `${manifest.short_name}`);
check('Режим отображения — отдельное окно', manifest.display === 'standalone', `display: ${manifest.display}`);
check('Указан стартовый адрес и область', manifest.start_url === '/' && manifest.scope === '/');

const icons = manifest.icons ?? [];
const has192 = icons.some((icon) => icon.sizes === '192x192');
const has512 = icons.some((icon) => icon.sizes === '512x512');
const hasMaskable = icons.some((icon) => String(icon.purpose).includes('maskable'));
check('Есть иконки 192 и 512 пикселей', has192 && has512);
check('Есть отдельная maskable-иконка для Android', hasMaskable);

for (const icon of icons) {
  const response = await fetch(`${BASE}${icon.src}`);
  check(`Иконка ${icon.src} доступна`, response.ok, `HTTP ${response.status}, ${response.headers.get('content-type')}`);
}

/* ── 2. Оболочка и service worker ────────────────────────────── */

const swResponse = await fetch(`${BASE}/sw.js`);
const swText = await swResponse.text();
check('Скрипт service worker отдаётся', swResponse.ok && swText.includes('install'));
check('Service worker не кэширует данные API', swText.includes("startsWith('/api')"));

const shell = await fetch(`${BASE}/`);
check('Оболочка приложения отдаётся', shell.ok);

/* ── 3. Регистрация в браузере ───────────────────────────────── */

const profile = mkdtempSync(path.join(tmpdir(), 'avtozhurnal-pwa-'));
const chrome = spawn(
  CHROME_BIN,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=390,844', 'about:blank',
  ],
  { stdio: 'ignore' },
);

async function cdpUrl() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome ещё поднимается */
    }
    await sleep(500);
  }
  throw new Error('Chrome не ответил по DevTools Protocol');
}

try {
  const socket = new WebSocket(await cdpUrl());
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return result.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/#/dashboard` });
  await sleep(6000);

  const registrations = await evaluate('navigator.serviceWorker.getRegistrations().then((r) => r.length)');
  check('Service worker зарегистрировался в браузере', Number(registrations) > 0, `регистраций: ${registrations}`);

  const manifestHref = await evaluate("document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null");
  check('Страница ссылается на манифест', manifestHref === '/manifest.webmanifest', String(manifestHref));

  const themeColor = await evaluate("document.querySelector('meta[name=theme-color]')?.getAttribute('content') ?? null");
  check('Задан цвет темы для строки состояния', themeColor === '#2f7d7a', String(themeColor));

  const viewportWidth = await evaluate('window.innerWidth');
  const bottomNav = await evaluate("!!document.querySelector('.bottom-nav') && getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none'");
  check('На узком экране появляется нижняя навигация', bottomNav === true, `ширина окна: ${viewportWidth}px`);

  const shellCached = await evaluate(
    "caches.open('avtozhurnal-shell-v1').then((c) => c.keys()).then((keys) => keys.length)",
  );
  check('Оболочка сохранена в кэш для работы без сети', Number(shellCached) > 0, `файлов в кэше: ${shellCached}`);

  socket.close();
} catch (error) {
  check('Проверка в браузере выполнена без исключений', false, error.message);
} finally {
  chrome.kill('SIGKILL');
}

console.log(failures === 0 ? '\nПриложение готово к установке на телефон.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
