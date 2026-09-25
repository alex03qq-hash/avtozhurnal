/**
 * Разбор таблиц: CSV, TSV и листы Excel.
 *
 * Владельцу привычнее вести расходы в таблице, чем вставлять текст. Здесь живёт вся логика
 * «шапка → колонки → записи журнала»: она не зависит от того, откуда пришли данные — из файла
 * Excel, из CSV или из вставленного текста. Наружу ничего не отправляется.
 */

import { guessCategory, parseAmount, parseDate } from './importer.ts';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from './constants.ts';
import type { ExpenseCategory } from './types.ts';

/** Лист таблицы: первая строка — шапка, остальные — данные. */
export interface SheetTable {
  name: string;
  rows: Array<Array<string | number | Date | null>>;
}

export type TableKind = 'fuel' | 'expenses' | 'empty';

export interface TableFuelRow {
  date: string;
  volume: number | null;
  totalCost: number | null;
  station: string;
  odometer: number | null;
  vehicleName: string | null;
  fullTank: boolean;
  raw: string;
}

export interface TableExpenseRow {
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory | null;
  vehicleName: string | null;
  raw: string;
}

export interface TableImportResult {
  kind: TableKind;
  sheetName: string;
  columns: Record<string, number>;
  unknownHeaders: string[];
  /** Колонка «Машина» заполнена хотя бы в одной строке — тогда делить по пробегу не нужно. */
  hasVehicleColumn: boolean;
  fuel: TableFuelRow[];
  expenses: TableExpenseRow[];
  /** Строки, которые не удалось понять: их видно владельцу, а не молча теряются. */
  skipped: Array<{ row: number; raw: string }>;
}

/** Синонимы шапок. Порядок важен: точное совпадение ищется раньше частичного. */
const COLUMN_SYNONYMS: Record<string, string[]> = {
  date: ['дата', 'дата операции', 'дата платежа', 'дата покупки', 'дата заправки', 'date', 'когда', 'время'],
  vehicle: ['машина', 'авто', 'автомобиль', 'vehicle', 'car', 'тс', 'автомобиль, модель'],
  odometer: ['пробег', 'одометр', 'пробег км', 'пробег, км', 'odometer', 'mileage', 'пробег автомобиля'],
  volume: ['объём', 'объем', 'объём л', 'объем л', 'объем, л', 'объём, л', 'литры', 'литраж', 'л', 'volume', 'liters'],
  amount: ['сумма', 'сумма руб', 'сумма, руб', 'сумма ₽', 'стоимость', 'цена', 'итог', 'к оплате', 'amount', 'sum', 'оплата'],
  station: ['азс', 'заправка', 'станция', 'station', 'бренд', 'сеть'],
  fullTank: ['полный бак', 'полный', 'до полного', 'full tank', 'full'],
  category: ['категория', 'категория расхода', 'тип расхода', 'вид расхода', 'тип', 'вид', 'category', 'type'],
  description: ['описание', 'назначение', 'комментарий', 'примечание', 'детали', 'note', 'comment', 'description'],
};

/** Колонки-примечания: их дублирование — норма, а не ошибка шапки (в шаблоне есть «Описание» и «Комментарий»). */
const SECONDARY_COLUMNS = ['комментарий', 'комментарии', 'примечание', 'детали', 'note', 'comment', 'comments', 'remark'];

/** Приводит шапку к сравнимому виду: регистр, лишние знаки, пробелы. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Определяет, какой колонке соответствует шапка. */
export function columnKey(header: unknown): string | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const [key, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
    if (synonyms.includes(normalized)) return key;
  }
  // Частичное совпадение: «сумма операции», «дата и время», «объём, литры».
  const sorted = Object.entries(COLUMN_SYNONYMS).flatMap(([key, synonyms]) => synonyms.map((synonym) => ({ key, synonym })))
    .sort((a, b) => b.synonym.length - a.synonym.length);
  for (const { key, synonym } of sorted) {
    if (synonym.length >= 3 && normalized.includes(synonym)) return key;
  }
  return null;
}

