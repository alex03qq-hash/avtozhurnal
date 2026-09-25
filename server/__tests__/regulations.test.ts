/** Тесты пакетов регламентов: проверка файла, подбор по авто, применение без потери правок. */

import { describe, expect, it } from 'vitest';
import { RegulationLibrary, USAGE_CLASS_MULTIPLIER, validatePack } from '../src/regulations.ts';
import type { RegulationPack, ServiceRule, Vehicle } from '../../shared/types.ts';

const now = '2026-01-01T00:00:00.000Z';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1',
    createdAt: now,
    updatedAt: now,
    name: 'Тестовая',
    make: 'Toyota',
    model: 'Camry',
    year: 2020,
    plateNumber: '',
    vin: '',
    fuelType: 'petrol',
    tankCapacity: 60,
    initialOdometer: 50000,
    purchaseDate: null,
    usageClass: 'normal',
    isArchived: false,
    color: '#000000',
    notes: '',
    ...overrides,
  };
}

const pack: RegulationPack = {
  schemaVersion: 1,
  packId: 'toyota.camry.xv70.petrol',
  title: 'Toyota Camry XV70, бензин',
  source: 'owner-manual',
  sourceUrl: 'https://example.org/manual',
  vendor: 'Toyota',
  models: ['Camry'],
  yearFrom: 2018,
  yearTo: 2023,
  fuelTypes: ['petrol'],
  engineCodes: ['2AR-FE'],
  usageMultiplier: { city: 0.8 },
  disclaimer: 'Шаблон по руководству владельца, проверяйте для своего VIN.',
  revision: 3,
  items: [
    { code: 'engine-oil', name: 'Масло и фильтр', everyKm: 15000, everyMonths: 12, severeEveryKm: 7500, severeEveryMonths: 9, lifeKm: 15000, severity: 'required', category: 'maintenance', notes: 'Заводская формулировка', estimatedCost: 6500, parts: [] },
    { code: 'spark-plugs', name: 'Свечи', everyKm: 60000, everyMonths: null, severeEveryKm: null, severeEveryMonths: null, lifeKm: 60000, severity: 'recommended', category: 'maintenance', notes: '', estimatedCost: 4000, parts: [{ name: 'Свеча', article: '90919', quantity: 4 }] },
  ],
};

describe('проверка файла пакета', () => {
  it('принимает корректный пакет', () => {
    const parsed = validatePack(pack);
    expect(parsed.packId).toBe(pack.packId);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[1].parts[0].article).toBe('90919');
  });

  it('отклоняет пакет без пунктов', () => {
    expect(() => validatePack({ packId: 'x', title: 'X', items: [] })).toThrow(/ни одного пункта/i);
  });

  it('отклоняет пункт без интервалов', () => {
    expect(() =>
      validatePack({ packId: 'x', title: 'X', items: [{ code: 'a', name: 'Пункт' }] }),
    ).toThrow(/ни интервал по пробегу, ни интервал по времени/i);
  });

  it('подставляет предупреждение и не выдумывает источник, если его не указали', () => {
    const parsed = validatePack({ packId: 'x', title: 'X', items: [{ code: 'a', name: 'Пункт', everyKm: 10000 }] });
    expect(parsed.disclaimer).toMatch(/проверяйте/i);
    expect(parsed.source).toBe('user');
    expect(parsed.revision).toBe(1);
  });

  it('сохраняет ревизию данных отдельно от версии формата', () => {
    const parsed = validatePack({ ...pack, schemaVersion: 2, revision: 7 });
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.revision).toBe(7);
  });
});

describe('подбор пакета по автомобилю', () => {
  const library = new RegulationLibrary('/tmp/unused');
  // Добавляем пакет напрямую, минуя файловую систему
  (library as unknown as { packs: Map<string, RegulationPack> }).packs.set(pack.packId, pack);

  it('находит пакет для подходящей машины', () => {
    const matched = library.match(makeVehicle());
    expect(matched).toHaveLength(1);
    expect(matched[0].packId).toBe(pack.packId);
    expect(matched[0].relevance).toBeGreaterThan(5);
  });

  it('не подходит по году выпуска', () => {
    expect(library.match(makeVehicle({ year: 2015 }))).toHaveLength(0);
  });

  it('не подходит по типу топлива', () => {
    expect(library.match(makeVehicle({ fuelType: 'diesel' }))).toHaveLength(0);
  });

  it('не подходит другой марке', () => {
    expect(library.match(makeVehicle({ make: 'Kia', model: 'Rio' }))).toHaveLength(0);
  });
});

