/**
 * Единые правила форматирования чисел и дат.
 * Используются и на сервере (CSV, авто-досье), и в интерфейсе,
 * чтобы одни и те же значения выглядели одинаково на всех экранах.
 */

const RU_MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

const RU_MONTHS_FULL = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** Деньги: 1 234,56 ₽ */
export function formatMoney(value: number | null | undefined, currency = 'RUB'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = currency === 'RUB' ? '₽' : currency;
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 100) / 100;
  const [int, frac] = rounded.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const tail = frac === '00' ? '' : `,${frac}`;
  return `${value < 0 ? '−' : ''}${grouped}${tail}\u00A0${sign}`;
}

/** Деньги без копеек — для компактных KPI-карточек. */
export function formatMoneyShort(value: number | null | undefined, currency = 'RUB'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = currency === 'RUB' ? '₽' : currency;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace('.', ',')}\u00A0млн\u00A0${sign}`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}\u00A0тыс.\u00A0${sign}`;
  return formatMoney(value, currency);
}

/** Число с фиксированным количеством знаков и запятой как разделителем. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

/** Расход: 7,8 л/100 км */
export function formatConsumption(value: number | null | undefined, unit = 'л/100 км'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatNumber(value, 1)}\u00A0${unit}`;
}

/** Пробег: 128 400 км */
export function formatOdometer(value: number | null | undefined, unit = 'км'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')}\u00A0${unit}`;
}

/** Дата из YYYY-MM-DD в 21.09.2026 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y}`;
}

/** «сен 2026» из YYYY-MM */
export function formatMonthKey(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || !RU_MONTHS_SHORT[idx]) return key;
  return `${RU_MONTHS_SHORT[idx]} ${y}`;
}

/** «сентябрь 2026» из YYYY-MM */
export function formatMonthKeyFull(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || !RU_MONTHS_FULL[idx]) return key;
  return `${RU_MONTHS_FULL[idx]} ${y}`;
}

/** Склонение: 1 день / 2 дня / 5 дней */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function formatDays(n: number): string {
  return `${Math.round(n)} ${plural(n, 'день', 'дня', 'дней')}`;
}

export function formatKm(n: number): string {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')} ${plural(n, 'километр', 'километра', 'километров')}`;
}

/** Сегодняшняя дата в формате YYYY-MM-DD (локальное время, без сдвига часового пояса). */
export function todayISO(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Ключ месяца YYYY-MM из даты YYYY-MM-DD. */
export function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** Прибавить дни к дате YYYY-MM-DD. */
export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Разница в днях между двумя датами YYYY-MM-DD (b − a). */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
