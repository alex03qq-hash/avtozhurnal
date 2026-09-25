import { describe, expect, it } from 'vitest';
import { distributeOdometers, parseDate, parseExpenseRows, parseFuelRows, splitRowsByMileage } from '../importer.ts';

describe('разбор дат', () => {
  it('понимает разные форматы', () => {
    expect(parseDate('12.07.2025')).toBe('2025-07-12');
    expect(parseDate('12/07/2025')).toBe('2025-07-12');
    expect(parseDate('2025-07-12')).toBe('2025-07-12');
    expect(parseDate('12 июля 2025')).toBe('2025-07-12');
    expect(parseDate('12 июл 2025')).toBe('2025-07-12');
    expect(parseDate('нет даты')).toBeNull();
  });
});

describe('импорт заправок', () => {
  const rows = parseFuelRows([
    '05.09.2025 42,5 л 2 601 ₽ Газпромнефть',
    '18.09.2025\t55,1 л\t3 340,50 руб\tГазпромнефть',
    '02.10.2025 48,0 л 2 950 ₽ 54300 км Газпромнефть',
    'Прайс-лист',
  ].join('\n'));

  it('читает объём, сумму и АЗС', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe('2025-09-05');
    expect(rows[0].volume).toBe(42.5);
    expect(rows[0].totalCost).toBe(2601);
    expect(rows[0].station).toContain('Газпромнефть');
  });

  it('читает копейки и табуляцию', () => {
    expect(rows[1].totalCost).toBe(3340.5);
    expect(rows[1].volume).toBe(55.1);
  });

  it('подхватывает одометр, если он указан с «км»', () => {
    expect(rows[2].odometer).toBe(54300);
  });

  it('пропускает строки без даты', () => {
    expect(rows.some((row) => row.raw.includes('Прайс'))).toBe(false);
  });
});

describe('импорт расходов', () => {
  const rows = parseExpenseRows([
    '15.10.2025 ОСАГО 12 800 ₽',
    '01.11.2025 Оклейка защитной плёнкой 89 000 руб',
    '20.11.2025 Антикор днища 34 500 ₽',
    '05.12.2025 Мойка 900 ₽',
  ].join('\n'));

  it('разбирает дату, сумму и описание', () => {
    expect(rows).toHaveLength(4);
    expect(rows[0].amount).toBe(12800);
    expect(rows[0].description).toContain('ОСАГО');
  });

  it('угадывает категории по словам', () => {
    expect(rows[0].categoryHint).toBe('insurance');
    expect(rows[1].categoryHint).toBe('other');
    expect(rows[2].categoryHint).toBe('other');
    expect(rows[3].categoryHint).toBe('wash');
  });

  it('считает плановое ТО обслуживанием, а не покупкой запчастей', () => {
    const [row] = parseExpenseRows('10.03.2026 Плановое ТО масло и фильтр 9 800 ₽');
    expect(row.categoryHint).toBe('maintenance');
  });
});

