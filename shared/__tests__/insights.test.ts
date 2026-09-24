import { describe, expect, it } from 'vitest';
import { drivingStyle, ownershipInsight, REFERENCE_CONSUMPTION, wearForecast } from '../insights.ts';
import type { Vehicle, WearStatus } from '../types.ts';

const vehicle: Vehicle = {
  id: 'v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  name: 'Тестовая',
  make: 'Lada',
  model: 'Vesta',
  year: 2020,
  plateNumber: '',
  vin: '',
  fuelType: 'petrol',
  tankCapacity: 55,
  initialOdometer: 0,
  purchaseDate: null,
  isArchived: false,
  color: '#000000',
  notes: '',
};

describe('стиль вождения', () => {
  it('считает перерасход и повышает множитель износа', () => {
    const style = drivingStyle([], vehicle, 10, 1000);
    // норма бензина 8,5 → 10 это +18 % → множитель 1 + 1,8 × 0,04 = 1,07
    expect(style.reference).toBe(REFERENCE_CONSUMPTION.petrol);
    expect(style.deviationPercent).toBe(18);
    expect(style.wearFactor).toBe(1.07);
    expect(style.label).toBe('активный');
  });

  it('понижает множитель при экономичной езде', () => {
    const style = drivingStyle([], vehicle, 7, 1200);
    expect(style.deviationPercent).toBe(-18);
    expect(style.wearFactor).toBe(0.93);
    expect(style.label).toBe('экономный');
  });

  it('учитывает большой пробег', () => {
    const style = drivingStyle([], vehicle, 8.5, 3000);
    expect(style.wearFactor).toBeGreaterThan(1);
    expect(style.label).toBe('обычный');
  });

  it('без данных не выдумывает вывод', () => {
    const style = drivingStyle([], vehicle, null, 1000);
    expect(style.label).toBe('нет данных');
    expect(style.wearFactor).toBe(1);
    expect(style.explanation).toMatch(/данных мало/i);
  });

  it('не выходит за разумные границы множителя', () => {
    expect(drivingStyle([], vehicle, 40, 5000).wearFactor).toBeLessThanOrEqual(1.35);
    expect(drivingStyle([], vehicle, 2, 100).wearFactor).toBeGreaterThanOrEqual(0.85);
  });
});

describe('прогноз износа', () => {
  const items: WearStatus[] = [
    {
      ruleId: 'r1',
      name: 'Тормозные колодки',
      status: 'soon',
      remainingKm: 1000,
      remainingDays: null,
      usedKm: 39000,
      percentUsed: 97.5,
      nextServiceOdometer: 105000,
      nextServiceDate: null,
    },
  ];

  it('пересчитывает остаток через множитель стиля', () => {
    const style = drivingStyle([], vehicle, 10, 1000); // множитель 1,07
    const [forecast] = wearForecast(items, style, 400, '2026-09-24');
    expect(forecast.adjustedRemainingKm).toBe(935);
    expect(forecast.adjustedPercent).toBe(104.3);
    expect(forecast.monthsLeft).toBe(2.3);
    // 2,3 месяца от 24.09.2026 — это 2 месяца и 9 дней
    expect(forecast.predictedDate).toBe('2026-12-03');
  });

  it('просроченное показывает сегодняшней датой', () => {
    const overdue: WearStatus[] = [{ ...items[0], status: 'overdue', remainingKm: -200 }];
    const [forecast] = wearForecast(overdue, drivingStyle([], vehicle, 8.5, 1000), 400, '2026-09-24');
    expect(forecast.predictedDate).toBe('2026-09-24');
  });

  it('без пробега в месяц не обещает дату', () => {
    const [forecast] = wearForecast(items, drivingStyle([], vehicle, 8.5, 0), 0, '2026-09-24');
    expect(forecast.monthsLeft).toBeNull();
    expect(forecast.predictedDate).toBeNull();
  });
});

describe('подсказка по стоимости владения', () => {
  const monthly = Array.from({ length: 6 }, (_, index) => ({ key: `2026-0${index + 1}`, total: 18000 }));

  it('советует подумать о продаже при дорогом и растущем владении', () => {
    const insight = ownershipInsight(monthly, { costPerKm: 25, distanceKm: 12000 }, { costPerKmBefore: 18 });
    expect(insight.verdict).toBe('подумать о продаже');
    expect(insight.costTrendPercent).toBe(39);
    expect(insight.explanation).toMatch(/не финансовая рекомендация/i);
  });

  it('советует наблюдать при умеренном росте', () => {
    const cheap = monthly.map((row) => ({ ...row, total: 6000 }));
    const insight = ownershipInsight(cheap, { costPerKm: 12, distanceKm: 12000 }, { costPerKmBefore: 10 });
    expect(insight.verdict).toBe('наблюдать');
  });

  it('при стабильных расходах советует держать', () => {
    const cheap = monthly.map((row) => ({ ...row, total: 6000 }));
    const insight = ownershipInsight(cheap, { costPerKm: 10, distanceKm: 12000 }, { costPerKmBefore: 10 });
    expect(insight.verdict).toBe('держать');
  });

  it('без истории честно говорит, что данных нет', () => {
    const insight = ownershipInsight([], { costPerKm: null, distanceKm: 0 }, { costPerKmBefore: null });
    expect(insight.verdict).toBe('нет данных');
  });
});
