#!/usr/bin/env node
/**
 * Проверка REST API «АвтоЖурнала» на живом сервере: успешные сценарии,
 * негативные случаи и устойчивость сервера к некорректным данным.
 *
 * Запуск (сервер должен быть поднят):
 *   BASE_URL=http://localhost:4000 node scripts/api-smoke-test.mjs
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function callBytes(path) {
  const response = await fetch(`${BASE}${path}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, buffer, headers: response.headers };
}

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

const health = await call('/api/health');
check('GET /api/health отвечает 200 и ok:true', health.status === 200 && health.body?.ok === true);

// Загрузка демо-набора затирает весь журнал. Проверяем, что перед нами тестовая база,
// иначе останавливаемся: этот тест однажды стёр рабочую базу владельца.
const before = await call('/api/vehicles');
const existingNames = Array.isArray(before.body) ? before.body.map((v) => String(v.name ?? '')) : [];
const looksLikeTestData = existingNames.every((name) => /^(Веста|Leaf|Тестовая|Демо|Импортированная)/i.test(name));
if (existingNames.length && !looksLikeTestData && process.env.SMOKE_FORCE !== '1') {
  console.error('ОСТАНОВЛЕНО: в базе есть данные, не похожие на демонстрационные —');
  console.error(`  машины: ${existingNames.join(', ')}`);
  console.error('Тест загружает демо-набор и затрёт журнал. Запустите его на отдельном каталоге:');
  console.error('  DATA_DIR=./data-smoke PORT=4444 npm start, затем BASE_URL=http://localhost:4444 node scripts/api-smoke-test.mjs');
  console.error('Осознанный запуск против этой базы: SMOKE_FORCE=1');
  process.exit(2);
}

const demo = await call('/api/demo', { method: 'POST', body: JSON.stringify({ confirm: true }) });
const counts = demo.body?.summary ?? {};
check(
  'POST /api/demo создаёт демонстрационный набор',
  demo.status === 200 && counts.vehicles === 2 && counts.fuel > 20,
  `авто ${counts.vehicles}, заправок ${counts.fuel}, расходов ${counts.expenses}, регламентов ${counts.rules}`,
);

const vehicles = await call('/api/vehicles');
const vehicleId = vehicles.body?.[0]?.id;
check('GET /api/vehicles возвращает два автомобиля', vehicles.body?.length === 2, `получено: ${vehicles.body?.length}`);

const overview = await call(`/api/stats/overview?vehicleId=${vehicleId}`);
check(
  'GET /api/stats/overview считает расход и стоимость километра',
  overview.status === 200 && typeof overview.body?.l100km === 'number' && typeof overview.body?.costPerKm === 'number',
  `расход ${overview.body?.l100km}, метод ${overview.body?.consumptionMethod}, ₽/км ${overview.body?.costPerKm}`,
);

const reminders = await call(`/api/reminders?vehicleId=${vehicleId}`);
const statuses = (reminders.body?.items ?? []).map((item) => item.status);
check(
  'GET /api/reminders отдаёт статусы регламентов',
  reminders.status === 200 && statuses.length > 0,
  `статусы: ${statuses.join(', ')}`,
);

const dossier = await call(`/api/reports/dossier?vehicleId=${vehicleId}`);
check(
  'GET /api/reports/dossier собирает авто-досье',
  dossier.status === 200 && Boolean(dossier.body?.economics) && Array.isArray(dossier.body?.maintenance),
  `разделов обслуживания: ${dossier.body?.maintenance?.length}`,
);

for (const type of ['fuel', 'expenses', 'incomes', 'all']) {
  // Читаем именно байты: BOM — часть файла, а fetch().text() его съедает при декодировании.
  const csv = await callBytes(`/api/export/csv?type=${type}`);
  const hasBom = csv.buffer[0] === 0xef && csv.buffer[1] === 0xbb && csv.buffer[2] === 0xbf;
  const text = csv.buffer.toString('utf8');
  const header = text.replace(/^\uFEFF/, '').split('\r\n')[0];
  check(
    `CSV «${type}» начинается с BOM (EF BB BF) и использует «;»`,
    // У файла «всё» первая строка — заголовок раздела, поэтому разделитель ищем в целом тексте.
    csv.status === 200 && hasBom && (header.includes(';') || text.includes(';')),
    `BOM: ${hasBom ? 'да' : 'нет'}, заголовок: ${header.slice(0, 40)}…`,
  );
}

/* ── Пакеты регламентов ТО ── */