describe('расстановка одометров по датам', () => {
  const rows = [{ date: '2025-09-01' }, { date: '2025-10-01' }, { date: '2025-11-01' }, { date: '2025-12-01' }, { date: '2026-01-01' }];
  const start = { date: '2025-09-01', odometer: 0 };
  const end = { date: '2026-01-01', odometer: 4000 };

  it('без известных замеров расставляет пробег линейно', () => {
    const filled = distributeOdometers(rows, start, end);
    expect(filled.map((row) => row.odometer)).toEqual([0, 984, 2000, 2984, 4000]);
  });

  it('учитывает известный замер из файла', () => {
    const filled = distributeOdometers(rows, start, end, [{ date: '2025-11-01', odometer: 3000 }]);
    expect(filled.map((row) => row.odometer)).toEqual([0, 1475, 3000, 3492, 4000]);
  });

  it('игнорирует замер, который ломает порядок (пробег назад)', () => {
    const filled = distributeOdometers(rows, start, end, [{ date: '2025-12-01', odometer: 500 }]);
    const values = filled.map((row) => row.odometer);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('сохраняет порядок строк по датам', () => {
    const filled = distributeOdometers([{ date: '2025-12-01' }, { date: '2025-09-01' }], start, end);
    expect(filled.map((row) => row.date)).toEqual(['2025-09-01', '2025-12-01']);
  });
});

describe('распределение по пробегу', () => {
  it('делит заправки пропорционально расстоянию', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ date: '2025-06-01', label: `заправка ${i}` }));
    const split = splitRowsByMileage(rows, [
      { vehicleId: 'haval', distanceKm: 12000, startOdometer: 0, endOdometer: 12000 },
      { vehicleId: 'bmw', distanceKm: 6000, startOdometer: 0, endOdometer: 6000 },
    ]);
    const haval = split.find((s) => s.vehicleId === 'haval')!;
    const bmw = split.find((s) => s.vehicleId === 'bmw')!;
    expect(haval.rows.length + bmw.rows.length).toBe(10);
    expect(haval.rows.length).toBeGreaterThan(bmw.rows.length);
    expect(haval.rows.length).toBe(7);
    expect(bmw.rows.length).toBe(3);
  });

  it('раздаёт строки по очереди, а не «куском»', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ date: '2025-06-01', label: i }));
    const split = splitRowsByMileage(rows, [
      { vehicleId: 'a', distanceKm: 2, startOdometer: 0, endOdometer: 2 },
      { vehicleId: 'b', distanceKm: 1, startOdometer: 0, endOdometer: 1 },
    ]);
    const a = split.find((s) => s.vehicleId === 'a')!.rows;
    const b = split.find((s) => s.vehicleId === 'b')!.rows;
    // Обе машины получают заправки по всему периоду, а не половинами
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(2);
    const labelsA = a.map((row) => row.label);
    const labelsB = b.map((row) => row.label);
    expect(Math.min(...labelsB)).toBeLessThan(Math.max(...labelsA));
  });

  it('не отдаёт машине заправку раньше её покупки', () => {
    const rows = [
      { date: '2025-09-01', volume: 40 },
      { date: '2025-10-05', volume: 40 },
      { date: '2025-11-05', volume: 40 },
    ];
    const split = splitRowsByMileage(rows, [
      { vehicleId: 'a', distanceKm: 1000, startOdometer: 0, endOdometer: 1000, availableFrom: '2025-08-01' },
      { vehicleId: 'b', distanceKm: 1000, startOdometer: 0, endOdometer: 1000, availableFrom: '2025-10-01' },
    ]);
    const b = split.find((s) => s.vehicleId === 'b')!;
    expect(b.rows.every((row) => row.date >= '2025-10-01')).toBe(true);
    expect(split.flatMap((s) => s.rows)).toHaveLength(3);
  });

  it('ничего не теряет и не дублирует', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ date: '2025-06-01', label: i }));
    const split = splitRowsByMileage(rows, [
      { vehicleId: 'a', distanceKm: 1, startOdometer: 0, endOdometer: 1 },
      { vehicleId: 'b', distanceKm: 1, startOdometer: 0, endOdometer: 1 },
      { vehicleId: 'c', distanceKm: 1, startOdometer: 0, endOdometer: 1 },
    ]);
    const all = split.flatMap((s) => s.rows).map((row) => row.label).sort((x, y) => x - y);
    expect(all).toEqual(rows.map((row) => row.label));
  });

  it('не делит, если пробег неизвестен', () => {
    expect(splitRowsByMileage([{ date: '2025-06-01' }], [{ vehicleId: 'a', distanceKm: 0, startOdometer: 0, endOdometer: 0 }])).toEqual([]);
  });
});

describe('расстановка одометров', () => {
  it('распределяет линейно по датам', () => {
    const rows = [
      { date: '2025-10-12', volume: 40 },
      { date: '2026-01-12', volume: 40 },
      { date: '2026-04-12', volume: 40 },
    ];
    const withOdometer = distributeOdometers(rows, { date: '2025-07-12', odometer: 0 }, { date: '2026-07-12', odometer: 12000 });
    expect(withOdometer[0].odometer).toBeGreaterThan(0);
    expect(withOdometer[2].odometer).toBeGreaterThan(withOdometer[1].odometer);
    expect(withOdometer[2].odometer).toBeLessThan(12000);
    // Январь — примерно середина периода: ожидаем около 6000 км из 12000
    expect(Math.abs(withOdometer[1].odometer - 6000)).toBeLessThan(500);
  });

  it('сортирует по дате и не выходит за границы', () => {
    const rows = [
      { date: '2026-06-01', volume: 10 },
      { date: '2025-08-01', volume: 10 },
    ];
    const result = distributeOdometers(rows, { date: '2025-07-12', odometer: 100 },
      { date: '2026-07-12', odometer: 1100 });
    expect(result[0].date).toBe('2025-08-01');
    expect(result[0].odometer).toBeGreaterThanOrEqual(100);
    expect(result[1].odometer).toBeLessThanOrEqual(1100);
  });
});
