#!/usr/bin/env node
/**
 * Проверка фото чеков: приём, выдача, привязка к записи, каскадное удаление
 * и загрузка файла прямо через интерфейс (эмуляция выбора фото на телефоне).
 *
 * Запуск (сервер должен быть поднят, база — пустая или с демо-данными):
 *   BASE_URL=http://localhost:4000 node scripts/photos-check.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const CHROME_BIN = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9700);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplePhoto = path.join(root, 'client', 'public', 'icons', 'icon-192.png');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, init) => fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });

/* 1×1 пиксель PNG — минимальное корректное изображение для проверки API. */
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const uploaded = await api('/api/photos', { method: 'POST', body: JSON.stringify({ dataUrl: tinyPng }) });
const uploadedBody = await uploaded.json().catch(() => ({}));
check('Фото принимается сервером', uploaded.status === 201 && Boolean(uploadedBody.id), `HTTP ${uploaded.status}`);

const readBack = await fetch(`${BASE}/api/photos/${uploadedBody.id}`);
check(
  'Фото отдаётся обратно с правильным типом',
  readBack.status === 200 && String(readBack.headers.get('content-type')).startsWith('image/'),
  `HTTP ${readBack.status}, ${readBack.headers.get('content-type')}`,
);

const broken = await api('/api/photos', { method: 'POST', body: JSON.stringify({ dataUrl: 'data:text/plain;base64,AAAA' }) });
check('Посторонний файл отклоняется', broken.status === 400, `HTTP ${broken.status}`);

const garbage = await api('/api/photos', { method: 'POST', body: JSON.stringify({ dataUrl: 'не картинка' }) });
check('Нераспознанные данные отклоняются', garbage.status === 400, `HTTP ${garbage.status}`);

const vehicles = await (await api('/api/vehicles')).json();
const vehicleId = vehicles[0]?.id;
// Одометр для проверочных записей берём выше любого существующего: сервер не принимает «откат» пробега.
const existingFuel = await (await api('/api/fuel')).json();
let nextOdometer = Math.max(0, ...existingFuel.map((row) => Number(row.odometer) || 0)) + 100;
const takeOdometer = () => (nextOdometer += 100);
if (!vehicleId) {
  check('Есть автомобиль для проверки', false, 'добавьте автомобиль или демо-данные');
} else {
  const odometer = takeOdometer();
  const record = await api('/api/fuel', {
    method: 'POST',
    body: JSON.stringify({ vehicleId, date: '2026-09-20', odometer, volume: 20, pricePerUnit: 60, totalCost: 1200, isFullTank: true, photoId: uploadedBody.id }),
  });
  const recordBody = await record.json();
  check('Заправка сохраняется вместе со ссылкой на фото', record.status === 201 && recordBody.photoId === uploadedBody.id, `HTTP ${record.status}`);

  const removed = await api(`/api/fuel/${recordBody.id}`, { method: 'DELETE' });
  check('Запись удаляется', removed.status === 200, `HTTP ${removed.status}`);

  await sleep(500);
  const afterCascade = await fetch(`${BASE}/api/photos/${uploadedBody.id}`);
  check('Вместе с записью удаляется её фото', afterCascade.status === 404, `HTTP ${afterCascade.status}`);
}

/* ── Главная проверка мысли: данные важнее снимка ── */

const dataPhoto = await (await api('/api/photos', { method: 'POST', body: JSON.stringify({ dataUrl: tinyPng }) })).json();
const dataOdometer = takeOdometer();
const withData = await api('/api/fuel', {
  method: 'POST',
  body: JSON.stringify({
    vehicleId,
    date: '2026-09-21',
    odometer: dataOdometer,
    volume: 42.5,
    pricePerUnit: 61.2,
    totalCost: 2601,
    isFullTank: true,
    station: 'Проверочная АЗС',
    photoId: dataPhoto.id,
  }),
});
const created = await withData.json();

