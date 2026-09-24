import { describe, expect, it } from 'vitest';
import {
  averageConsumption,
  averageFuelPrice,
  buildReminders,
  categoryBreakdown,
  costPerKm,
  currentOdometer,
  fuelConsumptionFullTank,
  fuelCostPerKm,
  gallonsToLiters,
  kmToMiles,
  kwhPer100km,
  l100kmToMpg,
  litersToGallons,
  milesToKm,
  monthlySeries,
  overviewStats,
  periodTotals,
  priceFromTotal,
  simplifiedConsumption,
  tripCost,
  tripProfit,
  volumeFromTotal,
  wearStatus,
} from '../calc';
import type { Expense, FuelEntry, Income, ServiceRule, Vehicle } from '../types';

const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

const vehicle: Vehicle = {
  ...base,
  id: 'v1',
  name: 'Тестовая машина',
  make: 'Lada',
  model: 'Vesta',
  year: 2020,
  plateNumber: 'А123ВС77',
  vin: '',
  fuelType: 'petrol',
  tankCapacity: 55,
  initialOdometer: 99500,
  purchaseDate: null,
  isArchived: false,
  color: '#888888',
  notes: '',
};

const fuel: FuelEntry[] = [
  // Частичная заправка ДО первой полной — она не должна попасть в метод полного бака.
  { ...base, id: 'f0', vehicleId: 'v1', date: '2026-01-02', odometer: 99500, volume: 45, pricePerUnit: 60, totalCost: 2700, fuelType: 'petrol', isFullTank: false, station: 'Лукойл', notes: '' },
  { ...base, id: 'f1', vehicleId: 'v1', date: '2026-01-05', odometer: 100000, volume: 50, pricePerUnit: 60, totalCost: 3000, fuelType: 'petrol', isFullTank: true, station: 'Лукойл', notes: '' },
  { ...base, id: 'f2', vehicleId: 'v1', date: '2026-01-20', odometer: 100500, volume: 40, pricePerUnit: 60, totalCost: 2400, fuelType: 'petrol', isFullTank: false, station: 'Газпром', notes: '' },
  { ...base, id: 'f3', vehicleId: 'v1', date: '2026-02-10', odometer: 101000, volume: 50, pricePerUnit: 60, totalCost: 3000, fuelType: 'petrol', isFullTank: true, station: 'Лукойл', notes: '' },
  { ...base, id: 'f4', vehicleId: 'v1', date: '2026-03-05', odometer: 101800, volume: 64, pricePerUnit: 63, totalCost: 4032, fuelType: 'petrol', isFullTank: true, station: 'Роснефть', notes: '' },
];

const expenses: Expense[] = [
  { ...base, id: 'e1', vehicleId: 'v1', date: '2026-02-01', category: 'maintenance', amount: 8000, odometer: 100800, vendor: 'СТО', description: 'ТО-2', notes: '' },
  { ...base, id: 'e2', vehicleId: 'v1', date: '2026-02-14', category: 'wash', amount: 500, odometer: null, vendor: 'Мойка', description: 'Комплекс', notes: '' },
  { ...base, id: 'e3', vehicleId: 'v1', date: '2026-03-01', category: 'insurance', amount: 12000, odometer: null, vendor: 'ОСАГО', description: 'Полис', notes: '' },
];

const incomes: Income[] = [
  { ...base, id: 'i1', vehicleId: 'v1', date: '2026-03-02', amount: 25000, source: 'taxi', odometer: 101700, description: 'Смена' },
];

describe('fuelConsumptionFullTank — метод полного бака', () => {
  it('выделяет два отрезка и не учитывает заправку до первой полной', () => {
    const segments = fuelConsumptionFullTank(fuel);
    expect(segments).toHaveLength(2);

    // 100 000 → 101 000 км: залито 40 + 50 = 90 л на 1000 км = 9,0 л/100 км
    expect(segments[0]).toMatchObject({ fromOdometer: 100000, toOdometer: 101000, distanceKm: 1000, liters: 90, l100km: 9 });
    // 101 000 → 101 800 км: залито 64 л на 800 км = 8,0 л/100 км
    expect(segments[1]).toMatchObject({ fromOdometer: 101000, toOdometer: 101800, distanceKm: 800, liters: 64, l100km: 8 });
  });

  it('средневзвешенный расход = 154 л на 1800 км = 8,56 л/100 км', () => {
    const result = averageConsumption(fuel, 'full-tank');
    expect(result.method).toBe('full-tank');
    expect(result.value).toBe(8.56);
  });

  it('автоматический метод выбирает полный бак, когда есть две полные заправки', () => {
    expect(averageConsumption(fuel).method).toBe('full-tank');
    expect(averageConsumption(fuel).value).toBe(8.56);
  });

  it('отбрасывает отрезки с нулевым или отрицательным пробегом', () => {
    const broken: FuelEntry[] = [
      { ...fuel[1], id: 'x1', odometer: 100000, isFullTank: true },
      { ...fuel[1], id: 'x2', odometer: 100000, isFullTank: true },
    ];
    expect(fuelConsumptionFullTank(broken)).toHaveLength(0);
  });
});