const demoPack = {
  schemaVersion: 1,
  revision: 2,
  packId: 'smoke.test.pack',
  title: 'Проверочный пакет регламента',
  source: 'owner-manual',
  sourceUrl: 'https://example.org/manual.pdf',
  vendor: 'Lada',
  models: ['Vesta'],
  yearFrom: 2015,
  yearTo: 2030,
  fuelTypes: ['petrol'],
  engineCodes: [],
  usageMultiplier: { city: 0.8 },
  disclaimer: 'Проверочный пакет: интервалы выдуманы для теста, не применяйте к реальной машине.',
  items: [
    { code: 'smoke-oil', name: 'Проверочная замена масла', everyKm: 15000, everyMonths: 12, lifeKm: 15000, severity: 'required', category: 'maintenance', notes: 'Из пакета', estimatedCost: 6000, parts: [] },
    { code: 'smoke-filter', name: 'Проверочный фильтр', everyKm: 30000, everyMonths: null, lifeKm: 30000, severity: 'recommended', category: 'maintenance', notes: '', estimatedCost: 1500, parts: [{ name: 'Масляный фильтр', article: 'SMOKE-FILTER-1', quantity: 1 }] },
  ],
};

const imported = await call('/api/regulations/import', { method: 'POST', body: JSON.stringify({ pack: demoPack }) });
check(
  'Пакет регламентов импортируется и проверяется',
  imported.status === 201 && (imported.body?.saved ?? []).includes('smoke.test.pack'),
  `HTTP ${imported.status}, сохранено: ${(imported.body?.saved ?? []).join(', ') || imported.body?.error}`,
);

const brokenPack = await call('/api/regulations/import', {
  method: 'POST',
  body: JSON.stringify({ pack: { packId: 'broken', title: 'Битый', items: [{ code: 'x', name: 'Без интервалов' }] } }),
});
check('Пакет без интервалов отклоняется', brokenPack.status === 400, `HTTP ${brokenPack.status}: ${brokenPack.body?.error}`);

const matched = await call(`/api/regulations/match?vehicleId=${vehicleId}`);
check(
  'Пакет подбирается под автомобиль',
  matched.status === 200 && (matched.body?.packs ?? []).some((pack) => pack.packId === 'smoke.test.pack'),
  `найдено пакетов: ${(matched.body?.packs ?? []).length}`,
);

// Пользователь правит интервал вручную — пакет потом не должен его перезаписать
const manualRule = await call('/api/rules', {
  method: 'POST',
  body: JSON.stringify({
    vehicleId, name: 'Проверочная замена масла', intervalKm: 9000, intervalDays: 180, componentLifeKm: 9000,
    // Пункт создаёт человек: origin не задаём — сервер помечает его как пользовательский.
    warnKmBefore: 1000, warnDaysBefore: 14, code: 'smoke-oil', notes: 'Масло 5W-30, фильтр MANN',
  }),
});
const manualId = manualRule.body?.id;
check('Пункт пакета создан вручную с заметками', manualRule.status === 201 && Boolean(manualId));

const preview = await call('/api/regulations/preview', {
  method: 'POST',
  body: JSON.stringify({ vehicleId, packId: 'smoke.test.pack', mode: 'update-untouched' }),
});
check(
  'Предпросмотр показывает, что изменится',
  preview.status === 200 && typeof preview.body?.added === 'number' && Array.isArray(preview.body?.preview),
  `добавить ${preview.body?.added}, обновить ${preview.body?.updated}, оставить ${preview.body?.kept}`,
);