describe('применение пакета', () => {
  const library = new RegulationLibrary('/tmp/unused');

  function makeRule(overrides: Partial<ServiceRule> = {}): ServiceRule {
    return {
      id: 'r1',
      createdAt: now,
      updatedAt: now,
      vehicleId: 'v1',
      name: 'Масло и фильтр',
      intervalKm: 10000,
      intervalDays: 180,
      componentLifeKm: 10000,
      lastServiceOdometer: 48000,
      lastServiceDate: '2025-12-01',
      warnKmBefore: 1000,
      warnDaysBefore: 14,
      notes: '',
      code: 'engine-oil',
      // По умолчанию пункт пришёл из пакета: именно такие обновляются регламентом.
      origin: 'pack',
      ...overrides,
    };
  }

  it('добавляет недостающие пункты и сохраняет историю замен', () => {
    const rules = [makeRule()];
    const result = library.apply(rules, makeVehicle(), pack, 'update-untouched');
    expect(result.added).toBe(1);
    expect(rules).toHaveLength(2);
    const added = rules.find((rule) => rule.code === 'spark-plugs');
    expect(added?.intervalKm).toBe(60000);
    expect(added?.origin).toBe('pack');
    // История существующего пункта не тронута
    expect(rules[0].lastServiceOdometer).toBe(48000);
    expect(rules[0].lastServiceDate).toBe('2025-12-01');
  });

  it('не перезаписывает интервал, который пользователь правил вручную', () => {
    const rules = [makeRule({ userOverridden: true, intervalKm: 10000 })];
    const result = library.apply(rules, makeVehicle(), pack, 'update-untouched');
    expect(result.updated).toBe(0);
    expect(result.kept).toBe(1);
    expect(rules[0].intervalKm).toBe(10000);
  });

  it('не перезаписывает пункт, который человек создал сам', () => {
    const rules = [makeRule({ origin: 'user', intervalKm: 9000, notes: 'Моё масло' })];
    const result = library.apply(rules, makeVehicle(), pack, 'update-untouched');
    expect(result.updated).toBe(0);
    expect(result.kept).toBe(1);
    expect(rules[0].intervalKm).toBe(9000);
    expect(rules[0].notes).toBe('Моё масло');
    expect(result.preview.some((row) => row.reason.includes('вручную'))).toBe(true);
  });

  it('не затирает заметки пользователя', () => {
    const rules = [makeRule({ userOverridden: false, notes: 'Масло 5W-30, фильтр MANN' })];
    const result = library.apply(rules, makeVehicle(), pack, 'update-untouched');
    expect(rules[0].notes).toBe('Масло 5W-30, фильтр MANN');
    // Заводская формулировка сохраняется отдельным полем, ничего не теряется
    expect(rules[0].packNotes).toBe('Заводская формулировка');
    expect(result.preview.some((row) => row.reason.includes('заметки'))).toBe(true);
  });

  it('считает месяцы через среднюю длину месяца, а не 30 дней', () => {
    const rules: ServiceRule[] = [];
    library.apply(rules, makeVehicle(), pack, 'update-untouched');
    const oil = rules.find((rule) => rule.code === 'engine-oil');
    // 12 месяцев — это 365 дней, а не 360
    expect(oil?.intervalDays).toBe(365);
    expect(oil?.manufacturerIntervalDays).toBe(365);
  });

  it('хранит ресурс детали отдельно от интервала замены', () => {
    const custom: RegulationPack = { ...pack, items: [{ ...pack.items[0], everyKm: 10000, lifeKm: 20000 }] };
    const rules: ServiceRule[] = [];
    library.apply(rules, makeVehicle(), custom, 'update-untouched');
    expect(rules[0].intervalKm).toBe(10000);
    expect(rules[0].componentLifeKm).toBe(20000);
  });

  it('не подставляет ресурс детали, если пакет его не указал', () => {
    const withoutLife: RegulationPack = { ...pack, items: [{ ...pack.items[0], lifeKm: null }] };
    const rules: ServiceRule[] = [];
    library.apply(rules, makeVehicle(), withoutLife, 'update-untouched');
    expect(rules[0].componentLifeKm).toBeNull();
  });

  it('хранит ревизию пакета, а не версию формата', () => {
    const rules: ServiceRule[] = [];
    library.apply(rules, makeVehicle(), pack, 'update-untouched');
    expect(rules[0].packRevision).toBe(3);
  });

  it('обновляет неизменённые пункты и применяет множитель условий, когда пункт его не задаёт', () => {
    // Свечи: своего интервала для тяжёлых условий в пакете нет → работает множитель пакета (город 0,8)
    const rules = [makeRule({ code: 'spark-plugs', name: 'Свечи', intervalKm: 60000, userOverridden: false })];
    const result = library.apply(rules, makeVehicle({ usageClass: 'city' }), pack, 'update-untouched');
    expect(result.updated).toBe(1);
    expect(rules[0].intervalKm).toBe(48000);
    expect(rules[0].manufacturerIntervalKm).toBe(60000);
    expect(rules[0].packId).toBe(pack.packId);
  });

  it('для тяжёлых условий берёт интервал из пункта пакета, а не общий множитель', () => {
    const rules = [makeRule({ origin: 'pack', userOverridden: false })];
    library.apply(rules, makeVehicle({ usageClass: 'city' }), pack, 'update-untouched');
    // В пакете для масла задано 7 500 км / 9 мес. — берём именно это, множитель города 0,8 не применяем
    expect(rules[0].intervalKm).toBe(7500);
    expect(rules[0].intervalDays).toBe(Math.round(9 * 30.44));
  });

  it('обычные условия оставляют заводской интервал', () => {
    const rules = [makeRule({ origin: 'pack', userOverridden: false })];
    library.apply(rules, makeVehicle({ usageClass: 'highway' }), pack, 'update-untouched');
    expect(rules[0].intervalKm).toBe(15000);
  });

  it('берёт множитель из общего справочника, если пакет его не задал', () => {
    const withoutMultiplier: RegulationPack = { ...pack, usageMultiplier: {} };
    const rules = [makeRule({ code: 'spark-plugs', name: 'Свечи', intervalKm: 60000, userOverridden: false })];
    library.apply(rules, makeVehicle({ usageClass: 'taxi' }), withoutMultiplier, 'update-untouched');
    expect(rules[0].intervalKm).toBe(Math.round(60000 * USAGE_CLASS_MULTIPLIER.taxi));
  });

  it('режим «добавить только недостающие» не трогает существующие пункты', () => {
    const rules = [makeRule({ userOverridden: false, intervalKm: 9000 })];
    const result = library.apply(rules, makeVehicle(), pack, 'add-missing');
    expect(result.kept).toBe(1);
    expect(rules[0].intervalKm).toBe(9000);
  });

  it('режим «заменить всё» перезаписывает даже ручные правки', () => {
    const rules = [makeRule({ origin: 'user', userOverridden: true })];
    const result = library.apply(rules, makeVehicle(), pack, 'replace-all');
    expect(result.updated).toBe(1);
    expect(rules[0].intervalKm).toBe(15000);
  });

  it('в предпросмотре видно, что произойдёт с каждым пунктом', () => {
    const rules = [makeRule({ origin: 'pack' }), makeRule({ id: 'r2', code: 'own', name: 'Мой пункт', origin: 'user' })];
    const result = library.apply(rules, makeVehicle(), pack, 'update-untouched');
    const actions = result.preview.map((row) => row.action);
    expect(actions).toContain('update');
    expect(actions).toContain('add');
    // Пункт, которого нет в пакете, остаётся нетронутым; добавленные в this счёт не попадают
    expect(result.leftAlone).toBe(1);
  });
});