describe('упрощённый расход', () => {
  it('считает все литры кроме первой заправки на весь пробег', () => {
    // 249 − 45 = 204 л на 2300 км = 8,87 л/100 км
    expect(simplifiedConsumption(fuel)).toBe(8.87);
  });

  it('возвращает null, если записей меньше двух', () => {
    expect(simplifiedConsumption([fuel[0]])).toBeNull();
    expect(simplifiedConsumption([])).toBeNull();
  });

  it('переключается на упрощённый метод, когда полных заправок меньше двух', () => {
    const onlyPartial = fuel.map((e) => ({ ...e, isFullTank: false }));
    const result = averageConsumption(onlyPartial);
    expect(result.method).toBe('simplified');
    expect(result.value).toBe(8.87);
  });
});

describe('стоимость километра', () => {
  it('полная стоимость километра: (топливо + прочее) / пробег', () => {
    // (15 132 + 20 500) / 2300 = 15,49
    expect(costPerKm(15132, 20500, 2300)).toBe(15.49);
  });

  it('стоимость километра только по топливу', () => {
    // 15 132 / 2300 = 6,58
    expect(fuelCostPerKm(15132, 2300)).toBe(6.58);
  });

  it('считает цену за литр из суммы и объёма', () => {
    expect(priceFromTotal(2601, 42.5)).toBe(61.2);
    expect(priceFromTotal(1000, 0)).toBeNull();
  });

  it('подсказывает объём по сумме и цене АЗС', () => {
    expect(volumeFromTotal(2601, 61.2)).toBe(42.5);
    expect(volumeFromTotal(2601, null)).toBeNull();
    expect(volumeFromTotal(500, 0)).toBeNull();
  });

  it('возвращает null при нулевом пробеге вместо бесконечности', () => {
    expect(costPerKm(1000, 0, 0)).toBeNull();
    expect(fuelCostPerKm(1000, 0)).toBeNull();
  });
});

