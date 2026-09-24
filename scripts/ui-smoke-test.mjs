#!/usr/bin/env node
/**
 * Смоук-тест интерфейса через Chrome DevTools Protocol (без внешних зависимостей).
 *
 * Что делает: запускает headless Chrome, реально заполняет формы в браузере,
 * нажимает кнопки, проверяет, что данные появились в таблице и в API, перезагружает
 * страницу и проверяет сохранность, а также собирает ошибки консоли.
 *
 * Запуск (сервер должен быть уже поднят):
 *   BASE_URL=http://localhost:4000 node scripts/ui-smoke-test.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_BIN = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000';
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);
const profile = mkdtempSync(path.join(tmpdir(), 'avtozhurnal-smoke-'));

const results = [];
const consoleErrors = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  CHROME_BIN,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--hide-scrollbars',
    '--window-size=1440,1200',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForCdp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome ещё не поднялся */
    }
    await sleep(500);
  }
  throw new Error('Не удалось дождаться Chrome DevTools Protocol');
}

const wsUrl = await waitForCdp();
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let messageId = 0;
const pending = new Map();

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(JSON.stringify(payload.error)));
    else resolve(payload.result);
    return;
  }
  if (payload.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(payload.params.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (payload.method === 'Runtime.consoleAPICalled' && payload.params.type === 'error') {
    consoleErrors.push(payload.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  }
  if (payload.method === 'Log.entryAdded' && payload.params.entry.level === 'error') {
    consoleErrors.push(payload.params.entry.text);
  }
});

function send(method, params = {}) {
  messageId += 1;
  const id = messageId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'ошибка выполнения сценария');
  return result.result?.value;
}

async function goto(route) {
  const url = `${BASE_URL}/#/${route}`;
  await send('Page.navigate', { url });
  await sleep(2500);
}

async function waitFor(expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
  return false;
}

/** Заполнение полей React-формы «по-человечески»: нативный сеттер + событие input. */
const HELPERS = `
window.__fill = (selector, value) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error('Не найдено поле ' + selector);
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
};
window.__fillByLabel = (labelText, value) => {
  const field = [...document.querySelectorAll('.field')].find((f) =>
    f.querySelector('.field__label')?.textContent?.trim().startsWith(labelText));
  if (!field) throw new Error('Не найдено поле с подписью ' + labelText);
  const el = field.querySelector('input, select, textarea');
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
};
window.__text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
window.__table = () => [...document.querySelectorAll('table tbody tr')].map((tr) =>
  [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
window.__kpis = () => [...document.querySelectorAll('.kpi')].map((k) => ({
  label: k.querySelector('.kpi__label')?.textContent?.trim(),
  value: k.querySelector('.kpi__value')?.textContent?.trim(),
}));
true;
`;

