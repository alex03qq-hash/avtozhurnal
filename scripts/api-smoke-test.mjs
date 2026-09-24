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

const demo = await call('/api/demo', { method: 'POST' });
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
check(
  'Событий столько же, сколько регламентов ТО',
  eventCount === (reminders.body?.items?.length ?? -1),
  `событий: ${eventCount}, регламентов: ${reminders.body?.items?.length}`,
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
