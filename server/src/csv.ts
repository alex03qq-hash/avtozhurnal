/**
 * Экспорт в CSV.
 * Файл отдаётся с BOM и разделителем «;» — так его корректно открывает Excel
 * с русской локалью (иначе «кракозябры» и всё в одной колонке).
 */

import { EXPENSE_CATEGORY_LABELS, FUEL_TYPE_LABELS, INCOME_SOURCE_LABELS, fuelUnit } from '../../shared/constants.ts';
import type { Database, Expense, FuelEntry, Income, Vehicle } from '../../shared/types.ts';

const BOM = '\uFEFF';

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(';'), ...rows.map((row) => row.map(escapeCell).join(';'))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function fuelCsv(rows: FuelEntry[], vehicles: Vehicle[]): string {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return toCsv(
    ['Дата', 'Автомобиль', 'Одометр, км', 'Объём', 'Ед.', 'Цена за ед., ₽', 'Сумма, ₽', 'Тип топлива', 'Полный бак', 'АЗС', 'Заметки'],
    rows.map((f) => [
      f.date,
      byId.get(f.vehicleId)?.name ?? '',
      Math.round(f.odometer),
      f.volume,
      fuelUnit(f.fuelType),
      f.pricePerUnit,
      f.totalCost,
      FUEL_TYPE_LABELS[f.fuelType],
      f.isFullTank ? 'да' : 'нет',
      f.station,
      f.notes,
    ]),
  );
}

export function expensesCsv(rows: Expense[], vehicles: Vehicle[]): string {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return toCsv(
    ['Дата', 'Автомобиль', 'Категория', 'Сумма, ₽', 'Одометр, км', 'Исполнитель', 'Описание', 'Заметки'],
    rows.map((e) => [
      e.date,
      byId.get(e.vehicleId)?.name ?? '',
      EXPENSE_CATEGORY_LABELS[e.category],
      e.amount,
      e.odometer === null ? '' : Math.round(e.odometer),
      e.vendor,
      e.description,
      e.notes,
    ]),
  );
}

export function incomesCsv(rows: Income[], vehicles: Vehicle[]): string {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return toCsv(
    ['Дата', 'Автомобиль', 'Источник', 'Сумма, ₽', 'Одометр, км', 'Описание'],
    rows.map((i) => [i.date, byId.get(i.vehicleId)?.name ?? '', INCOME_SOURCE_LABELS[i.source], i.amount, i.odometer ?? '', i.description]),
  );
}

export function vehicleIds(db: Database, vehicleId?: string): string[] {
  if (vehicleId) return [vehicleId];
  return db.vehicles.map((v) => v.id);
}