export function mapColumns(headers: unknown[]): { columns: Record<string, number>; unknownHeaders: string[] } {
  const columns: Record<string, number> = {};
  const unknownHeaders: string[] = [];
  headers.forEach((header, index) => {
    const text = String(header ?? '').trim();
    if (!text) return;
    const key = columnKey(header);
    if (key && columns[key] === undefined) {
      columns[key] = index;
      return;
    }
    // Повтор колонки-примечания — не повод предупреждать владельца, остальное — повод
    if (key && SECONDARY_COLUMNS.includes(normalizeHeader(text))) return;
    if (key) unknownHeaders.push(`${text} (повтор колонки «${key}», оставлена первая)`);
    else unknownHeaders.push(text);
  });
  return { columns, unknownHeaders };
}

/** Какой это лист: заправки, расходы или непонятно. */
export function detectKind(columns: Record<string, number>): TableKind {
  // Для расхода обязательна сумма, для заправки — объём или сумма: иначе это не таблица данных,
  // а лист с пояснениями (в шаблоне есть и такие).
  if (columns.volume !== undefined && (columns.amount !== undefined || columns.station !== undefined || columns.odometer !== undefined)) return 'fuel';
  if (columns.volume !== undefined && columns.date !== undefined) return 'fuel';
  if ((columns.category !== undefined || columns.description !== undefined) && columns.amount !== undefined) return 'expenses';
  if (columns.amount !== undefined && (columns.date !== undefined || columns.station !== undefined)) return 'expenses';
  if (columns.station !== undefined && columns.date !== undefined) return 'fuel';
  return 'empty';
}

/** Листы-пояснения из шаблона: там нет данных, и ругаться на них не нужно. */
export function isDocumentationSheet(name: string): boolean {
  const text = normalizeHeader(name);
  return ['как заполнять', 'инструкция', 'справка', 'категории', 'подсказки', 'описание', 'readme', 'help', 'help how to fill'].includes(text);
}

/** Разбирает текст CSV/TSV в таблицу. Понимает кавычки и любые разделители: ; , таб, | */
export function parseDelimited(text: string): SheetTable {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').filter((line) => line.trim() !== '');
  const delimiter = detectDelimiter(lines.slice(0, 10));
  const rows = lines.map((line) => splitLine(line, delimiter).map((cell) => cell.trim()));
  return { name: 'CSV', rows };
}

function detectDelimiter(lines: string[]): string {
  const candidates = [';', '\t', ',', '|'];
  let best = ';';
  let bestScore = 0;
  for (const candidate of candidates) {
    // Разделитель должен встречаться в большинстве строк и примерно одинаково часто
    const counts = lines.map((line) => countOutsideQuotes(line, candidate));
    const nonZero = counts.filter((count) => count > 0);
    if (!nonZero.length) continue;
    const average = nonZero.reduce((acc, count) => acc + count, 0) / nonZero.length;
    const score = (nonZero.length / lines.length) * average;
    if (average >= 1 && score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inside = false;
  let count = 0;
  for (const char of line) {
    if (char === '"') inside = !inside;
    else if (char === delimiter && !inside) count += 1;
  }
  return count;
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inside = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inside && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inside = !inside;
      }
    } else if (char === delimiter && !inside) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function cellText(value: string | number | Date | null): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).replace(/[\u00a0\u202f]/g, ' ').trim();
}

function numberFrom(value: string | number | Date | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const text = cellText(value);
  if (!text) return null;
  return parseAmount(text);
}

/** Название машины из колонки: «haval h7» → совпадает с «Haval H7». */
export function matchVehicleId(name: string | null, vehicles: Array<{ id: string; name: string }>): string | null {
  if (!name) return null;
  const normalized = normalizeHeader(name);
  if (!normalized) return null;
  const exact = vehicles.find((vehicle) => normalizeHeader(vehicle.name) === normalized);
  if (exact) return exact.id;
  // «Haval» или «H7» — тоже понятно, если не совпало сразу
  const partial = vehicles.filter((vehicle) => {
    const vehicleName = normalizeHeader(vehicle.name);
    return vehicleName.includes(normalized) || normalized.includes(vehicleName);
  });
  if (partial.length === 1) return partial[0].id;
  const byWord = vehicles.filter((vehicle) => {
    const words = normalizeHeader(vehicle.name).split(' ');
    return words.length > 1 && words.some((word) => word.length >= 2 && normalized.split(' ').includes(word));
  });
  return byWord.length === 1 ? byWord[0].id : null;
}

