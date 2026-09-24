/**
 * Аналитика: сводка, расход, структура расходов, напоминания и авто-досье.
 * Все цифры считаются в общем расчётном ядре (shared/calc.ts) — том же,
 * что использует интерфейс, поэтому расхождений между экранами не бывает.
 */

import { Router } from 'express';
import { EXPENSE_CATEGORY_LABELS, FUEL_TYPE_LABELS, fuelUnit } from '../../../shared/constants.ts';
import { formatDate, monthKey } from '../../../shared/format.ts';
import {
  averageConsumption,
  averageFuelPrice,
  buildReminders,
  categoryBreakdown,
  costPerKm,
  currentOdometer,
  fuelConsumptionFullTank,
  fuelCostPerKm,
  monthlySeries,
  overviewStats,
  periodTotals,
} from '../../../shared/calc.ts';
import type { Database, Expense, FuelEntry, Income, Part, ServiceRule, Trip, Vehicle } from '../../../shared/types.ts';
import type { Store } from '../store.ts';

interface Scoped {
  vehicle: Vehicle | null;
  fuel: FuelEntry[];
  expenses: Expense[];
  incomes: Income[];
  trips: Trip[];
  parts: Part[];
  rules: ServiceRule[];
}

function scope(db: Database, vehicleIdRaw: unknown): Scoped {
  const vehicleId = typeof vehicleIdRaw === 'string' && vehicleIdRaw ? vehicleIdRaw : (db.settings.activeVehicleId ?? db.vehicles[0]?.id ?? '');
  const vehicle = db.vehicles.find((v) => v.id === vehicleId) ?? null;
  return {
    vehicle,
    fuel: db.fuel.filter((f) => f.vehicleId === vehicleId),
    expenses: db.expenses.filter((e) => e.vehicleId === vehicleId),
    incomes: db.incomes.filter((i) => i.vehicleId === vehicleId),
    trips: db.trips.filter((t) => t.vehicleId === vehicleId),
    parts: db.parts.filter((p) => p.vehicleId === vehicleId),
    rules: db.rules.filter((r) => r.vehicleId === vehicleId),
  };
}

export function createStatsRouter(store: Store): Router {
  const router = Router();

  router.get('/stats/overview', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    res.json(overviewStats(s.vehicle, s.fuel, s.expenses, s.incomes));
  });

  router.get('/stats/consumption', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    const segments = fuelConsumptionFullTank(s.fuel);
    const average = averageConsumption(s.fuel);
    const unit = s.vehicle ? fuelUnit(s.vehicle.fuelType) : 'л';
    res.json({
      unit,
      average: average.value,
      method: average.method,
      averagePrice: averageFuelPrice(s.fuel),
      segments,
      points: [...s.fuel]
        .sort((a, b) => a.odometer - b.odometer)
        .map((f) => ({
          date: f.date,
          odometer: f.odometer,
          volume: f.volume,
          totalCost: f.totalCost,
          isFullTank: f.isFullTank,
          station: f.station,
        })),
    });
  });

  router.get('/stats/monthly', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    const months = Math.min(36, Math.max(3, Number(req.query.months ?? 12) || 12));
    res.json(monthlySeries(s.fuel, s.expenses, months));
  });

  router.get('/stats/categories', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const inRange = <T extends { date: string }>(rows: T[]) => rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
    res.json(categoryBreakdown(inRange(s.fuel), inRange(s.expenses)));
  });

  router.get('/reminders', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    if (!s.vehicle) return res.json({ odometer: 0, items: [] });
    const odometer = currentOdometer(s.vehicle, s.fuel, s.expenses);
    const items = buildReminders(s.rules, odometer).map((item) => ({
      ...item,
      rule: s.rules.find((r) => r.id === item.ruleId) ?? null,
    }));
    return res.json({ odometer, items });
  });

  router.get('/stats/trips', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    const average = averageConsumption(s.fuel).value;
    const price = averageFuelPrice(s.fuel);
    res.json({
      averageConsumption: average,
      averagePrice: price,
      trips: [...s.trips]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((t) => {
          const cost = average !== null && price !== null ? Math.round(((t.distance / 100) * average * price) * 100) / 100 : null;
          return { ...t, estimatedCost: cost, estimatedProfit: t.revenue === null ? null : Math.round((t.revenue - (cost ?? 0)) * 100) / 100 };
        }),
    });
  });

  /** Авто-досье — агрегированные данные для отчёта о машине (печать в PDF из интерфейса). */
  router.get('/reports/dossier', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    if (!s.vehicle) return res.status(404).json({ error: 'Автомобиль не выбран.' });

    const vehicle = s.vehicle;
    const odometer = currentOdometer(vehicle, s.fuel, s.expenses);
    const totalDistance = Math.max(0, odometer - (vehicle.initialOdometer || 0));
    const totals = periodTotals(s.fuel, s.expenses, s.incomes);
    const consumption = averageConsumption(s.fuel);
    const now = new Date();
    const ownsSince = vehicle.purchaseDate ?? s.fuel[0]?.date ?? vehicle.createdAt.slice(0, 10);
    const months = Math.max(1, Math.round((Date.now() - Date.parse(`${ownsSince}T00:00:00Z`)) / (30.44 * 86_400_000)));

    res.json({
      generatedAt: now.toISOString(),
      vehicle: {
        ...vehicle,
        fuelTypeLabel: FUEL_TYPE_LABELS[vehicle.fuelType],
        unit: fuelUnit(vehicle.fuelType),
      },
      ownership: {
        since: ownsSince,
        sinceLabel: formatDate(ownsSince),
        months,
        monthsLabel: `${months} мес.`,
        currentOdometer: Math.round(odometer),
        distanceUnderOwnership: Math.round(totalDistance),
        distancePerMonth: Math.round(totalDistance / months),
      },
      economics: {
        totalSpend: totals.totalCost,
        fuelSpend: totals.fuelCost,
        otherSpend: totals.otherCost,
        income: totals.income,
        profit: totals.profit,
        costPerKm: costPerKm(totals.fuelCost, totals.otherCost, totalDistance),
        fuelCostPerKm: fuelCostPerKm(totals.fuelCost, totalDistance),
        costPerMonth: Math.round((totals.totalCost / months) * 100) / 100,
        liters: totals.liters,
        l100km: consumption.value,
        consumptionMethod: consumption.method,
        averagePrice: averageFuelPrice(s.fuel),
      },
      categories: categoryBreakdown(s.fuel, s.expenses),
      monthly: monthlySeries(s.fuel, s.expenses, Math.min(12, months)),
      maintenance: [...s.expenses]
        .filter((e) => e.category === 'maintenance' || e.category === 'repair' || e.category === 'parts' || e.category === 'tires')
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((e) => ({
          date: e.date,
          dateLabel: formatDate(e.date),
          category: EXPENSE_CATEGORY_LABELS[e.category],
          amount: e.amount,
          odometer: e.odometer,
          description: e.description || EXPENSE_CATEGORY_LABELS[e.category],
          vendor: e.vendor,
        })),
      parts: s.parts.map((p) => ({ ...p, installDateLabel: formatDate(p.installDate) })),
      wear: buildReminders(s.rules, odometer).map((w) => ({ ...w })),
      fuelHistory: [...s.fuel]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40)
        .map((f) => ({ ...f, unit: fuelUnit(f.fuelType) })),
      monthKey: monthKey(now.toISOString().slice(0, 10)),
    });
  });

  return router;
}
