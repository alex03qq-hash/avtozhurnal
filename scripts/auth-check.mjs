#!/usr/bin/env node
/**
 * Проверка кода доступа к журналу.
 *
 * Требуется сервер, запущенный с переменной ACCESS_TOKEN, например:
 *   ACCESS_TOKEN=проверочный-код PORT=4555 DATA_DIR=./data-check npm start
 * Запуск проверки:
 *   BASE_URL=http://localhost:4555 ACCESS_TOKEN=проверочный-код node scripts/auth-check.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const TOKEN = process.env.ACCESS_TOKEN;
const CHROME_BIN = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9600);

if (!TOKEN) {
  console.error('Не задан ACCESS_TOKEN — нечего проверять.');
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const call = (path, headers = {}) => fetch(`${BASE}${path}`, { headers });

const health = await call('/api/health');
check('Служебная проверка связи доступна без кода', health.status === 200, `HTTP ${health.status}`);

const network = await call('/api/network');
const networkBody = await network.json();
check('Сервер сообщает, что защита включена', networkBody.authEnabled === true);

const anonymous = await call('/api/vehicles');
const anonymousBody = await anonymous.json().catch(() => ({}));
check('Без кода данные не отдаются', anonymous.status === 401 && anonymousBody.code === 'auth_required', `HTTP ${anonymous.status}, код ответа: ${anonymousBody.code}`);

const wrong = await call('/api/vehicles', { Authorization: 'Bearer wrong-token-000' });
check('Неверный код отклоняется', wrong.status === 401, `HTTP ${wrong.status}`);

const right = await call('/api/vehicles', { Authorization: `Bearer ${TOKEN}` });
check('Верный код открывает данные', right.status === 200 && Array.isArray(await right.json()), `HTTP ${right.status}`);

const customHeader = await call('/api/settings', { 'X-Access-Token': TOKEN });
check('Код принимается и в заголовке X-Access-Token', customHeader.status === 200, `HTTP ${customHeader.status}`);

/* ── Браузер: экран входа, неверный код, верный код, перезагрузка ── */

const profile = mkdtempSync(path.join(tmpdir(), 'avtozhurnal-auth-'));
const chrome = spawn(CHROME_BIN, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-component-update',`--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,'--window-size=1280,900','about:blank'], { stdio: 'ignore' });

async function cdpUrl() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* ждём */ }
    await sleep(500);
  }
  throw new Error('Chrome не ответил');
}

try {
  const socket = new WebSocket(await cdpUrl());
  await new Promise((res, rej) => { socket.addEventListener('open', res, {once:true}); socket.addEventListener('error', rej, {once:true}); });
  let id = 0; const pending = new Map();
  socket.addEventListener('message', (e) => {
    const p = JSON.parse(e.data);
    if (p.id && pending.has(p.id)) { const { resolve, reject } = pending.get(p.id); pending.delete(p.id); p.error ? reject(new Error(JSON.stringify(p.error))) : resolve(p.result); }
  });
  const send = (m, params = {}) => new Promise((resolve, reject) => { id += 1; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method: m, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.value;

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE }); await sleep(4000);

  check('Показан экран входа', (await ev("!!document.querySelector('.login__card')")) === true);
  check('Данные журнала скрыты до ввода кода', (await ev("document.querySelectorAll('.kpi').length")) === 0);

  await ev("(() => { const el = document.querySelector('.login__card input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(el,'wrong-token-000'); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
  await ev("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Открыть журнал')).click()");
  await sleep(2500);
  check('Неверный код даёт понятную ошибку', (await ev("!!document.querySelector('.login__error')")) === true, String(await ev("document.querySelector('.login__error')?.textContent")));

  await ev(`(() => { const el = document.querySelector('.login__card input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(el, ${JSON.stringify(TOKEN)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await ev("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Открыть журнал')).click()");
  await sleep(4000);
  check('После верного кода открывается журнал', (await ev("!!document.querySelector('.topbar')")) === true);
  check('Код сохранился в браузере', (await ev("localStorage.getItem('avtozhurnal.accessToken') !== null")) === true);

  await send('Page.navigate', { url: `${BASE}/#/settings` }); await sleep(4000);
  check('После перезагрузки вход не требуется', (await ev("!!document.querySelector('.topbar') && !document.querySelector('.login__card')")) === true);

  socket.close();
} catch (error) {
  check('Проверка в браузере выполнена без исключений', false, error.message);
} finally {
  chrome.kill('SIGKILL');
}

console.log(failures === 0 ? '\nКод доступа работает как задумано.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