const backup = await (await api('/api/export/json')).json();
const inBackup = (backup.fuel ?? []).find((row) => row.id === created.id);
check(
  'Резервная копия переносит данные чека',
  Boolean(inBackup) &&
    inBackup.volume === 42.5 &&
    inBackup.pricePerUnit === 61.2 &&
    inBackup.totalCost === 2601 &&
    inBackup.station === 'Проверочная АЗС' &&
    inBackup.odometer === dataOdometer,
  inBackup ? `объём ${inBackup.volume}, цена ${inBackup.pricePerUnit}, сумма ${inBackup.totalCost}` : 'запись не найдена в копии',
);

const removedPhoto = await api(`/api/photos/${dataPhoto.id}`, { method: 'DELETE' });
const removedBody = await removedPhoto.json().catch(() => ({}));
check('Снимок удаляется, ссылка в записи очищается', removedPhoto.status === 200 && removedBody.cleared === 1, `очищено ссылок: ${removedBody.cleared}`);

const afterPhotoLoss = await (await api(`/api/fuel/${created.id}`)).json();
const dataKept =
  afterPhotoLoss.volume === 42.5 &&
  afterPhotoLoss.pricePerUnit === 61.2 &&
  afterPhotoLoss.totalCost === 2601 &&
  afterPhotoLoss.date === '2026-09-21' &&
  afterPhotoLoss.odometer === dataOdometer;
check('После потери фото все данные записи на месте', dataKept === true, `объём ${afterPhotoLoss.volume}, сумма ${afterPhotoLoss.totalCost}, АЗС ${afterPhotoLoss.station}`);

const overviewAfter = await (await api('/api/stats/overview')).json();
check('Запись по-прежнему участвует в расчётах', typeof overviewAfter.totalSpend === 'number' && overviewAfter.totalSpend > 0, `всего потрачено ${overviewAfter.totalSpend} ₽`);

/* ── Загрузка фото через интерфейс (как с телефона) ── */

const profile = mkdtempSync(path.join(tmpdir(), 'avtozhurnal-photo-'));
const chrome = spawn(CHROME_BIN, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-component-update',`--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,'--window-size=1280,1000','about:blank'], { stdio: 'ignore' });

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

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Page.navigate', { url: `${BASE}/#/fuel` }); await sleep(4000);

  const document_ = await send('DOM.getDocument', { depth: -1 });
  const node = await send('DOM.querySelector', { nodeId: document_.root.nodeId, selector: "input[type=file]" });
  check('В форме заправки есть поле для фото', node.nodeId > 0);

  if (node.nodeId > 0) {
    await send('DOM.setFileInputFiles', { files: [samplePhoto], nodeId: node.nodeId });
    await sleep(4000);
    check('Фото обработалось и показано в форме', (await ev("!!document.querySelector('.photo-field__preview img')")) === true);
  }

  const uiOdometer = takeOdometer();
  await ev(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; const fill = (label, value) => { const field = [...document.querySelectorAll('.field')].find((f) => f.querySelector('.field__label')?.textContent?.trim().startsWith(label)); const el = field.querySelector('input'); set.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true })); }; fill('Одометр', ${uiOdometer}); fill('Объём', 30); fill('₽ / л', 61); return true; })()`);
  await ev("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Добавить заправку')).click()");
  await sleep(3500);

  const thumbs = await ev("document.querySelectorAll('.photo-thumb img').length");
  check('В таблице появилась миниатюра чека', Number(thumbs) > 0, `миниатюр: ${thumbs}`);

  await send('Page.navigate', { url: `${BASE}/#/fuel` }); await sleep(4000);
  const thumbsAfterReload = await ev("document.querySelectorAll('.photo-thumb img').length");
  check('Фото сохранилось после перезагрузки', Number(thumbsAfterReload) > 0, `миниатюр: ${thumbsAfterReload}`);

  socket.close();
} catch (error) {
  check('Проверка в браузере выполнена без исключений', false, error.message);
} finally {
  chrome.kill('SIGKILL');
}

console.log(failures === 0 ? '\nФото чеков работают.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
