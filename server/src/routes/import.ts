/**
 * Импорт истории: заправки из выгрузки АЗС и расходы из банковской выписки.
 *
 * Работает только с текстом, который пользователь вставил сам. Заправки можно раскидать между
 * машинами пропорционально пробегу, а одометры — расставить по датам: в выгрузке АЗС их нет.
 * Такие значения помечаются в заметке, чтобы их нельзя было принять за показания с одометра.
 */

import { Router } from 'express';
import { currentOdometer, round } from '../../../shared/calc.ts';
import { distributeOdometers, parseExpenseRows, parseFuelRows, splitRowsByMileage } from '../../../shared/importer.ts';
import { ValidationError } from '../validate.ts';
import { ah } from './async-handler.ts';
import type { Store } from '../store.ts';
import type { Expense, ExpenseCategory, FuelEntry } from '../../../shared/types.ts';

interface FuelTarget {
  vehicleId: string;
  /** Пробег на сегодня — по нему расставляются одометры импортируемых заправок. */
  currentOdometer: number;
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
   * Импорт заправок.
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

    // Разбиение между машинами по пройденному расстоянию
    const groups: Array<{ vehicleId: string; rows: ReturnType<typeof parseFuelRows> }> =
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
        const rowsForVehicle = group.rows;
        if (!rowsForVehicle.length) continue;

        // Если в строках есть одометры — уважаем их; иначе расставляем по датам между покупкой и сегодня.
        const allHaveOdometer = rowsForVehicle.every((row) => row.odometer !== null);
        const withOdometer = allHaveOdometer
          ? rowsForVehicle.map((row) => ({ ...row, odometer: row.odometer as number })).sort((a, b) => a.date.localeCompare(b.date))
          : distributeOdometers(
              rowsForVehicle,
              { date: vehicle.purchaseDate ?? rowsForVehicle[0].date, odometer: vehicle.initialOdometer },
              { date: new Date().toISOString().slice(0, 10), odometer: Math.max(target.currentOdometer, vehicle.initialOdometer + 1) },
            );

        // Дубли по дате и одометру не создаём: повторный импорт того же файла безопасен
        const existing = new Set(
          state.fuel.filter((row) => row.vehicleId === vehicle.id).map((row) => `${row.date}|${Math.round(row.odometer)}`),
        );

        let added = 0;
        for (const row of withOdometer) {
          const key = `${row.date}|${Math.round(row.odometer)}`;
          if (existing.has(key)) continue;
          existing.add(key);

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
            isFullTank: markFullTank,
            station: row.station,
            photoId: null,
            notes: allHaveOdometer
              ? 'Импорт из выписки АЗС.'
              : 'Импорт из выписки АЗС: пробег рассчитан по датам (одометра в выписке нет).',
          };
          state.fuel.push(entry);
          added += 1;
        }

        created.push({ vehicleId: group.vehicleId, count: added, estimatedOdometer: !allHaveOdometer });
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

  /** Импорт расходов: категория берётся из слов в описании, иначе — выбранная по умолчанию. */
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
      const existing = new Set(
        state.expenses.filter((row) => row.vehicleId === vehicleId).map((row) => `${row.date}|${row.amount}|${row.description}`),
      );

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
          category: row.categoryHint ?? fallback,
          amount: row.amount,
          odometer: null,
          vendor: '',
          description,
          photoId: null,
          notes: 'Импорт из выписки (банк). Категория определена по описанию — поправьте при необходимости.',
        };
        state.expenses.push(expense);
        added += 1;
      }
    });

    res.status(201).json({
      ok: true,
      created: added,
      message: added === 0 ? 'Новых расходов не добавлено: такие записи уже есть.' : `Импортировано расходов: ${added}. Категории расставлены по описанию.`,
    });
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