const applied = await call('/api/regulations/apply', {
  method: 'POST',
  body: JSON.stringify({ vehicleId, packId: 'smoke.test.pack', mode: 'update-untouched' }),
});
check('Пакет применяется к автомобилю', applied.status === 200 && applied.body?.ok === true, applied.body?.message);

const rulesAfter = await call(`/api/rules?vehicleId=${vehicleId}`);
const keptRule = (rulesAfter.body ?? []).find((rule) => rule.id === manualId);
check(
  'Ручной интервал и заметки пользователя сохранены',
  keptRule?.intervalKm === 9000 && keptRule?.notes === 'Масло 5W-30, фильтр MANN',
  `интервал ${keptRule?.intervalKm}, заметки: ${keptRule?.notes}`,
);
check(
  'Из пакета добавились недостающие пункты с заводскими интервалами',
  (rulesAfter.body ?? []).some((rule) => rule.code === 'smoke-filter' && rule.intervalKm === 30000 && rule.origin === 'pack'),
  `пунктов всего: ${(rulesAfter.body ?? []).length}`,
);
const withPack = (rulesAfter.body ?? []).find((rule) => rule.code === 'smoke-filter');
check(
  'У применённого пункта видно источник и ревизию пакета',
  Boolean(withPack?.packTitle) && Number(withPack?.packRevision) === 2,
  `${withPack?.packTitle} (ревизия ${withPack?.packRevision})`,
);

/* ── Смета на ТО: черновик из истории, сохранение, превращение в расход ── */

// Сначала кладём в склад запчасть, чтобы подсказка цены нашла её по артикулу.
await call('/api/parts', {
  method: 'POST',
  body: JSON.stringify({ vehicleId, name: 'Масляный фильтр', article: 'SMOKE-FILTER-1', vendor: 'Exist', price: 890, quantity: 1 }),
});

const stationRule = (await call(`/api/rules?vehicleId=${vehicleId}`)).body?.find((rule) => rule.code === 'smoke-filter');
const draft = await call('/api/estimates/draft', {
  method: 'POST',
  body: JSON.stringify({ vehicleId, ruleId: stationRule?.id, laborRate: 2500 }),
});
check(
  'Смета собирается по пункту регламента',
  draft.status === 200 && Array.isArray(draft.body?.parts) && draft.body.parts.length > 0,
  `${draft.body?.parts?.length} позиций, итог ${draft.body?.total} ₽`,
);
check(
  'Состав берётся из пакета, цены — из истории журнала',
  typeof draft.body?.notes === 'string' && draft.body.notes.includes('пакета'),
  String(draft.body?.notes).slice(0, 80),
);
check(
  'Итог сметы = детали + работы',
  (() => {
    const parts = draft.body?.parts ?? [];
    const expected = parts.reduce((acc, row) => acc + row.quantity * row.unitPrice, 0) + draft.body.laborHours * draft.body.laborRatePerHour;
    return Math.abs(expected - draft.body.total) < 0.01;
  })(),
  `итог ${draft.body?.total} ₽, достоверность ${draft.body?.confidence}`,
);

// Цена подтянулась из склада по артикулу
const pricedPart = (draft.body?.parts ?? []).find((row) => row.article === 'SMOKE-FILTER-1');
check('Цена позиции подсказана из склада', !pricedPart || pricedPart.priceSource === 'history', pricedPart ? `источник: ${pricedPart.priceSource}, цена ${pricedPart.unitPrice}` : 'в пакете нет артикулов — проверка неприменима');

const saved = await call('/api/estimates', { method: 'POST', body: JSON.stringify({ ...draft.body, vehicleId }) });
check('Смета сохраняется', saved.status === 201 && Boolean(saved.body?.id), `${saved.body?.title} — ${saved.body?.total} ₽`);

