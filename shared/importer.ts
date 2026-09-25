/**
 * Импорт истории из вставленного списка.
 *
 * Зачем: год расходов уже есть, а чеков нет. Выгрузка из приложения АЗС или банка — это текст
 * без привязки к машине и без одометра. Здесь мы разбираем такие строки, распределяем заправки
 * между автомобилями по пробегу и расставляем одометры по датам, честно помечая расчётные значения.
 *
 * Ни одного обращения наружу: только текст, который пользователь сам вставил.
 */

import { daysBetween } from './format.ts';
import { round } from './calc.ts';
import type { ExpenseCategory } from './types.ts';

/* ────────────────────────── Разбор дат и чисел ────────────────────────── */

const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, сент: 9, окт: 10, ноя: 11, дек: 12,
};

/** Понимает 12.07.2025, 12/07/2025, 2025-07-12, 12 июля 2025. */
export function parseDate(text: string): string | null {
  const trimmed = text.trim();

  const iso = trimmed.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dotted = trimmed.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // «12 июля 2025»: месяц ищем по первым трём буквам, поэтому «июля», «июль» и «июл.» подходят одинаково
  const words = trimmed.toLowerCase().match(/(\d{1,2})\s+([а-яё]{3,10})\.?\s+(\d{4})/);
  if (words) {
    const month = MONTHS[words[2].slice(0, 3)];
    if (month) {
      return `${words[3]}-${String(month).padStart(2, '0')}-${String(Number(words[1])).padStart(2, '0')}`;
    }
  }

  return null;
}

/** Число из строки: «3 100,50», «3100.5», «3.1 тыс.» не поддерживаем намеренно. */
export function parseAmount(text: string): number | null {
  const match = text.match(/(\d[\d \u00A0]{0,12}(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1].replace(/[ \u00A0]/g, '').replace(',', '.'));
  return Number.isFinite(value) ? round(value, 2) : null;
}

/* ────────────────────────── Заправки ────────────────────────── */

export interface ParsedFuelRow {
  date: string;
  volume: number | null;
  totalCost: number | null;
  station: string;
  /** Одометр, если он был в строке. */
  odometer: number | null;
  raw: string;
}

/**
 * Ищем объём: «45,2 л», «45 л», «45.2L».
 * Важно: кириллица в JavaScript не считается «словом», поэтому \b рядом с «л» не работает —
 * используем явную проверку следующего символа.
 */
function extractVolume(line: string): number | null {
  const withUnit = line.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:литр\w*|л(?!и|а|ь)|l(?![a-zа-я]))/i);
  if (withUnit) return parseAmount(withUnit[1]);
  return null;
}

/** Сумма — число с валютой; иначе последнее число в строке. */
function extractMoney(line: string): number | null {
  const withCurrency = line.match(/(\d[\d \u00A0]{0,12}(?:[.,]\d{1,2})?)\s*(?:₽|рублей|руб\.?|р\.)(?![а-яa-z])/i);
  if (withCurrency) return parseAmount(withCurrency[1]);
  const numbers = [...line.matchAll(/\d[\d \u00A0]{0,12}(?:[.,]\d{1,2})?/g)].map((m) => parseAmount(m[0]) ?? 0);
  const candidates = numbers.filter((value) => value >= 50);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * Разбирает строки выгрузки АЗС. Форматы бывают разные, поэтому порядок такой:
 * дата — объём (с «л») — сумма (с «₽» или последняя) — одометр (если есть) — АЗС (остаток текста).
 */
export function parseFuelRows(text: string): ParsedFuelRow[] {
  const rows: ParsedFuelRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 6) continue;

    const date = parseDate(line);
    if (!date) continue;

    const volume = extractVolume(line);
    const totalCost = extractMoney(line);

    // Одометр берём только там, где он прямо помечен: «54 300 км».
    // Иначе легко подхватить год из даты — так и получилось на первой проверке.
    const odometerMatch = line.match(/(\d[\d \u00A0]{2,8})\s*км(?![а-я])/i);
    const odometer = odometerMatch ? parseAmount(odometerMatch[1].replace(/[\s\u00A0]/g, '')) : null;

    // АЗС — то, что осталось после даты, чисел и единиц
    let station = line
      .replace(/\d{1,4}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, ' ')
      .replace(/\d[\d \u00A0]{0,12}(?:[.,]\d{1,2})?\s*(?:литр\w*|л(?!и|а|ь)|l(?![a-zа-я])|₽|рублей|руб\.?|р\.|км(?![а-я]))/gi, ' ')
      .replace(/\b\d{4,7}\b/g, ' ')
      .replace(/[|;,]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (volume === null && totalCost === null) continue;
    rows.push({ date, volume, totalCost, station: station.slice(0, 80), odometer, raw: line.slice(0, 200) });
  }
  return rows;
}

/* ────────────────────────── Расходы ────────────────────────── */

export interface ParsedExpenseRow {
  date: string;
  amount: number;
  description: string;
  /** Категория, угаданная по словам в описании. Может быть null — тогда берётся выбранная по умолчанию. */
  categoryHint: ExpenseCategory | null;
  raw: string;
}