describe('агрегаты за период', () => {
  it('складывает топливо, прочие расходы и доходы', () => {
    const totals = periodTotals(fuel, expenses, incomes);
    expect(totals.fuelCost).toBe(15132);
    expect(totals.otherCost).toBe(20500);
    expect(totals.totalCost).toBe(35632);
    expect(totals.income).toBe(25000);
    expect(totals.profit).toBe(-10632);
    expect(totals.liters).toBe(249);
    expect(totals.distanceKm).toBe(2300);
  });

  it('фильтрует записи по периоду', () => {
    const march = periodTotals(fuel, expenses, incomes, '2026-03-01', '2026-03-31');
    expect(march.fuelCost).toBe(4032);
    expect(march.otherCost).toBe(12000);
    expect(march.income).toBe(25000);
  });

  it('структура расходов: доли в сумме дают ровно 100 %', () => {
    const breakdown = categoryBreakdown(fuel, expenses);
    expect(breakdown[0].category).toBe('fuel');
    expect(breakdown[0].amount).toBe(15132);
    expect(breakdown.reduce((acc, row) => acc + row.share, 0)).toBeCloseTo(100, 5);
    expect(breakdown.find((r) => r.category === 'insurance')?.label).toBe('Страховка');
  });

  it('ряд по месяцам включает пустые месяцы', () => {
    const series = monthlySeries(fuel, expenses, 3, new Date('2026-03-15T00:00:00Z'));
    expect(series.map((s) => s.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    // январь: 2700 + 3000 + 2400 = 8100 ₽ топлива
    expect(series[0].total).toBe(8100);
    // февраль: 3000 ₽ топлива + 8000 ₽ ТО + 500 ₽ мойка = 11 500 ₽
    expect(series[1].total).toBe(11500);
    // март: 4032 ₽ топлива + 12 000 ₽ страховка = 16 032 ₽
    expect(series[2].total).toBe(16032);
  });

  it('сводка по автомобилю считает пробег от начального значения', () => {
    const stats = overviewStats(vehicle, fuel, expenses, incomes, new Date('2026-03-20T00:00:00Z'));
    expect(stats.currentOdometer).toBe(101800);
    expect(stats.totalDistanceKm).toBe(2300);
    expect(stats.l100km).toBe(8.56);
    expect(stats.monthSpend).toBe(16032);
    expect(stats.yearSpend).toBe(35632);
    expect(stats.totalSpend).toBe(35632);
  });
});

describe('износ и напоминания', () => {
  const rule: ServiceRule = {
    ...base,
    id: 'r1',
    vehicleId: 'v1',
    name: 'Замена масла',
    intervalKm: 10000,
    intervalDays: 365,
    componentLifeKm: 30000,
    lastServiceOdometer: 95000,
    lastServiceDate: '2025-06-01',
    warnKmBefore: 1000,
    warnDaysBefore: 30,
    notes: '',
  };

  it('статус «норма», когда запаса хватает по обоим критериям', () => {
    const status = wearStatus(rule, 103500, new Date('2026-03-01T00:00:00Z'));
    expect(status.status).toBe('ok');
    expect(status.remainingKm).toBe(1500);
    expect(status.remainingDays).toBe(92);
    expect(status.nextServiceOdometer).toBe(105000);
    expect(status.nextServiceDate).toBe('2026-06-01');
  });

  it('статус «скоро» по пробегу', () => {
    expect(wearStatus(rule, 104500, new Date('2026-03-01T00:00:00Z')).status).toBe('soon');
  });

  it('статус «просрочено» по пробегу', () => {
    expect(wearStatus(rule, 105200, new Date('2026-03-01T00:00:00Z')).status).toBe('overdue');
  });

  it('статус «скоро» по дате, даже если пробег в норме', () => {
    const status = wearStatus(rule, 100000, new Date('2026-05-20T00:00:00Z'));
    expect(status.status).toBe('soon');
    expect(status.remainingDays).toBe(12);
  });

  it('считает процент износа детали', () => {
    const status = wearStatus(rule, 103500, new Date('2026-03-01T00:00:00Z'));
    expect(status.usedKm).toBe(8500);
    expect(status.percentUsed).toBe(28.3);
  });

  it('сортирует напоминания: просрочено → скоро → норма', () => {
    const rules: ServiceRule[] = [
      { ...rule, id: 'ok', name: 'Норма', lastServiceOdometer: 100000, intervalDays: null, lastServiceDate: null },
      { ...rule, id: 'over', name: 'Просрочено', lastServiceOdometer: 90000 },
      { ...rule, id: 'soon', name: 'Скоро', lastServiceOdometer: 93500, intervalDays: null, lastServiceDate: null },
    ];
    const list = buildReminders(rules, 103000, new Date('2026-03-01T00:00:00Z'));
    expect(list.map((r) => r.ruleId)).toEqual(['over', 'soon', 'ok']);
  });
});

describe('поездки и электро', () => {
  it('стоимость поездки: 150 км × 8 л/100 км × 60 ₽ = 720 ₽', () => {
    expect(tripCost(150, 8, 60)).toBe(720);
    expect(tripProfit(1500, 720)).toBe(780);
    expect(tripProfit(1500, null)).toBe(1500);
    expect(tripCost(150, null, 60)).toBeNull();
  });

  it('средняя цена топлива: 15 132 ₽ / 249 л = 60,77 ₽', () => {
    expect(averageFuelPrice(fuel)).toBe(60.77);
  });

  it('расход электромобиля считается в кВт·ч/100 км', () => {
    const electric: FuelEntry[] = [
      { ...fuel[1], id: 'c1', odometer: 100000, volume: 60, isFullTank: true, totalCost: 600, pricePerUnit: 10 },
      { ...fuel[3], id: 'c2', odometer: 100400, volume: 68, isFullTank: true, totalCost: 680, pricePerUnit: 10 },
    ];
    expect(kwhPer100km(electric)).toBe(17);
  });
});

describe('единицы измерения', () => {
  it('литры ↔ галлоны (US и Imperial)', () => {
    expect(litersToGallons(10, 'us')).toBe(2.642);
    expect(litersToGallons(10, 'imperial')).toBe(2.2);
    expect(gallonsToLiters(10, 'us')).toBe(37.854);
  });

  it('километры ↔ мили', () => {
    expect(kmToMiles(100)).toBe(62.137);
    expect(milesToKm(100)).toBe(160.934);
  });

  it('л/100 км ↔ MPG', () => {
    expect(l100kmToMpg(8, 'us')).toBe(29.4);
    expect(l100kmToMpg(8, 'imperial')).toBe(35.31);
    expect(l100kmToMpg(0, 'us')).toBeNull();
  });
});

describe('текущий пробег', () => {
  it('берёт максимум из начального значения и всех показаний одометра', () => {
    expect(currentOdometer(vehicle, fuel, expenses)).toBe(101800);
  });

  it('учитывает начальный пробег, если записей нет', () => {
    expect(currentOdometer(vehicle, [], [])).toBe(99500);
  });
});