const accepted = await call(`/api/estimates/${saved.body.id}/accept`, { method: 'POST', body: JSON.stringify({}) });
const expensesAfter = await call(`/api/expenses?vehicleId=${vehicleId}`);
const createdExpense = (expensesAfter.body ?? []).find((row) => row.id === accepted.body?.expenseId);
check(
  'Принятая смета превращается в расход',
  accepted.status === 201 && Boolean(createdExpense) && createdExpense.amount === saved.body.total,
  `расход «${createdExpense?.description}» на ${createdExpense?.amount} ₽`,
);
check(
  'В расходе сохранена расшифровка сметы',
  typeof createdExpense?.notes === 'string' && createdExpense.notes.includes('Из сметы'),
  String(createdExpense?.notes).slice(0, 70),
);

const acceptedAgain = await call(`/api/estimates/${saved.body.id}/accept`, { method: 'POST', body: JSON.stringify({}) });
check('Повторное принятие не создаёт второй расход', acceptedAgain.body?.alreadyAccepted === true, String(acceptedAgain.body?.message));

/* ── Цены по АЗС ── */

const stations = await call(`/api/stats/stations?vehicleId=${vehicleId}`);
const stationRows = stations.body ?? [];
check(
  'GET /api/stats/stations отдаёт цены по каждой АЗС',
  stations.status === 200 && stationRows.length > 0 && stationRows.every((row) => typeof row.lastPrice === 'number'),
  stationRows.slice(0, 3).map((row) => `${row.station}: ${row.lastPrice} ₽`).join(', '),
);
check(
  'Цены на разных АЗС различаются — подставлять среднюю нельзя',
  new Set(stationRows.map((row) => row.lastPrice)).size > 1,
  `разных цен: ${new Set(stationRows.map((row) => row.lastPrice)).size} из ${stationRows.length}`,
);

/* ── Выводы: стиль вождения, прогноз износа, стоимость владения ── */

const insights = await call(`/api/stats/insights?vehicleId=${vehicleId}`);
const style = insights.body?.style;
check(
  'GET /api/stats/insights отдаёт выводы',
  insights.status === 200 && Boolean(style) && Array.isArray(insights.body?.forecast) && Boolean(insights.body?.ownership),
);
if (style) {
  // Независимая проверка: множитель износа должен соответствовать отклонению расхода от нормы.
  const expectedFactor = Math.min(1.35, Math.max(0.85, 1 + (style.deviationPercent / 10) * 0.04));
  check(
    'Множитель износа согласуется с отклонением расхода',
    Math.abs(style.wearFactor - expectedFactor) < 0.05,
    `отклонение ${style.deviationPercent} %, множитель ${style.wearFactor} (ожидалось около ${expectedFactor.toFixed(2)})`,
  );
}
const forecastWithDates = (insights.body?.forecast ?? []).filter((item) => item.predictedDate);
check(
  'У прогноза по деталям есть даты',
  forecastWithDates.length > 0 && forecastWithDates.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.predictedDate)),
  `с датами: ${forecastWithDates.length} из ${(insights.body?.forecast ?? []).length}`,
);
check(
  'Вывод по продаже помечен как ориентир, а не рекомендация',
  typeof insights.body?.ownership?.explanation === 'string' && insights.body.ownership.explanation.includes('не финансовая рекомендация'),
  insights.body?.ownership?.verdict,
);

/* ── Календарь напоминаний о ТО ── */

