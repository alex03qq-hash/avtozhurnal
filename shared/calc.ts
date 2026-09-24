/**
 * Расчётное ядро «АвтоЖурнала».
 *
 * Здесь только чистые функции без обращения к сети и файлам: их одинаково
 * используют и сервер (REST-статистика, CSV, авто-досье), и интерфейс.
 * Все функции покрыты тестами в shared/__tests__.
 */

import { EXPENSE_CATEGORY_LABELS } from './constants';
import { addDays, daysBetween, monthKey } from './format';
import type {
  Expense,
  FuelEntry,
  Income,
  OverviewStats,
  RuleStatus,
  ServiceRule,
  Trip,
  Vehicle,
  WearStatus,
} from './types';

/* ─────────────────────────── Общие помощники ─────────────────────────── */

export function round(value: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round((value + Number.EPSILON) * k) / k;
}

/** Деление, которое честно возвращает null вместо Infinity/NaN. */
export function safeDivide(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function sortByOdometer<T extends { odometer: number | null; date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.odometer ?? 0;
    const bo = b.odometer ?? 0;
    if (ao !== bo) return ao - bo;
    return a.date.localeCompare(b.date);
  });
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

/** Текущий пробег: максимум из всех показаний одометра и начального значения. */
export function currentOdometer(
  vehicle: Vehicle,
  fuel: FuelEntry[],
  expenses: Expense[] = [],
  trips: Trip[] = [],
): number {
  const candidates: number[] = [vehicle.initialOdometer || 0];
  for (const f of fuel) if (f.vehicleId === vehicle.id && Number.isFinite(f.odometer)) candidates.push(f.odometer);
  for (const e of expenses) if (e.vehicleId === vehicle.id && e.odometer !== null) candidates.push(e.odometer);
  return Math.max(...candidates);
}

/* ─────────────────────────── Расход топлива ─────────────────────────── */

/**
 * Расход методом «полного бака» — эталонный способ.
 *
 * Между двумя заправками «до полного бака» израсходовано ровно столько топлива,
 * сколько было залито во все заправки этого отрезка (включая завершающую).
 * Поэтому расход = Σ объёмов заправок после предыдущей полной и до текущей полной
 * включительно, делённый на пройденное расстояние × 100.
 */
export function fuelConsumptionFullTank(entries: FuelEntry[]): import('./types').ConsumptionSegment[] {
  const fullTanks = entries
    .filter((e) => e.isFullTank)
    .sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date));

  const segments = [];
  for (let i = 1; i < fullTanks.length; i += 1) {
    const from = fullTanks[i - 1];
    const to = fullTanks[i];
    const distanceKm = to.odometer - from.odometer;
    if (distanceKm <= 0) continue;

    const between = entries.filter((e) => e.odometer > from.odometer && e.odometer <= to.odometer);
    const liters = sum(between.map((e) => e.volume));
    const cost = sum(between.map((e) => e.totalCost));
    if (liters <= 0) continue;

    segments.push({
      fromDate: from.date,
      toDate: to.date,
      fromOdometer: from.odometer,
      toOdometer: to.odometer,
      distanceKm: round(distanceKm, 1),
      liters: round(liters, 2),
      l100km: round((liters / distanceKm) * 100, 2),
      cost: round(cost, 2),
    });
  }
  return segments;
}

/**
 * Упрощённый расход: все залитые литры (кроме первой заправки) на весь пройденный путь.
 * Применяется, когда заправок «до полного бака» меньше двух.
 */
export function simplifiedConsumption(entries: FuelEntry[]): number | null {
  const sorted = [...entries].sort((a, b) => a.odometer - b.odometer);
  if (sorted.length < 2) return null;
  const distance = sorted[sorted.length - 1].odometer - sorted[0].odometer;
  if (distance <= 0) return null;
  const liters = sum(sorted.slice(1).map((e) => e.volume));
  if (liters <= 0) return null;
  return round((liters / distance) * 100, 2);
}

/** Средневзвешенный расход по всем отрезкам полного бака. */
export function weightedConsumption(segments: import('./types').ConsumptionSegment[]): number | null {
  const liters = sum(segments.map((s) => s.liters));
  const distance = sum(segments.map((s) => s.distanceKm));
  return safeDivide(liters, distance) === null ? null : round((liters / distance) * 100, 2);
}

