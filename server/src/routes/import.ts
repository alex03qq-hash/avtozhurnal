/**
 * Импорт истории: заправки из выгрузки АЗС и расходы из банковской выписки.
 *
 * Данные приходят либо текстом, который владелец вставил сам, либо файлом (Excel, CSV, TSV).
 * В обоих случаях разбор идёт на этом компьютере, наружу ничего не уходит.
 *
 * Что приходится восстанавливать: в выгрузке АЗС нет ни машины, ни одометра. Заправки можно
 * раскидать между машинами пропорционально пробегу, а одометры поставить по датам — такие
 * значения помечаются в заметке, чтобы их нельзя было принять за показания с одометра.
 */

import { Router } from 'express';
import { currentOdometer, round } from '../../../shared/calc.ts';
import { distributeOdometers, parseExpenseRows, parseFuelRows, splitRowsByMileage } from '../../../shared/importer.ts';
import { isDocumentationSheet, matchVehicleId, parseDelimited, parseSheetTable, type SheetTable } from '../../../shared/tables.ts';
import { buildTemplate, readWorkbook } from '../xlsx.ts';
import { ValidationError } from '../validate.ts';
import { ah } from './async-handler.ts';
import type { Store } from '../store.ts';
import type { Database, Expense, ExpenseCategory, FuelEntry, Vehicle } from '../../../shared/types.ts';

interface FuelTarget {
  vehicleId: string;
  /** Пробег на сегодня — по нему расставляются одометры импортируемых заправок. */
  currentOdometer: number;
}

interface FuelRowLike {
  date: string;
  volume: number | null;
  totalCost: number | null;
  station: string;
  odometer: number | null;
  fullTank?: boolean;
}

interface ExpenseRowLike {
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory | null;
}

const FUEL_NOTE_TEXT = 'Импорт из выписки АЗС.';
const FUEL_NOTE_ESTIMATED = 'Импорт из выписки АЗС: пробег рассчитан по датам (одометра в выписке нет).';
const FUEL_NOTE_PARTIAL = 'Импорт: пробег части строк указан в файле, остальные рассчитаны по датам.';
const EXPENSE_NOTE = 'Импорт из выписки (банк). Категория определена по описанию — поправьте при необходимости.';

/**
 * Добавляет заправки одной машины.
 *
 * Одометр берём из файла там, где он указан, и достраиваем по датам между известными замерами —
 * так честнее, чем выбрасывать указанные владельцем значения. Расчётный пробег помечается в заметке.
 */
function insertFuelEntries(
  db: Database,
  vehicle: Vehicle,
  rows: FuelRowLike[],
  options: { markFullTank: boolean; currentOdometer: number },
): { added: number; estimated: boolean } {
  if (!rows.length) return { added: 0, estimated: false };

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const known = sorted.filter((row) => row.odometer !== null && Number.isFinite(row.odometer));
  const unknown = sorted.filter((row) => row.odometer === null || !Number.isFinite(row.odometer));
  const allHaveOdometer = unknown.length === 0;

  const filled = allHaveOdometer
    ? known.map((row) => ({ ...row, odometer: Math.round(row.odometer as number) }))
    : [
        ...known.map((row) => ({ ...row, odometer: Math.round(row.odometer as number) })),
        ...distributeOdometers(
          unknown,
          { date: vehicle.purchaseDate ?? sorted[0].date, odometer: vehicle.initialOdometer },
          {
            date: new Date().toISOString().slice(0, 10),
            odometer: Math.max(options.currentOdometer, vehicle.initialOdometer + 1),
          },
          known.map((row) => ({ date: row.date, odometer: Math.round(row.odometer as number) })),
        ),
      ].sort((a, b) => a.date.localeCompare(b.date));

  const note = allHaveOdometer ? FUEL_NOTE_TEXT : known.length ? FUEL_NOTE_PARTIAL : FUEL_NOTE_ESTIMATED;

  // Дубли не создаём по двум признакам сразу: (дата + пробег) и (дата + объём + сумма + АЗС).
  // Второй признак спасает, когда пробег расчётный и при повторном импорте выходит другим числом.
  const byOdometer = new Set(db.fuel.filter((row) => row.vehicleId === vehicle.id).map((row) => `${row.date}|${Math.round(row.odometer)}`));
  const byContent = new Set(
    db.fuel
      .filter((row) => row.vehicleId === vehicle.id)
      .map((row) => `${row.date}|${round(row.volume, 2)}|${round(row.totalCost, 2)}|${row.station}`),
  );

  let added = 0;
  for (const row of filled) {
    const odometerKey = `${row.date}|${Math.round(row.odometer)}`;
    const contentKey = `${row.date}|${round(row.volume ?? 0, 2)}|${round(row.totalCost ?? 0, 2)}|${row.station}`;
    if (byOdometer.has(odometerKey) || byContent.has(contentKey)) continue;
    byOdometer.add(odometerKey);
    byContent.add(contentKey);

    const volume = row.volume ?? 0;
    const totalCost = row.totalCost ?? 0;
    const now = new Date().toISOString();
    const entry: FuelEntry = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      vehicleId: vehicle.id,
      date: row.date,
      odometer: Math.round(row.odometer),
      volume,
      pricePerUnit: volume > 0 && totalCost > 0 ? round(totalCost / volume, 2) : 0,
      totalCost,
      fuelType: vehicle.fuelType,
      isFullTank: options.markFullTank || row.fullTank === true,
      station: row.station,
      photoId: null,
      notes: note,
    };
    db.fuel.push(entry);
    added += 1;
  }
  return { added, estimated: !allHaveOdometer };
}