/** Категория расхода: понимает и «Шины», и «tires», и «ТО». */
export function matchCategory(value: string | null): ExpenseCategory | null {
  const text = normalizeHeader(value);
  if (!text) return null;
  for (const category of EXPENSE_CATEGORY_ORDER) {
    if (text === category) return category;
    if (text === normalizeHeader(EXPENSE_CATEGORY_LABELS[category])) return category;
  }
  for (const category of EXPENSE_CATEGORY_ORDER) {
    if (normalizeHeader(EXPENSE_CATEGORY_LABELS[category]).includes(text) || text.includes(normalizeHeader(EXPENSE_CATEGORY_LABELS[category]))) {
      return category;
    }
  }
  return guessCategory(text);
}

/** Превращает лист таблицы в записи журнала. */
export function parseSheetTable(table: SheetTable): TableImportResult {
  const rows = table.rows.filter((row) => Array.isArray(row));
  const headerIndex = rows.findIndex((row) => mapColumns(row).unknownHeaders.length < row.filter((cell) => cellText(cell)).length);

  if (headerIndex < 0 || rows.length < 2) {
    return { kind: 'empty', sheetName: table.name, columns: {}, unknownHeaders: [], hasVehicleColumn: false, fuel: [], expenses: [], skipped: [] };
  }

  const { columns, unknownHeaders } = mapColumns(rows[headerIndex]);
  // Меньше двух опознанных колонок — это не данные, а текст. Молча пропускаем.
  const kind = isDocumentationSheet(table.name) || Object.keys(columns).length < 2 ? 'empty' : detectKind(columns);
  const body = rows.slice(headerIndex + 1);

  const value = (row: Array<string | number | Date | null>, key: string): string | number | Date | null => {
    const index = columns[key];
    return index === undefined ? null : row[index] ?? null;
  };

  const fuel: TableFuelRow[] = [];
  const expenses: TableExpenseRow[] = [];
  const skipped: Array<{ row: number; raw: string }> = [];
  let hasVehicleColumn = false;

  body.forEach((row, offset) => {
    const raw = row.map((cell) => cellText(cell)).join(' | ').trim();
    if (!raw.replace(/[| ]/g, '')) return;
    const date = parseDate(cellText(value(row, 'date')));
    const vehicleName = cellText(value(row, 'vehicle')) || null;
    if (vehicleName) hasVehicleColumn = true;

    if (kind === 'fuel') {
      const volume = numberFrom(value(row, 'volume'));
      const totalCost = numberFrom(value(row, 'amount'));
      if (!date || (volume === null && totalCost === null)) {
        skipped.push({ row: headerIndex + offset + 2, raw });
        return;
      }
      const fullTankText = normalizeHeader(cellText(value(row, 'fullTank')));
      fuel.push({
        date,
        volume,
        totalCost,
        station: cellText(value(row, 'station')),
        odometer: numberFrom(value(row, 'odometer')),
        vehicleName,
        fullTank: ['да', 'yes', 'true', '1', 'истина', '+', 'полный'].includes(fullTankText),
        raw,
      });
      return;
    }

    const amount = numberFrom(value(row, 'amount'));
    const description = cellText(value(row, 'description')) || cellText(value(row, 'category')) || cellText(value(row, 'station'));
    if (!date || amount === null) {
      skipped.push({ row: headerIndex + offset + 2, raw });
      return;
    }
    expenses.push({
      date,
      amount,
      description: description || 'Расход',
      category: matchCategory(cellText(value(row, 'category'))) ?? guessCategory(description),
      vehicleName,
      raw,
    });
  });

  return { kind, sheetName: table.name, columns, unknownHeaders, hasVehicleColumn, fuel, expenses, skipped };
}