export function averageConsumption(
  entries: FuelEntry[],
  method: 'auto' | 'full-tank' | 'simplified' = 'auto',
): { value: number | null; method: 'full-tank' | 'simplified' | 'none' } {
  const segments = fuelConsumptionFullTank(entries);
  if (method === 'full-tank') {
    const value = weightedConsumption(segments);
    return { value, method: value === null ? 'none' : 'full-tank' };
  }
  if (method === 'simplified') {
    const value = simplifiedConsumption(entries);
    return { value, method: value === null ? 'none' : 'simplified' };
  }
  const value = weightedConsumption(segments);
  if (value !== null) return { value, method: 'full-tank' };
  const fallback = simplifiedConsumption(entries);
  return { value: fallback, method: fallback === null ? 'none' : 'simplified' };
}

/* ─────────────────────────── Стоимость километра ─────────────────────────── */

/** Полная стоимость километра: топливо + все прочие расходы. */
export function costPerKm(fuelCost: number, otherCost: number, distanceKm: number): number | null {
  const value = safeDivide(fuelCost + otherCost, distanceKm);
  return value === null ? null : round(value, 2);
}

/** Стоимость километра только по топливу. */
export function fuelCostPerKm(fuelCost: number, distanceKm: number): number | null {
  const value = safeDivide(fuelCost, distanceKm);
  return value === null ? null : round(value, 2);
}

/* ─────────────────────────── Агрегаты ─────────────────────────── */

export interface PeriodTotals {
  fuelCost: number;
  otherCost: number;
  totalCost: number;
  income: number;
  profit: number;
  liters: number;
  distanceKm: number;
  records: number;
}

export function periodTotals(
  fuel: FuelEntry[],
  expenses: Expense[],
  incomes: Income[],
  from?: string,
  to?: string,
): PeriodTotals {
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const f = fuel.filter((e) => inRange(e.date));
  const e = expenses.filter((x) => inRange(x.date));
  const i = incomes.filter((x) => inRange(x.date));

  const fuelCost = sum(f.map((x) => x.totalCost));
  const otherCost = sum(e.map((x) => x.amount));
  const income = sum(i.map((x) => x.amount));

  let distanceKm = 0;
  const sortedFuel = [...f].sort((a, b) => a.odometer - b.odometer);
  if (sortedFuel.length >= 2) {
    distanceKm = Math.max(0, sortedFuel[sortedFuel.length - 1].odometer - sortedFuel[0].odometer);
  }

  return {
    fuelCost: round(fuelCost, 2),
    otherCost: round(otherCost, 2),
    totalCost: round(fuelCost + otherCost, 2),
    income: round(income, 2),
    profit: round(income - fuelCost - otherCost, 2),
    liters: round(sum(f.map((x) => x.volume)), 2),
    distanceKm: round(distanceKm, 1),
    records: f.length + e.length + i.length,
  };
}

export function overviewStats(
  vehicle: Vehicle | null,
  fuel: FuelEntry[],
  expenses: Expense[],
  incomes: Income[],
  today = new Date(),
): OverviewStats {
  const iso = today.toISOString().slice(0, 10);
  const year = iso.slice(0, 4);
  const month = iso.slice(0, 7);

  const all = periodTotals(fuel, expenses, incomes);
  const monthTotals = periodTotals(fuel, expenses, incomes, `${month}-01`, `${month}-31`);
  const yearTotals = periodTotals(fuel, expenses, incomes, `${year}-01-01`, `${year}-12-31`);
  const consumption = averageConsumption(fuel);

  const current = vehicle ? currentOdometer(vehicle, fuel, expenses) : 0;
  const totalDistance = vehicle ? Math.max(0, current - (vehicle.initialOdometer || 0)) : 0;

  return {
    vehicleId: vehicle?.id ?? null,
    currentOdometer: round(current, 0),
    totalDistanceKm: round(totalDistance, 1),
    l100km: consumption.value,
    consumptionMethod: consumption.method,
    costPerKm: costPerKm(all.fuelCost, all.otherCost, totalDistance),
    fuelCostPerKm: fuelCostPerKm(all.fuelCost, totalDistance),
    monthSpend: monthTotals.totalCost,
    yearSpend: yearTotals.totalCost,
    totalSpend: all.totalCost,
    totalFuelCost: all.fuelCost,
    totalOtherCost: all.otherCost,
    income: all.income,
    profit: round(all.income - all.totalCost, 2),
    fuelLiters: all.liters,
    entriesCount: all.records,
  };
}