// Список регламентов мог измениться из-за проверок выше — берём актуальный
const remindersNow = await call(`/api/reminders?vehicleId=${vehicleId}`);
const calendar = await callBytes(`/api/reminders/calendar.ics?vehicleId=${vehicleId}`);
const ics = calendar.buffer.toString('utf8');
const eventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
check(
  'Файл календаря напоминаний отдаётся как text/calendar',
  calendar.status === 200 && String(calendar.headers.get('content-type')).startsWith('text/calendar'),
  `HTTP ${calendar.status}, тип ${calendar.headers.get('content-type')}`,
);
check(
  'Файл календаря структурно корректен',
  ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR') && ics.includes('VERSION:2.0'),
);
check('Строки разделены по стандарту формата (CRLF)', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
// Событие получает каждый пункт, для которого можно определить дату:
// либо у него есть срок по дате, либо известно, через сколько километров он наступит.
const datedRules = (remindersNow.body?.items ?? []).filter(
  (item) => item.remainingDays !== null || item.remainingKm !== null,
).length;
check(
  'Событие есть у каждого пункта с определённым сроком',
  eventCount === datedRules,
  `событий: ${eventCount}, пунктов со сроком: ${datedRules} из ${(remindersNow.body?.items ?? []).length}`,
);
check(
  'В каждом событии есть дата и предупреждение заранее',
  ics.includes('DTSTART;VALUE=DATE:') && (ics.match(/TRIGGER:-P\d+D/g) ?? []).length === eventCount,
  `напоминаний: ${(ics.match(/TRIGGER:-P\d+D/g) ?? []).length}`,
);

const backup = await call('/api/export/json');
check('GET /api/export/json отдаёт бэкап со всеми коллекциями', backup.status === 200 && Array.isArray(backup.body?.fuel), `записей топлива: ${backup.body?.fuel?.length}`);

/* ── Негативные сценарии: сервер обязан отвечать 400 и оставаться живым ── */

const badOdometer = await call('/api/fuel', {
  method: 'POST',
  body: JSON.stringify({ vehicleId, date: '2026-09-01', odometer: 10, volume: 10, pricePerUnit: 60, totalCost: 600, isFullTank: true }),
});
check(
  'Заправка с одометром меньше предыдущего отклоняется (400)',
  badOdometer.status === 400 && typeof badOdometer.body?.error === 'string',
  `${badOdometer.status}: ${badOdometer.body?.error}`,
);

const badAmount = await call('/api/expenses', { method: 'POST', body: JSON.stringify({ vehicleId, date: '2026-09-01', category: 'wash' }) });
check('Расход без суммы отклоняется (400)', badAmount.status === 400, `${badAmount.status}: ${badAmount.body?.error}`);

const badTheme = await call('/api/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'neon' }) });
check('Недопустимая тема отклоняется (400)', badTheme.status === 400, `${badTheme.status}: ${badTheme.body?.error}`);

const badImport = await call('/api/import/json', { method: 'POST', body: JSON.stringify({ mode: 'replace', data: { foo: 'bar' } }) });
check('Восстановление из постороннего JSON отклоняется (400)', badImport.status === 400, `${badImport.status}: ${badImport.body?.error}`);

const badVehicle = await call('/api/vehicles', { method: 'POST', body: JSON.stringify({ name: '' }) });
check('Автомобиль без названия отклоняется (400)', badVehicle.status === 400, `${badVehicle.status}: ${badVehicle.body?.error}`);

const mixedImport = await call('/api/import/json', {
  method: 'POST',
  body: JSON.stringify({
    mode: 'merge',
    data: {
      vehicles: [
        { id: 'imported-1', name: 'Импортированная машина', make: 'Kia', model: 'Rio', fuelType: 'petrol', tankCapacity: 50, initialOdometer: 100 },
        null,
        'мусор',
        { name: '' },
      ],
    },
  }),
});
check(
  'Восстановление с битыми строками: валидная строка добавляется, повреждённые пропускаются',
  mixedImport.status === 200 && mixedImport.body?.added?.vehicles === 1 && (mixedImport.body?.skipped ?? 0) >= 3,
  `добавлено авто: ${mixedImport.body?.added?.vehicles}, пропущено строк: ${mixedImport.body?.skipped}`,
);

const unknownRoute = await call('/api/такого-нет');
check('Неизвестный метод API возвращает JSON 404', unknownRoute.status === 404 && Boolean(unknownRoute.body?.error), `${unknownRoute.status}`);

const healthAfter = await call('/api/health');
check(
  'Сервер выжил после всех некорректных запросов',
  healthAfter.status === 200 && healthAfter.body?.ok === true,
  `авто: ${healthAfter.body?.vehicles}, заправок: ${healthAfter.body?.fuelEntries}`,
);

console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