const CATEGORY_KEYWORDS: Array<{ category: ExpenseCategory; words: RegExp }> = [
  { category: 'insurance', words: /страх|осаго|каско|полис/i },
  { category: 'tax', words: /налог|госпошлин|пошлин/i },
  { category: 'fine', words: /штраф|гибдд|цaфap|цафар/i },
  { category: 'tires', words: /шин|резин|колес|колёс|диск/i },
  { category: 'wash', words: /мойк|химчистк/i },
  { category: 'parking', words: /парков|стоянк/i },
  { category: 'maintenance', words: /техобслуж|обслуж|диагностик|плановое то|замена масла|\bто-?\d/i },
  { category: 'repair', words: /ремонт|кузовн|покраск|стекл/i },
  { category: 'parts', words: /запчаст|фильтр|масло|колодк|свеч|антифриз/i },
  { category: 'other', words: /оклейк|плёнк|пленк|антикор|полировк|защит[аы] дн/i },
];

export function guessCategory(description: string): ExpenseCategory | null {
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.words.test(description)) return rule.category;
  }
  return null;
}

/** Разбирает строки выписки: дата — сумма — описание. */
export function parseExpenseRows(text: string): ParsedExpenseRow[] {
  const rows: ParsedExpenseRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 6) continue;

    const date = parseDate(line);
    if (!date) continue;

    const amount = extractMoney(line);
    if (amount === null || amount <= 0) continue;

    const description = line
      .replace(/\d{1,4}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, ' ')
      .replace(/(\d[\d \u00A0]{0,12}(?:[.,]\d{1,2})?)\s*(?:₽|рублей|руб\.?|р\.)(?![а-яa-z])/gi, ' ')
      .replace(/\b\d{3,7}\b/g, ' ')
      .replace(/[|;,]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (description.length < 2) continue;
    rows.push({ date, amount, description: description.slice(0, 160), categoryHint: guessCategory(description), raw: line.slice(0, 200) });
  }
  return rows;
}

/* ────────────────────────── Распределение ────────────────────────── */

export interface VehicleMileage {
  vehicleId: string;
  /** Пройденное расстояние за период импорта, км. */
  distanceKm: number;
  /** Пробег на начало периода (при покупке). */
  startOdometer: number;
  /** Пробег на конец периода (сегодня). */
  endOdometer: number;
  /** Дата покупки: заправку раньше неё этой машине отдавать нельзя. */
  availableFrom?: string | null;
}

/**
 * Раскидывает заправки между машинами пропорционально пройденному расстоянию.
 * Больше ездишь — больше заправок: это единственное разумное правило, когда АЗС не разделяет чеки.
 */
export function splitRowsByMileage<T extends { date?: string }>(
  rows: T[],
  vehicles: VehicleMileage[],
): Array<{ vehicleId: string; rows: T[] }> {
  const usable = vehicles.filter((vehicle) => vehicle.distanceKm > 0);
  const total = usable.reduce((acc, vehicle) => acc + vehicle.distanceKm, 0);
  if (!usable.length || total <= 0) return [];

  const result = usable.map((vehicle) => ({ vehicleId: vehicle.vehicleId, rows: [] as T[] }));
  const shares = usable.map((vehicle) => vehicle.distanceKm / total);
  const taken = usable.map(() => 0);

  // Раздаём строки по одной, каждый раз — машине с наибольшим «недобором» относительно её доли.
  // Так обе машины получают заправки равномерно по всему периоду, а не «одной начало года, другой конец».
  for (let index = 0; index < rows.length; index += 1) {
    const rowDate = rows[index].date ?? '';
    // Машину, которой в тот день ещё не было в семье, пропускаем: заправка до покупки — бессмыслица.
    const available = usable.map((vehicle, position) => ({
      position,
      ok: !vehicle.availableFrom || !rowDate || rowDate >= vehicle.availableFrom,
    }));
    const candidates = available.filter((item) => item.ok).map((item) => item.position);
    const pool = candidates.length ? candidates : usable.map((_, position) => position);

    let best = pool[0];
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (const position of pool) {
      const deficit = (index + 1) * shares[position] - taken[position];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = position;
      }
    }
    result[best].rows.push(rows[index]);
    taken[best] += 1;
  }
  return result;
}

/**
 * Расставляет одометры по датам: линейно между пробегом на начало и на конец периода.
 * Значения расчётные — в интерфейсе они помечаются, чтобы не выглядели как факт с одометра.
 */
export function distributeOdometers<T extends { date: string }>(
  rows: T[],
  start: { date: string; odometer: number },
  end: { date: string; odometer: number },
): Array<T & { odometer: number }> {
  if (!rows.length) return [];
  const totalDays = Math.max(1, daysBetween(start.date, end.date));
  const totalKm = Math.max(0, end.odometer - start.odometer);

  return rows
    .map((row, index) => {
      const elapsed = Math.max(0, Math.min(totalDays, daysBetween(start.date, row.date)));
      const share = row.date >= end.date ? 1 : elapsed / totalDays;
      return { ...row, odometer: round(start.odometer + totalKm * share, 0), __index: index };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.__index - b.__index)
    .map(({ __index, ...rest }) => rest as T & { odometer: number });
}