/** Добавляет расходы одной машины: категория из описания, иначе — выбранная по умолчанию. */
function insertExpenseEntries(
  db: Database,
  vehicleId: string,
  rows: ExpenseRowLike[],
  fallback: ExpenseCategory,
): number {
  const existing = new Set(db.expenses.filter((row) => row.vehicleId === vehicleId).map((row) => `${row.date}|${row.amount}|${row.description}`));
  let added = 0;

  for (const row of rows) {
    const description = row.description.slice(0, 160);
    const key = `${row.date}|${row.amount}|${description}`;
    if (existing.has(key)) continue;
    existing.add(key);

    const now = new Date().toISOString();
    const expense: Expense = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      vehicleId,
      date: row.date,
      category: row.category ?? fallback,
      amount: row.amount,
      odometer: null,
      vendor: '',
      description,
      photoId: null,
      notes: EXPENSE_NOTE,
    };
    db.expenses.push(expense);
    added += 1;
  }
  return added;
}

/** Читает файл: CSV/TSV как текст, всё остальное — как книгу Excel. */
function readSheets(filename: string, base64: string): SheetTable[] {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new ValidationError('Файл пустой.');
  if (buffer.length > 12 * 1024 * 1024) throw new ValidationError('Файл больше 12 МБ — разделите выгрузку на части.');
  if (/\.(csv|txt|tsv)$/i.test(filename)) {
    const text = buffer.toString('utf8');
    return [parseDelimited(text)];
  }
  try {
    return readWorkbook(buffer);
  } catch {
    throw new ValidationError('Не удалось прочитать файл. Поддерживаются .xlsx, .xls, .csv, .tsv и .txt.');
  }
}

interface SheetsParseResult {
  sheets: Array<{ sheet: string; kind: string; fuel: number; expenses: number; skipped: number }>;
  fuel: ReturnType<typeof parseSheetTable>['fuel'];
  expenses: ReturnType<typeof parseSheetTable>['expenses'];
  skipped: Array<{ sheet: string; row: number; raw: string }>;
  warnings: string[];
}

/** Разбирает книгу целиком: все листы, все строки, без потери непонятого. */
function parseSheets(sheets: SheetTable[], vehicles: Array<{ id: string; name: string }>): SheetsParseResult {
  const fuel: SheetsParseResult['fuel'] = [];
  const expenses: SheetsParseResult['expenses'] = [];
  const skipped: SheetsParseResult['skipped'] = [];
  const warnings: string[] = [];
  const summary: SheetsParseResult['sheets'] = [];

  for (const sheet of sheets) {
    if (isDocumentationSheet(sheet.name)) continue;
    const parsed = parseSheetTable(sheet);
    summary.push({ sheet: sheet.name, kind: parsed.kind, fuel: parsed.fuel.length, expenses: parsed.expenses.length, skipped: parsed.skipped.length });
    if (parsed.kind === 'empty') {
      warnings.push(`Лист «${sheet.name}» пропущен: не нашлось ни колонки с датой, ни суммы.`);
      continue;
    }
    if (parsed.unknownHeaders.length) warnings.push(`Лист «${sheet.name}»: не понял колонки — ${parsed.unknownHeaders.join(', ')}.`);
    for (const row of parsed.skipped) skipped.push({ sheet: sheet.name, row: row.row, raw: row.raw });
    fuel.push(...parsed.fuel);
    expenses.push(...parsed.expenses);
  }

  // Машина, название которой не совпало ни с одной в журнале, — важное предупреждение, а не тишина
  const unknown = new Set<string>();
  for (const row of [...fuel, ...expenses]) {
    if (row.vehicleName && !matchVehicleId(row.vehicleName, vehicles)) unknown.add(row.vehicleName);
  }
  if (unknown.size) warnings.push(`Не нашёл в журнале машины: ${[...unknown].join(', ')}. Такие строки распределены по общему правилу.`);

  return { sheets: summary, fuel, expenses, skipped, warnings };
}