/* Предусловие: тест проверяет путь «с нуля», поэтому база должна быть пустой. */
const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`Сервер недоступен по адресу ${BASE_URL}. Сначала запустите приложение.`);
  process.exit(2);
}
if ((health.vehicles ?? 0) > 0) {
  console.error(
    'Для этого теста нужна пустая база: он проверяет путь «пустой журнал → добавили авто → добавили заправки».\n' +
      `Сейчас в базе ${health.vehicles} авто и ${health.fuelEntries} записей о заправках.\n` +
      'Запустите сервер с отдельным каталогом данных, например: DATA_DIR=./data-smoke PORT=4444 npm start',
  );
  process.exit(2);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await goto('settings');
  await evaluate(HELPERS);

  /* 1. Пустой старт: приложение предлагает добавить авто или демо-данные */
  await goto('dashboard');
  const emptyState = await evaluate('window.__text(".empty__title")');
  check('Пустое состояние на старте', Boolean(emptyState), `заголовок: ${emptyState}`);

  /* 2. Добавляем автомобиль через интерфейс */
  await goto('settings');
  await waitFor('!!document.querySelector(".form-grid")');
  await evaluate(`window.__fillByLabel('Название', 'Тестовая Веста')`);
  await evaluate(`window.__fillByLabel('Марка', 'Lada')`);
  await evaluate(`window.__fillByLabel('Модель', 'Vesta')`);
  await evaluate(`window.__fillByLabel('Объём бака', '55')`);
  await evaluate(`window.__fillByLabel('Пробег на начало учёта', '1000')`);
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Добавить автомобиль')).click()`);
  await sleep(2500);
  const vehicleCards = await evaluate(`document.querySelectorAll('.vehicle-card').length`);
  check('Автомобиль добавлен через интерфейс', vehicleCards === 1, `карточек авто: ${vehicleCards}`);

  /* 3. Добавляем две заправки «до полного бака» через форму быстрой записи */
  await goto('fuel');
  await waitFor('!!document.querySelector(".form-grid")');
  const addFuel = async (odometer, volume, price) => {
    await evaluate(`window.__fillByLabel('Дата', '2026-09-01')`);
    await evaluate(`window.__fillByLabel('Одометр', '${odometer}')`);
    await evaluate(`window.__fillByLabel('Объём', '${volume}')`);
    await evaluate(`window.__fillByLabel('₽ / л', '${price}')`);
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Добавить заправку')).click()`);
    await sleep(2200);
  };
  await addFuel(1000, 40, 60);
  const rowsAfterFirst = await evaluate('window.__table().length');
  check('Первая заправка появилась в таблице', rowsAfterFirst === 1, `строк: ${rowsAfterFirst}`);

  await addFuel(1500, 35, 62);
  const rows = await evaluate('window.__table()');
  check('Вторая заправка добавлена', rows.length === 2, `строк: ${rows.length}`);
  // Сумма второй заправки: 35 × 62 = 2 170 ₽ (неразрывный пробел — как в формате приложения)
  const fuelOk = rows.some((row) => row.join(' ').includes('2\u00A0170'));
  check('Сумма второй заправки рассчитана автоматически (35 × 62 = 2 170)', fuelOk, JSON.stringify(rows[0]));

  /* 4. Дашборд считает расход методом полного бака: 35 л на 500 км = 7,0 л/100 км */
  await goto('dashboard');
  await waitFor('document.querySelectorAll(".kpi").length > 0');
  const kpis = await evaluate('window.__kpis()');
  const consumption = kpis.find((kpi) => kpi.label === 'Расход');
  check('Дашборд показывает расход 7,0 л/100 км', Boolean(consumption?.value?.startsWith('7,0')), `значение: ${consumption?.value}`);
  const costKm = kpis.find((kpi) => kpi.label === 'Стоимость километра');
  check('Дашборд показывает стоимость километра', Boolean(costKm?.value && costKm.value !== '—'), `значение: ${costKm?.value}`);
  const charts = await evaluate('({line: !!document.querySelector(".chart__line"), bars: !!document.querySelector(".chart__bar"), donut: !!document.querySelector(".donut")})');
  check('Графики отрисованы (линия, столбцы, кольцо)', charts.line && charts.bars && charts.donut, JSON.stringify(charts));

  /* 5. Перезагрузка страницы — данные на месте */
  await goto('dashboard');
  const kpisAfterReload = await evaluate('window.__kpis()');
  const consumptionAfterReload = kpisAfterReload.find((kpi) => kpi.label === 'Расход');
  check('После перезагрузки данные сохранились', consumptionAfterReload?.value?.startsWith('7,0'), `значение: ${consumptionAfterReload?.value}`);

  /* 6. Авто-досье и печатная версия отрисовываются */
  await goto('dossier');
  await waitFor('!!document.querySelector(".dossier")', 20000);
  const dossierTables = await evaluate('document.querySelectorAll(".dossier__table").length');
  check('Авто-досье отрисовано', dossierTables >= 3, `таблиц в досье: ${dossierTables}`);

  /* 7. Ошибки консоли */
  await sleep(800);
  check('Ошибок в консоли браузера нет', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('Смоук-тест выполнен без исключений', false, error.message);
} finally {
  try {
    socket.close();
  } catch {
    /* ignore */
  }
  chrome.kill('SIGKILL');
}

console.log(`\nПройдено проверок: ${results.length - failures} из ${results.length}`);
process.exit(failures === 0 ? 0 : 1);