/** Структура расходов по категориям. Доли округлены так, чтобы в сумме было ровно 100%. */
export function categoryBreakdown(
  fuel: FuelEntry[],
  expenses: Expense[],
): Array<{ category: string; label: string; amount: number; share: number }> {
  const map = new Map<string, number>();
  const fuelSum = sum(fuel.map((e) => e.totalCost));
  if (fuelSum > 0) map.set('fuel', fuelSum);
  for (const e of expenses) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  }

  const total = sum([...map.values()]);
  const rows = [...map.entries()]
    .map(([category, amount]) => ({
      category,
      label: category === 'fuel' ? 'Топливо' : (EXPENSE_CATEGORY_LABELS as Record<string, string>)[category] ?? category,
      amount: round(amount, 2),
      share: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Корректируем округление, чтобы сумма долей была ровно 100.
  let acc = 0;
  return rows.map((row, idx) => {
    const share = idx === rows.length - 1 ? round(100 - acc, 1) : round(row.share, 1);
    acc = round(acc + share, 1);
    return { ...row, share };
  });
}

/** Траты по месяцам за последние `months` месяцев, включая пустые месяцы. */
export function monthlySeries(
  fuel: FuelEntry[],
  expenses: Expense[],
  months = 12,
  today = new Date(),
): Array<{ key: string; label: string; fuel: number; other: number; total: number }> {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }

  return keys.map((key) => {
    const fuelSum = sum(fuel.filter((e) => monthKey(e.date) === key).map((e) => e.totalCost));
    const otherSum = sum(expenses.filter((e) => monthKey(e.date) === key).map((e) => e.amount));
    return {
      key,
      label: key,
      fuel: round(fuelSum, 2),
      other: round(otherSum, 2),
      total: round(fuelSum + otherSum, 2),
    };
  });
}

/* ─────────────────────────── Износ и напоминания ─────────────────────────── */

/**
 * Статус регламента: считается и по пробегу, и по дате, берётся худший результат.
 *   overdue — срок уже прошёл (остаток ≤ 0);
 *   soon    — остаток меньше или равен порогу предупреждения;
 *   ok      — всё в порядке.
 */
export function wearStatus(rule: ServiceRule, odometer: number, today = new Date()): WearStatus {
  const todayISO = today.toISOString().slice(0, 10);

  let remainingKm: number | null = null;
  let nextServiceOdometer: number | null = null;
  if (rule.intervalKm !== null && rule.lastServiceOdometer !== null) {
    nextServiceOdometer = rule.lastServiceOdometer + rule.intervalKm;
    remainingKm = round(nextServiceOdometer - odometer, 0);
  }

  let remainingDays: number | null = null;
  let nextServiceDate: string | null = null;
  if (rule.intervalDays !== null && rule.lastServiceDate) {
    nextServiceDate = addDays(rule.lastServiceDate, rule.intervalDays);
    remainingDays = daysBetween(todayISO, nextServiceDate);
  }

  let percentUsed: number | null = null;
  let usedKm: number | null = null;
  if (rule.componentLifeKm !== null && rule.lastServiceOdometer !== null) {
    usedKm = round(Math.max(0, odometer - rule.lastServiceOdometer), 0);
    percentUsed = round(Math.min(999, (usedKm / rule.componentLifeKm) * 100), 1);
  }

  const kmStatus: RuleStatus | null =
    remainingKm === null ? null : remainingKm <= 0 ? 'overdue' : remainingKm <= rule.warnKmBefore ? 'soon' : 'ok';
  const dayStatus: RuleStatus | null =
    remainingDays === null ? null : remainingDays <= 0 ? 'overdue' : remainingDays <= rule.warnDaysBefore ? 'soon' : 'ok';

  const severity: Record<RuleStatus, number> = { ok: 0, soon: 1, overdue: 2 };
  const candidates = [kmStatus, dayStatus].filter(Boolean) as RuleStatus[];
  const status: RuleStatus = candidates.length
    ? candidates.reduce((worst, s) => (severity[s] > severity[worst] ? s : worst), 'ok')
    : 'ok';

  return {
    ruleId: rule.id,
    name: rule.name,
    status,
    remainingKm,
    remainingDays,
    usedKm,
    percentUsed,
    nextServiceOdometer,
    nextServiceDate,
  };
}

/** Все регламенты автомобиля со статусами, отсортированные: просрочено → скоро → норма. */
export function buildReminders(rules: ServiceRule[], odometer: number, today = new Date()): WearStatus[] {
  const severity: Record<RuleStatus, number> = { overdue: 0, soon: 1, ok: 2 };
  return rules
    .map((rule) => wearStatus(rule, odometer, today))
    .sort((a, b) => {
      if (severity[a.status] !== severity[b.status]) return severity[a.status] - severity[b.status];
      const am = a.remainingKm ?? Number.POSITIVE_INFINITY;
      const bm = b.remainingKm ?? Number.POSITIVE_INFINITY;
      if (am !== bm) return am - bm;
      return (a.remainingDays ?? Number.POSITIVE_INFINITY) - (b.remainingDays ?? Number.POSITIVE_INFINITY);
    });
}

/* ─────────────────────────── Поездки и электромобили ─────────────────────────── */

/** Стоимость поездки: расстояние × средний расход × цена топлива. */
export function tripCost(distanceKm: number, avgL100km: number | null, pricePerLiter: number): number | null {
  if (avgL100km === null) return null;
  const liters = (distanceKm / 100) * avgL100km;
  return round(liters * pricePerLiter, 2);
}

/** Прибыль поездки: выручка минус стоимость. */
export function tripProfit(revenue: number | null, cost: number | null): number | null {
  if (revenue === null) return null;
  return round(revenue - (cost ?? 0), 2);
}

/** Средняя цена топлива за период — база для расчёта стоимости поездки. */
export function averageFuelPrice(fuel: FuelEntry[]): number | null {
  const liters = sum(fuel.map((e) => e.volume));
  const cost = sum(fuel.map((e) => e.totalCost));
  const value = safeDivide(cost, liters);
  return value === null ? null : round(value, 2);
}

/** Расход электроэнергии кВт·ч/100 км — та же логика, другая единица измерения. */
export function kwhPer100km(entries: FuelEntry[]): number | null {
  return averageConsumption(entries).value;
}

/* ─────────────────────────── Единицы измерения ─────────────────────────── */

export const LITERS_PER_US_GALLON = 3.785411784;
export const LITERS_PER_IMPERIAL_GALLON = 4.54609188;
export const KM_PER_MILE = 1.609344;

export function litersToGallons(liters: number, system: 'us' | 'imperial' = 'us'): number {
  return round(liters / (system === 'us' ? LITERS_PER_US_GALLON : LITERS_PER_IMPERIAL_GALLON), 3);
}

export function gallonsToLiters(gallons: number, system: 'us' | 'imperial' = 'us'): number {
  return round(gallons * (system === 'us' ? LITERS_PER_US_GALLON : LITERS_PER_IMPERIAL_GALLON), 3);
}

export function kmToMiles(km: number): number {
  return round(km / KM_PER_MILE, 3);
}

export function milesToKm(miles: number): number {
  return round(miles * KM_PER_MILE, 3);
}

/** Перевод л/100 км в MPG: US = 235.214583 / x, Imperial = 282.480936 / x. */
export function l100kmToMpg(value: number, system: 'us' | 'imperial' = 'us'): number | null {
  const factor = system === 'us' ? 235.214583 : 282.480936;
  const result = safeDivide(factor, value);
  return result === null ? null : round(result, 2);
}

export function mpgToL100km(mpg: number, system: 'us' | 'imperial' = 'us'): number | null {
  return l100kmToMpg(mpg, system);
}