export function createImportRouter(store: Store): Router {
  const router = Router();

  /** Предпросмотр: что будет импортировано, до записи в базу. */
  router.post('/import/preview', ah(async (req, res) => {
    const body = (req.body ?? {}) as { fuelText?: string; expensesText?: string };
    const fuel = parseFuelRows(String(body.fuelText ?? ''));
    const expenses = parseExpenseRows(String(body.expensesText ?? ''));
    res.json({
      fuel: { count: fuel.length, sample: fuel.slice(0, 5), totalLiters: round(fuel.reduce((acc, row) => acc + (row.volume ?? 0), 0), 2), totalCost: round(fuel.reduce((acc, row) => acc + (row.totalCost ?? 0), 0), 2) },
      expenses: { count: expenses.length, sample: expenses.slice(0, 5), totalCost: round(expenses.reduce((acc, row) => acc + row.amount, 0), 2) },
    });
  }));

  /**
   * Импорт заправок из вставленного текста.
   * variant = 'single' — всё на одну машину; 'mileage' — раскидать пропорционально пробегу.
   */
  router.post('/import/fuel', ah(async (req, res) => {
    const body = (req.body ?? {}) as {
      text?: string;
      variant?: 'single' | 'mileage';
      targets?: FuelTarget[];
      markFullTank?: boolean;
    };

    const rows = parseFuelRows(String(body.text ?? ''));
    if (!rows.length) throw new ValidationError('В списке не нашлось ни одной заправки: нужны строки с датой и объёмом или суммой.');

    const db = store.get();
    const targets = (body.targets ?? []).filter((target) => db.vehicles.some((v) => v.id === target.vehicleId));
    if (!targets.length) throw new ValidationError('Не выбрана ни одна машина для импорта.');

    const variant = body.variant === 'mileage' && targets.length > 1 ? 'mileage' : 'single';
    const markFullTank = body.markFullTank === true;

    const groups: Array<{ vehicleId: string; rows: FuelRowLike[] }> =
      variant === 'mileage'
        ? splitRowsByMileage(
            rows,
            targets.map((target) => {
              const vehicle = db.vehicles.find((v) => v.id === target.vehicleId)!;
              return {
                vehicleId: target.vehicleId,
                distanceKm: Math.max(0, target.currentOdometer - vehicle.initialOdometer),
                startOdometer: vehicle.initialOdometer,
                endOdometer: target.currentOdometer,
                // Ранее покупки эта машина заправок иметь не могла
                availableFrom: vehicle.purchaseDate ?? null,
              };
            }),
          )
        : [{ vehicleId: targets[0].vehicleId, rows }];

    const created: Array<{ vehicleId: string; count: number; estimatedOdometer: boolean }> = [];

    await store.mutate((state) => {
      for (const group of groups) {
        const target = targets.find((t) => t.vehicleId === group.vehicleId)!;
        const vehicle = state.vehicles.find((v) => v.id === group.vehicleId)!;
        const result = insertFuelEntries(state, vehicle, group.rows, { markFullTank, currentOdometer: target.currentOdometer });
        created.push({ vehicleId: group.vehicleId, count: result.added, estimatedOdometer: result.estimated });
      }
    });

    const total = created.reduce((acc, item) => acc + item.count, 0);
    res.status(201).json({
      ok: true,
      variant,
      created,
      total,
      message:
        total === 0
          ? 'Новых заправок не добавлено: такие записи уже есть в журнале.'
          : `Импортировано заправок: ${total}.${variant === 'mileage' ? ' Распределены между машинами по пробегу.' : ''}${created.some((c) => c.estimatedOdometer) ? ' Пробег расставлен по датам — в заметках это отмечено.' : ''}`,
    });
  }));

  /** Импорт расходов из вставленного текста. */
  router.post('/import/expenses', ah(async (req, res) => {
    const body = (req.body ?? {}) as { text?: string; vehicleId?: string; defaultCategory?: ExpenseCategory };
    const rows = parseExpenseRows(String(body.text ?? ''));
    if (!rows.length) throw new ValidationError('В списке не нашлось расходов: нужны строки с датой и суммой.');

    const db = store.get();
    const vehicleId = body.vehicleId ?? db.settings.activeVehicleId ?? '';
    if (!db.vehicles.some((v) => v.id === vehicleId)) throw new ValidationError('Не выбрана машина для импорта расходов.');

    const fallback = (body.defaultCategory ?? 'other') as ExpenseCategory;
    let added = 0;
    await store.mutate((state) => {
      added = insertExpenseEntries(
        state,
        vehicleId,
        rows.map((row) => ({ date: row.date, amount: row.amount, description: row.description, category: row.categoryHint })),
        fallback,
      );
    });

    res.status(201).json({
      ok: true,
      created: added,
      message: added === 0 ? 'Новых расходов не добавлено: такие записи уже есть.' : `Импортировано расходов: ${added}. Категории расставлены по описанию.`,
    });
  }));

  /** Предпросмотр файла: что в нём найдено и что осталось непонятным. */
  router.post('/import/file-preview', ah(async (req, res) => {
    const body = (req.body ?? {}) as { filename?: string; content?: string };
    const filename = String(body.filename ?? 'файл');
    if (!body.content) throw new ValidationError('Файл не получен: выберите файл ещё раз.');

    const db = store.get();
    const sheets = readSheets(filename, String(body.content));
    const parsed = parseSheets(sheets, db.vehicles);

    res.json({
      filename,
      sheets: parsed.sheets,
      hasVehicleColumn: parsed.fuel.some((row) => row.vehicleName) || parsed.expenses.some((row) => row.vehicleName),
      fuel: {
        count: parsed.fuel.length,
        totalLiters: round(parsed.fuel.reduce((acc, row) => acc + (row.volume ?? 0), 0), 2),
        totalCost: round(parsed.fuel.reduce((acc, row) => acc + (row.totalCost ?? 0), 0), 2),
        withOdometer: parsed.fuel.filter((row) => row.odometer !== null).length,
        sample: parsed.fuel.slice(0, 8).map((row) => ({ date: row.date, volume: row.volume, totalCost: row.totalCost, station: row.station, odometer: row.odometer, vehicleName: row.vehicleName })),
      },
      expenses: {
        count: parsed.expenses.length,
        totalCost: round(parsed.expenses.reduce((acc, row) => acc + row.amount, 0), 2),
        byCategory: parsed.expenses.reduce<Record<string, number>>((acc, row) => {
          const key = row.category ?? 'other';
          acc[key] = round((acc[key] ?? 0) + row.amount, 2);
          return acc;
        }, {}),
        sample: parsed.expenses.slice(0, 8).map((row) => ({ date: row.date, amount: row.amount, description: row.description, category: row.category, vehicleName: row.vehicleName })),
      },
      skipped: parsed.skipped.slice(0, 20),
      skippedTotal: parsed.skipped.length,
      warnings: parsed.warnings,
    });
  }));

  /**
   * Импорт из файла Excel/CSV.
   *
   * Если в файле есть колонка «Машина» — строки идут строго по ней. Строки без машины делятся
   * между машинами по пробегу (как и при импорте из текста выгрузки АЗС).
   */
  router.post('/import/file', ah(async (req, res) => {
    const body = (req.body ?? {}) as {
      filename?: string;
      content?: string;
      targets?: FuelTarget[];
      markFullTank?: boolean;
      vehicleId?: string;
      defaultCategory?: ExpenseCategory;
    };
    if (!body.content) throw new ValidationError('Файл не получен: выберите файл ещё раз.');

    const db = store.get();
    const sheets = readSheets(String(body.filename ?? 'файл'), String(body.content));
    const parsed = parseSheets(sheets, db.vehicles);
    if (!parsed.fuel.length && !parsed.expenses.length) {
      throw new ValidationError('В файле не нашлось ни заправок, ни расходов. Проверьте шапку таблицы — в шаблоне она уже готова.');
    }

    const fallbackVehicleId = body.vehicleId ?? db.settings.activeVehicleId ?? db.vehicles[0]?.id ?? '';
    if (!db.vehicles.some((v) => v.id === fallbackVehicleId)) throw new ValidationError('В журнале нет ни одной машины.');

    const targets = (body.targets ?? []).filter((target) => db.vehicles.some((v) => v.id === target.vehicleId));
    const odometerOf = (vehicleId: string): number => {
      const target = targets.find((t) => t.vehicleId === vehicleId);
      if (target) return target.currentOdometer;
      const vehicle = db.vehicles.find((v) => v.id === vehicleId);
      return vehicle ? Math.round(currentOdometer(vehicle, db.fuel, db.expenses)) : 0;
    };

    // Заправки: сгруппировать по машине из колонки, остальное — по общему правилу
    const namedFuel = new Map<string, FuelRowLike[]>();
    const freeFuel: FuelRowLike[] = [];
    for (const row of parsed.fuel) {
      const vehicleId = matchVehicleId(row.vehicleName, db.vehicles);
      if (vehicleId) {
        namedFuel.set(vehicleId, [...(namedFuel.get(vehicleId) ?? []), { ...row }]);
      } else {
        freeFuel.push({ ...row });
      }
    }

    if (freeFuel.length && targets.length > 1) {
      const split = splitRowsByMileage(
        freeFuel,
        targets.map((target) => {
          const vehicle = db.vehicles.find((v) => v.id === target.vehicleId)!;
          return {
            vehicleId: target.vehicleId,
            distanceKm: Math.max(0, target.currentOdometer - vehicle.initialOdometer),
            startOdometer: vehicle.initialOdometer,
            endOdometer: target.currentOdometer,
            availableFrom: vehicle.purchaseDate ?? null,
          };
        }),
      );
      for (const group of split) namedFuel.set(group.vehicleId, [...(namedFuel.get(group.vehicleId) ?? []), ...group.rows]);
    } else if (freeFuel.length) {
      namedFuel.set(fallbackVehicleId, [...(namedFuel.get(fallbackVehicleId) ?? []), ...freeFuel]);
    }

    const namedExpenses = new Map<string, ExpenseRowLike[]>();
    for (const row of parsed.expenses) {
      const vehicleId = matchVehicleId(row.vehicleName, db.vehicles) ?? fallbackVehicleId;
      namedExpenses.set(vehicleId, [...(namedExpenses.get(vehicleId) ?? []), { ...row }]);
    }

    const markFullTank = body.markFullTank === true;
    const fallbackCategory = (body.defaultCategory ?? 'other') as ExpenseCategory;
    const fuelCreated: Array<{ vehicleId: string; count: number; estimatedOdometer: boolean }> = [];
    const expenseCreated: Array<{ vehicleId: string; count: number }> = [];

    await store.mutate((state) => {
      for (const [vehicleId, rows] of namedFuel) {
        const vehicle = state.vehicles.find((v) => v.id === vehicleId);
        if (!vehicle) continue;
        const result = insertFuelEntries(state, vehicle, rows, { markFullTank, currentOdometer: odometerOf(vehicleId) });
        if (result.added || result.estimated) fuelCreated.push({ vehicleId, count: result.added, estimatedOdometer: result.estimated });
      }
      for (const [vehicleId, rows] of namedExpenses) {
        const count = insertExpenseEntries(state, vehicleId, rows, fallbackCategory);
        expenseCreated.push({ vehicleId, count });
      }
    });

    const fuelTotal = fuelCreated.reduce((acc, item) => acc + item.count, 0);
    const expenseTotal = expenseCreated.reduce((acc, item) => acc + item.count, 0);
    const parts: string[] = [];
    if (fuelTotal) parts.push(`заправок: ${fuelTotal}`);
    if (expenseTotal) parts.push(`расходов: ${expenseTotal}`);

    res.status(201).json({
      ok: true,
      fuelCreated,
      expenseCreated,
      fuelTotal,
      expenseTotal,
      skipped: parsed.skipped.slice(0, 20),
      skippedTotal: parsed.skipped.length,
      warnings: parsed.warnings,
      message:
        parts.length === 0
          ? 'Новых записей не добавлено: всё из этого файла уже есть в журнале.'
          : `Импортировано из файла — ${parts.join(', ')}.${fuelCreated.some((c) => c.estimatedOdometer) ? ' Пробег расставлен по датам — в заметках это отмечено.' : ''}`,
    });
  }));

  /** Шаблон для заполнения в Excel: листы «Заправки» и «Расходы». */
  router.get('/import/template.xlsx', ah(async (req, res) => {
    const db = store.get();
    const buffer = buildTemplate({
      vehicles: db.vehicles.filter((vehicle) => !vehicle.isArchived).map((vehicle) => vehicle.name),
      examples: req.query.empty !== '1',
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="avtozhurnal-shablon-importa.xlsx"');
    res.send(buffer);
  }));

  /** Сколько сейчас на одометре каждой машины — подсказка для импорта. */
  router.get('/import/hint', (_req, res) => {
    const db = store.get();
    res.json(
      db.vehicles.map((vehicle) => ({
        vehicleId: vehicle.id,
        name: vehicle.name,
        initialOdometer: vehicle.initialOdometer,
        purchaseDate: vehicle.purchaseDate,
        currentOdometer: Math.round(currentOdometer(vehicle, db.fuel, db.expenses)),
        fuelEntries: db.fuel.filter((row) => row.vehicleId === vehicle.id).length,
      })),
    );
  });

  return router;
}
