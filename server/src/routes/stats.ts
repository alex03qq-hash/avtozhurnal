/**
 * Аналитика: сводка, расход, структура расходов, напоминания и авто-досье.
 * Все цифры считаются в общем расчётном ядре (shared/calc.ts) — том же,
 * что использует интерфейс, поэтому расхождений между экранами не бывает.
 */

import { Router } from 'express';
import { EXPENSE_CATEGORY_LABELS, FUEL_TYPE_LABELS, fuelUnit } from '../../../shared/constants.ts';
import { addDays, daysBetween, formatDate, monthKey, todayISO } from '../../../shared/format.ts';
import { buildCalendar, type CalendarEvent } from '../../../shared/calendar.ts';
import { drivingStyle, ownershipInsight, wearForecast } from '../../../shared/insights.ts';
import {
  averageConsumption,
  averageFuelPrice,
  sum,
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
import { ValidationError } from '../validate.ts';
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

/**
 * Средний дневной пробег: нужен, чтобы перевести «осталось 900 км» в конкретную дату
 * и поставить напоминание в календарь телефона.
 */
function averageDailyDistance(fuel: FuelEntry[], currentOdometerValue: number): number {
  const rows = [...fuel].sort((a, b) => a.odometer - b.odometer);
  if (rows.length >= 2) {
    const days = Math.max(1, daysBetween(rows[0].date, rows[rows.length - 1].date));
    const distance = currentOdometerValue - rows[0].odometer;
    const perDay = distance / days;
    // Отсекаем явно неправдоподобные значения — иначе дата напоминания уедет на годы.
    if (perDay > 1 && perDay < 1000) return Math.round(perDay * 10) / 10;
  }
  return 40;
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

  /**
   * Цены по каждой АЗС: нужны, чтобы подсказывать цену при вводе заправки.
   * На разных заправках цена разная, поэтому история ведётся отдельно по названию.
   */
  router.get('/stats/stations', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    const byStation = new Map<string, FuelEntry[]>();
    for (const row of s.fuel) {
      const name = row.station.trim();
      if (!name) continue;
      const list = byStation.get(name) ?? [];
      list.push(row);
      byStation.set(name, list);
    }

    const stations = [...byStation.entries()]
      .map(([station, rows]) => {
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1];
        const liters = sum(rows.map((row) => row.volume));
        const money = sum(rows.map((row) => row.totalCost));
        return {
          station,
          count: rows.length,
          lastPrice: last.pricePerUnit,
          lastDate: last.date,
          averagePrice: liters > 0 ? Math.round((money / liters) * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.count - a.count || a.station.localeCompare(b.station, 'ru'));

    res.json(stations.slice(0, 25));
  });

  /**
   * Выводы: стиль вождения, прогноз износа с датами и стоимость владения.
   * Всё считается по данным пользователя и помечено как оценка.
   */
  router.get('/stats/insights', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    if (!s.vehicle) return res.status(404).json({ error: 'Автомобиль не выбран.' });

    const today = todayISO();
    const odometer = currentOdometer(s.vehicle, s.fuel, s.expenses);
    const consumption = averageConsumption(s.fuel);

    // Темп пробега: сколько километров в месяц проезжает машина.
    const dates = s.fuel.map((row) => row.date).sort();
    const months = dates.length ? Math.max(1, daysBetween(dates[0], today) / 30.44) : 1;
    const firstOdometer = Math.min(s.vehicle.initialOdometer, ...s.fuel.map((row) => row.odometer));
    const kmPerMonth = Math.max(0, Math.round(((odometer - firstOdometer) / months) * 10) / 10);

    const style = drivingStyle(s.fuel, s.vehicle, consumption.value, kmPerMonth);
    const reminders = buildReminders(s.rules, odometer);
    const forecast = wearForecast(reminders, style, kmPerMonth, today);

    // Стоимость километра три месяца назад — чтобы увидеть, дорожает ли владение.
    const before = addDays(today, -90);
    const fuelBefore = s.fuel.filter((row) => row.date <= before).sort((a, b) => a.odometer - b.odometer);
    const totalsBefore = periodTotals(fuelBefore, s.expenses.filter((row) => row.date <= before), [], undefined, before);
    const distanceBefore = fuelBefore.length >= 2 ? fuelBefore[fuelBefore.length - 1].odometer - fuelBefore[0].odometer : 0;
    const costPerKmBefore = distanceBefore > 0 ? costPerKm(totalsBefore.fuelCost, totalsBefore.otherCost, distanceBefore) : null;

    const allTotals = periodTotals(s.fuel, s.expenses, []);
    const totalDistance = Math.max(0, odometer - s.vehicle.initialOdometer);
    const ownership = ownershipInsight(
      monthlySeries(s.fuel, s.expenses, 6),
      { costPerKm: costPerKm(allTotals.fuelCost, allTotals.otherCost, totalDistance), distanceKm: totalDistance },
      { costPerKmBefore },
    );

    res.json({
      kmPerMonth,
      currentOdometer: Math.round(odometer),
      style,
      forecast: forecast.map((item) => ({ ...item, status: item.status })),
      ownership: { ...ownership, monthly: monthlySeries(s.fuel, s.expenses, 6) },
    });
  });

  /**
   * Файл календаря с ближайшими сроками ТО.
   * Добавив его в календарь телефона один раз, владелец получает обычные системные напоминания.
   */
  router.get('/reminders/calendar.ics', (req, res) => {
    const s = scope(store.get(), req.query.vehicleId);
    if (!s.vehicle) throw new ValidationError('Автомобиль не выбран.');

    const odometer = currentOdometer(s.vehicle, s.fuel, s.expenses);
    const items = buildReminders(s.rules, odometer);
    const perDay = averageDailyDistance(s.fuel, odometer);
    const today = todayISO();
    const vehicleName = s.vehicle.name;

    const events: CalendarEvent[] = [];
    for (const item of items) {
      const rule = s.rules.find((r) => r.id === item.ruleId);
      if (!rule) continue;

      // Дата: точная дата регламента, иначе — прогноз по среднему пробегу.
      let date = item.nextServiceDate ?? null;
      if (!date && item.remainingKm !== null) date = addDays(today, Math.max(0, Math.round(item.remainingKm / perDay)));
      if (!date) continue;
      // Просроченное ставим на сегодня, чтобы календарь напомнил сразу.
      if (date < today) date = today;

      const details: string[] = [];
      if (item.remainingKm !== null) {
        details.push(item.remainingKm >= 0 ? `Осталось ${Math.round(item.remainingKm)} км` : `Просрочено на ${Math.round(Math.abs(item.remainingKm))} км`);
      }
      if (item.remainingDays !== null) {
        details.push(item.remainingDays >= 0 ? `по дате: через ${item.remainingDays} дн.` : `по дате: ${Math.abs(item.remainingDays)} дн. назад`);
      }
      if (item.percentUsed !== null) details.push(`износ ${item.percentUsed.toFixed(0)} %`);
      details.push(`текущий пробег ${Math.round(odometer)} км`);

      events.push({
        uid: `${rule.id}@avtozhurnal`,
        date,
        summary: `АвтоЖурнал · ${rule.name} (${vehicleName})`,
        description: details.join(' · '),
        remindDaysBefore: Math.max(1, rule.warnDaysBefore || 3),
      });
    }

    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    const body = buildCalendar(events, { name: `АвтоЖурнал — ${vehicleName}`, stamp });

    res.type('text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="avtozhurnal-napominaniya.ics"');
    res.send(body);
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
