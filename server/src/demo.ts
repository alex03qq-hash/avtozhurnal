/**
 * Генератор демонстрационных данных.
 * Нужен, чтобы приложение можно было осмотреть сразу после установки:
 * две машины (бензиновая и электрическая), год истории, разные статусы ТО.
 */

import { randomUUID } from 'node:crypto';
import { DEFAULT_CHECKLIST } from '../../shared/constants.ts';
import { addDays, todayISO } from '../../shared/format.ts';
import type {
  ChecklistItem,
  Database,
  Expense,
  FuelEntry,
  Income,
  Part,
  ServiceRule,
  Trip,
  Vehicle,
} from '../../shared/types.ts';

/** Простой детерминированный генератор — данные воспроизводимы от запуска к запуску. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function stamp(id: string, createdAt: string) {
  return { id, createdAt, updatedAt: createdAt };
}

export function buildDemoData(today = new Date()): Omit<Database, 'settings' | 'schemaVersion'> {
  const rand = makeRandom(20260924);
  const todayIso = todayISO(today);

  /* ── Автомобили ─────────────────────────────────────────────── */
  const vesta: Vehicle = {
    ...stamp(randomUUID(), `${addDays(todayIso, -380)}T09:00:00.000Z`),
    name: 'Веста — рабочая',
    make: 'Lada',
    model: 'Vesta SW Cross',
    year: 2020,
    plateNumber: 'А123ВС77',
    vin: 'XTAGFL110LY123456',
    fuelType: 'petrol',
    tankCapacity: 55,
    initialOdometer: 41200,
    purchaseDate: addDays(todayIso, -370),
    isArchived: false,
    color: '#2F6F6B',
    notes: 'Основная машина, летом — поездки на дачу.',
  };
  const leaf: Vehicle = {
    ...stamp(randomUUID(), `${addDays(todayIso, -300)}T09:00:00.000Z`),
    name: 'Leaf — городской',
    make: 'Nissan',
    model: 'Leaf ZE1',
    year: 2019,
    plateNumber: 'В456ОР99',
    vin: 'SJNFAAZE1U0123456',
    fuelType: 'electric',
    tankCapacity: 40,
    initialOdometer: 58400,
    purchaseDate: addDays(todayIso, -290),
    isArchived: false,
    color: '#4C6EF5',
    notes: 'Заряжается дома от ночного тарифа.',
  };

  /* ── Заправки: 12 месяцев истории ───────────────────────────── */
  const fuel: FuelEntry[] = [];
  let odoA = vesta.initialOdometer;
  let odoB = leaf.initialOdometer;

  for (let monthBack = 11; monthBack >= 0; monthBack -= 1) {
    const monthDate = (day: number) => {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthBack, day));
      return todayISO(d);
    };
    const petrolPrice = 58 + Math.round(rand() * 60) / 10; // 58,0 … 64,0 ₽/л

    for (const day of [4, 18]) {
      if (monthBack === 0 && day > Number(todayIso.slice(8, 10))) continue;
      const distance = 420 + Math.round(rand() * 260);
      odoA += distance;
      const liters = Math.round((distance / 100) * (7.9 + rand() * 0.7) * 10) / 10;
      fuel.push({
        ...stamp(randomUUID(), `${monthDate(day)}T08:30:00.000Z`),
        vehicleId: vesta.id,
        date: monthDate(day),
        odometer: odoA,
        volume: liters,
        pricePerUnit: petrolPrice,
        totalCost: Math.round(liters * petrolPrice * 100) / 100,
        fuelType: 'petrol',
        isFullTank: true,
        station: ['Лукойл', 'Газпромнефть', 'Роснефть', 'Shell'][Math.floor(rand() * 4)],
        notes: '',
      });
    }

    for (const day of [7, 21]) {
      if (monthBack === 0 && day > Number(todayIso.slice(8, 10))) continue;
      const distance = 480 + Math.round(rand() * 200);
      odoB += distance;
      const kwh = Math.round((distance / 100) * (15.5 + rand() * 2.5) * 10) / 10;
      const price = 7.4 + Math.round(rand() * 8) / 10;
      fuel.push({
        ...stamp(randomUUID(), `${monthDate(day)}T22:10:00.000Z`),
        vehicleId: leaf.id,
        date: monthDate(day),
        odometer: odoB,
        volume: kwh,
        pricePerUnit: price,
        totalCost: Math.round(kwh * price * 100) / 100,
        fuelType: 'electric',
        isFullTank: true,
        station: 'Домашняя зарядка',
        notes: '',
      });
    }
  }

  /* ── Расходы ────────────────────────────────────────────────── */
  const expenses: Expense[] = [];
  const addExpense = (
    vehicle: Vehicle,
    date: string,
    category: Expense['category'],
    amount: number,
    odometer: number | null,
    vendor: string,
    description: string,
  ) => {
    expenses.push({
      ...stamp(randomUUID(), `${date}T12:00:00.000Z`),
      vehicleId: vehicle.id,
      date,
      category,
      amount,
      odometer,
      vendor,
      description,
      notes: '',
    });
  };

  const rel = (monthBack: number, day: number) =>
    todayISO(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthBack, day)));

  addExpense(vesta, rel(11, 2), 'insurance', 12800, null, 'Росгосстрах', 'ОСАГО на год');
  addExpense(vesta, rel(10, 12), 'tax', 4200, null, 'ФНС', 'Транспортный налог');
  addExpense(vesta, rel(9, 20), 'maintenance', 11400, 46300, 'СТО «Гараж 77»', 'ТО-4: масло, фильтры, свечи');
  addExpense(vesta, rel(8, 6), 'tires', 24600, 47800, 'Шинный центр', 'Комплект летних шин');
  addExpense(vesta, rel(7, 15), 'repair', 6800, 48900, 'СТО «Гараж 77»', 'Замена передних стоек стабилизатора');
  addExpense(vesta, rel(6, 9), 'wash', 700, null, 'Мойка «Аква»', 'Комплексная мойка');
  addExpense(vesta, rel(6, 24), 'fine', 500, null, 'ГИБДД', 'Превышение скорости');
  addExpense(vesta, rel(5, 11), 'maintenance', 7300, 50200, 'СТО «Гараж 77»', 'Замена масла и фильтра');
  addExpense(vesta, rel(4, 3), 'parts', 5400, null, 'Exist', 'Колодки тормозные передние');
  addExpense(vesta, rel(4, 18), 'repair', 3900, 51400, 'Гараж', 'Замена тормозных колодок');
  addExpense(vesta, rel(3, 7), 'wash', 850, null, 'Мойка «Аква»', 'Мойка + химчистка салона');
  addExpense(vesta, rel(2, 21), 'parking', 2200, null, 'Парковка «Сити»', 'Месячный абонемент');
  addExpense(vesta, rel(1, 14), 'maintenance', 8100, 52700, 'СТО «Гараж 77»', 'Замена масла, воздушный фильтр');
  addExpense(vesta, rel(0, 4), 'wash', 900, null, 'Мойка «Аква»', 'Мойка кузова');

  addExpense(leaf, rel(9, 5), 'insurance', 9600, null, 'РЕСО', 'ОСАГО на год');
  addExpense(leaf, rel(7, 22), 'tax', 1800, null, 'ФНС', 'Транспортный налог');
  addExpense(leaf, rel(5, 16), 'maintenance', 3200, 64600, 'Электро-сервис', 'Диагностика и замена салонного фильтра');
  addExpense(leaf, rel(2, 8), 'tires', 18400, 66200, 'Шинный центр', 'Комплект зимних шин');
  addExpense(leaf, rel(0, 6), 'wash', 600, null, 'Мойка «Аква»', 'Экспресс-мойка');

  /* ── Доходы (подработка в такси) ────────────────────────────── */
  const incomes: Income[] = [];
  for (let monthBack = 11; monthBack >= 0; monthBack -= 2) {
    const day = 27;
    if (monthBack === 0 && day > Number(todayIso.slice(8, 10))) continue;
    const amount = 14000 + Math.round(rand() * 9000);
    const date = rel(monthBack, Math.min(day, 27));
    incomes.push({
      ...stamp(randomUUID(), `${date}T20:00:00.000Z`),
      vehicleId: vesta.id,
      date,
      amount,
      source: 'taxi',
      odometer: null,
      description: 'Выходные смены в такси',
    });
  }

  /* ── Поездки ────────────────────────────────────────────────── */
  const trips: Trip[] = [
    { day: 3, distance: 210, purpose: 'Москва — Тула и обратно', minutes: 260, revenue: null },
    { day: 12, distance: 64, purpose: 'Аэропорт Шереметьево', minutes: 95, revenue: 2400 },
    { day: 21, distance: 148, purpose: 'Доставка заказов по городу', minutes: 320, revenue: 5200 },
    { day: 27, distance: 36, purpose: 'Поездка в сервис', minutes: 55, revenue: null },
  ].map((t) => {
    const date = rel(0, Math.min(t.day, Number(todayIso.slice(8, 10))));
    return {
      ...stamp(randomUUID(), `${date}T15:00:00.000Z`),
      vehicleId: vesta.id,
      date,
      distance: t.distance,
      purpose: t.purpose,
      durationMinutes: t.minutes,
      revenue: t.revenue,
      notes: '',
    };
  });

  /* ── Склад запчастей ────────────────────────────────────────── */
  const parts: Part[] = [
    {
      name: 'Фильтр масляный',
      article: 'MANN W 914/2',
      vendor: 'Exist',
      price: 690,
      quantity: 2,
      installDate: rel(1, 14),
      installOdometer: 52700,
      notes: 'Оригинал для 1.6 MPI',
    },
    {
      name: 'Свечи зажигания',
      article: 'NGK LZKAR6AP-11',
      vendor: 'Ozon',
      price: 1450,
      quantity: 4,
      installDate: rel(9, 20),
      installOdometer: 46300,
      notes: '',
    },
    {
      name: 'Колодки тормозные передние',
      article: 'TRW GDB1330',
      vendor: 'Exist',
      price: 5400,
      quantity: 1,
      installDate: rel(4, 18),
      installOdometer: 51400,
      notes: 'Встали без доработок',
    },
    {
      name: 'Щётки стеклоочистителя',
      article: 'BOSCH AeroTwin A297S',
      vendor: 'Ozon',
      price: 2100,
      quantity: 1,
      installDate: null,
      installOdometer: null,
      notes: 'Лежат в запасе',
    },
  ].map((p) => ({ ...stamp(randomUUID(), `${rel(4, 1)}T10:00:00.000Z`), vehicleId: vesta.id, ...p }));

  /* ── Регламенты ТО ──────────────────────────────────────────── */
  const currentVesta = odoA;
  const currentLeaf = odoB;
  const rules: ServiceRule[] = [
    {
      ...stamp(randomUUID(), `${addDays(todayIso, -120)}T10:00:00.000Z`),
      vehicleId: vesta.id,
      name: 'Замена масла и фильтра',
      intervalKm: 10000,
      intervalDays: 365,
      componentLifeKm: 12000,
      lastServiceOdometer: currentVesta - 700,
      lastServiceDate: rel(1, 14),
      warnKmBefore: 1000,
      warnDaysBefore: 30,
      notes: 'Масло 5W-30, фильтр MANN.',
    },
    {
      ...stamp(randomUUID(), `${addDays(todayIso, -120)}T10:00:00.000Z`),
      vehicleId: vesta.id,
      name: 'Тормозные колодки (передние)',
      intervalKm: 40000,
      intervalDays: null,
      componentLifeKm: 40000,
      lastServiceOdometer: currentVesta - 38200,
      lastServiceDate: rel(4, 18),
      warnKmBefore: 2000,
      warnDaysBefore: 14,
      notes: 'TRW GDB1330.',
    },
    {
      ...stamp(randomUUID(), `${addDays(todayIso, -120)}T10:00:00.000Z`),
      vehicleId: vesta.id,
      name: 'ОСАГО',
      intervalKm: null,
      intervalDays: 365,
      componentLifeKm: null,
      lastServiceOdometer: null,
      lastServiceDate: addDays(todayIso, -350),
      warnKmBefore: 0,
      warnDaysBefore: 30,
      notes: 'Продлить онлайн.',
    },
    {
      ...stamp(randomUUID(), `${addDays(todayIso, -120)}T10:00:00.000Z`),
      vehicleId: vesta.id,
      name: 'Воздушный фильтр',
      intervalKm: 15000,
      intervalDays: null,
      componentLifeKm: 15000,
      lastServiceOdometer: currentVesta - 15200,
      lastServiceDate: rel(11, 20),
      warnKmBefore: 1000,
      warnDaysBefore: 14,
      notes: 'Меняется вместе с маслом.',
    },
    {
      ...stamp(randomUUID(), `${addDays(todayIso, -120)}T10:00:00.000Z`),
      vehicleId: vesta.id,
      name: 'Ремень ГРМ',
      intervalKm: 60000,
      intervalDays: null,
      componentLifeKm: 90000,
      lastServiceOdometer: currentVesta - 20000,
      lastServiceDate: rel(9, 20),
      warnKmBefore: 3000,
      warnDaysBefore: 30,
      notes: 'Менять с роликами.',
    },
    {
      ...stamp(randomUUID(), `${addDays(todayIso, -120)}T10:00:00.000Z`),
      vehicleId: leaf.id,
      name: 'Тормозная жидкость',
      intervalKm: null,
      intervalDays: 730,
      componentLifeKm: null,
      lastServiceOdometer: null,
      lastServiceDate: addDays(todayIso, -100),
      warnKmBefore: 0,
      warnDaysBefore: 30,
      notes: '',
    },
  ];

  /* ── Чек-лист ───────────────────────────────────────────────── */
  const checklist: ChecklistItem[] = DEFAULT_CHECKLIST.map((item) => ({
    ...stamp(randomUUID(), `${addDays(todayIso, -30)}T10:00:00.000Z`),
    vehicleId: null,
    label: item.label,
    isChecked: item.order <= 3,
    order: item.order,
    lastCheckedAt: item.order <= 3 ? addDays(todayIso, -2) : null,
  }));

  return { vehicles: [vesta, leaf], fuel, expenses, incomes, trips, parts, rules, estimates: [], checklist };
}
