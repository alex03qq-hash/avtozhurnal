/**
 * Типы данных «АвтоЖурнала».
 * Один и тот же набор типов используют сервер (Node/Express) и клиент (React).
 */

export type Id = string;

/** Тип силовой установки: определяет, в чём измеряется «топливо» (л или кВт·ч). */
export type FuelType = 'petrol' | 'diesel' | 'gas' | 'hybrid' | 'electric';

export type ExpenseCategory =
  | 'maintenance'
  | 'repair'
  | 'insurance'
  | 'tax'
  | 'wash'
  | 'tires'
  | 'parts'
  | 'fine'
  | 'parking'
  | 'other';

export type IncomeSource = 'taxi' | 'delivery' | 'rent' | 'other';

/** Система единиц интерфейса. Внутри базы всё хранится в километрах и литрах. */
export type UnitSystem = 'metric' | 'imperial';

export type ThemeName = 'light' | 'dark' | 'system';

/** Статус регламента обслуживания / износа детали. */
export type RuleStatus = 'ok' | 'soon' | 'overdue';

export interface BaseEntity {
  id: Id;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle extends BaseEntity {
  name: string;
  make: string;
  model: string;
  year: number | null;
  plateNumber: string;
  vin: string;
  fuelType: FuelType;
  /** Объём бака: литры либо кВт·ч для электромобиля. */
  tankCapacity: number;
  /** Пробег на момент начала учёта (км). */
  initialOdometer: number;
  purchaseDate: string | null;
  /** Условия эксплуатации: влияют на пересчёт заводского интервала ТО. */
  usageClass?: UsageClass;
  isArchived: boolean;
  color: string;
  notes: string;
}

export interface FuelEntry extends BaseEntity {
  vehicleId: Id;
  /** Дата в формате YYYY-MM-DD. */
  date: string;
  /** Одометр на момент заправки, км. */
  odometer: number;
  /** Объём: литры либо кВт·ч. */
  volume: number;
  /** Цена за литр (кВт·ч), ₽. */
  pricePerUnit: number;
  /** Полная стоимость, ₽. */
  totalCost: number;
  fuelType: FuelType;
  /** Заправка «до полного бака» — критично для корректного расчёта расхода. */
  isFullTank: boolean;
  station: string;
  /**
   * Ссылка на фото чека (файл в data/photos). Поле необязательное: в записях,
   * сделанных до появления фотографий, его просто нет.
   */
  photoId?: Id | null;
  notes: string;
}

export interface Expense extends BaseEntity {
  vehicleId: Id;
  date: string;
  category: ExpenseCategory;
  amount: number;
  odometer: number | null;
  vendor: string;
  description: string;
  /**
   * Ссылка на фото чека (файл в data/photos). Поле необязательное: в записях,
   * сделанных до появления фотографий, его просто нет.
   */
  photoId?: Id | null;
  notes: string;
}

export interface Income extends BaseEntity {
  vehicleId: Id;
  date: string;
  amount: number;
  source: IncomeSource;
  odometer: number | null;
  description: string;
}

export interface Trip extends BaseEntity {
  vehicleId: Id;
  date: string;
  /** Расстояние поездки, км. */
  distance: number;
  purpose: string;
  durationMinutes: number | null;
  /** Выручка за поездку, ₽ (для такси и доставки). */
  revenue: number | null;
  notes: string;
}

export interface Part extends BaseEntity {
  vehicleId: Id;
  name: string;
  /** Артикул — копируется в буфер одной кнопкой. */
  article: string;
  vendor: string;
  price: number;
  quantity: number;
  installDate: string | null;
  installOdometer: number | null;
  notes: string;
}

/** Условия эксплуатации: влияют на то, как часто обслуживать машину. */
export type UsageClass = 'highway' | 'normal' | 'city' | 'severe' | 'taxi';

/** Пункт заводского регламента в составе пакета. */
export interface RegulationItem {
  /** Стабильный код пункта: по нему пакет обновляется, не теряя историю замен. */
  code: string;
  name: string;
  everyKm: number | null;
  everyMonths: number | null;
  /**
   * Интервалы для тяжёлых условий (город, пробки, пыль, короткие поездки).
   * Задаются по конкретному пункту, а не общим множителем: у масла и у свечей
   * сокращение разное, и придумывать одно число на всё нельзя.
   */
  severeEveryKm: number | null;
  severeEveryMonths: number | null;
  /** Полный ресурс детали (для процента износа) — не то же самое, что интервал замены. */
  lifeKm: number | null;
  severity: 'required' | 'recommended' | 'check';
  category: ExpenseCategory;
  notes: string;
  /** Ориентировочная стоимость работ и расходников, ₽ — для прогноза затрат. */
  estimatedCost: number | null;
  parts: Array<{ name: string; article: string; quantity: number }>;
}

/**
 * Пакет регламентов: локальный файл с заводскими интервалами.
 * Никакой онлайн-загрузки: файл либо лежит в data/regulations/packs, либо импортируется вручную.
 * Источник и предупреждение хранятся внутри пакета — их видит пользователь.
 */
export interface RegulationPack {
  /** Версия формата файла: нужна приложению, чтобы понимать структуру. */
  schemaVersion: number;
  /** Ревизия самих данных пакета: её видит пользователь и она растёт при правках. */
  revision: number;
  packId: string;
  title: string;
  /** owner-manual — руководство владельца, public-data — открытые данные, user — свой шаблон. */
  source: 'owner-manual' | 'public-data' | 'user';
  sourceUrl: string;
  vendor: string;
  models: string[];
  yearFrom: number | null;
  yearTo: number | null;
  fuelTypes: FuelType[];
  engineCodes: string[];
  /** Множители интервала по условиям эксплуатации: 1.0 — как у производителя. */
  usageMultiplier: Partial<Record<UsageClass, number>>;
  /** Текст, который обязательно показывается рядом с применённым регламентом. */
  disclaimer: string;
  items: RegulationItem[];
}

/** Регламент обслуживания: задаёт и напоминание, и расчёт износа. */
export interface ServiceRule extends BaseEntity {
  vehicleId: Id;
  name: string;
  /** Интервал по пробегу, км. */
  intervalKm: number | null;
  /** Интервал по времени, дней. */
  intervalDays: number | null;
  /** Полный ресурс детали, км — используется для процента износа. */
  componentLifeKm: number | null;
  lastServiceOdometer: number | null;
  lastServiceDate: string | null;
  /** За сколько километров до срока предупреждать. */
  warnKmBefore: number;
  /** За сколько дней до срока предупреждать. */
  warnDaysBefore: number;
  notes: string;

  /* ── Связь с пакетом регламентов (все поля необязательные) ── */
  /** Код пункта в пакете — по нему обновление находит пункт, не плодя дубли. */
  code?: string | null;
  /** Откуда пункт: 'pack' — из пакета регламентов, 'user' — создан вручную. */
  origin?: 'user' | 'pack';
  packId?: string | null;
  packTitle?: string | null;
  /** Ревизия данных пакета — отдельно от версии формата файла. */
  packRevision?: number | null;
  /** Заметки, пришедшие из пакета: заметки пользователя хранятся в notes и не затираются. */
  packNotes?: string | null;
  /** Заводской интервал и интервал с учётом условий — чтобы видеть, откуда взялась цифра. */
  manufacturerIntervalKm?: number | null;
  manufacturerIntervalDays?: number | null;
  /** Пользователь правил интервал вручную: при обновлении пакета такое не перезаписывается. */
  userOverridden?: boolean;
}

export interface ChecklistItem extends BaseEntity {
  /** null — пункт общий для всех автомобилей. */
  vehicleId: Id | null;
  label: string;
  isChecked: boolean;
  order: number;
  lastCheckedAt: string | null;
}

/** Позиция сметы: деталь, расходник или жидкость. */
export interface EstimateItem {
  name: string;
  article: string;
  quantity: number;
  unitPrice: number;
  /** Откуда взялась цена: из истории журнала, из пакета регламента или вписана вручную. */
  priceSource: 'history' | 'pack' | 'manual';
  note: string;
}

/**
 * Смета на предстоящее ТО.
 *
 * Считается локально: цены берутся из уже внесённых записей (что вы платили за похожие работы
 * и запчасти) либо вписываются вручную. Внешние сервисы не используются — суммы всегда можно
 * проверить по своей же истории. Принятая смета превращается в обычный расход.
 */
export interface Estimate extends BaseEntity {
  vehicleId: Id;
  /** Код пункта регламента, если смета построена по нему. */
  ruleCode: string | null;
  ruleName: string;
  title: string;
  createdAt: string;
  /** До какого времени смету считаем актуальной. */
  validUntil: string;
  status: 'draft' | 'accepted' | 'archived';
  parts: EstimateItem[];
  laborHours: number;
  laborRatePerHour: number;
  laborDescription: string;
  total: number;
  /** Насколько данным можно доверять: 1 — все цены из истории, ниже — есть вписанные вручную. */
  confidence: number;
  notes: string;
  /** Расход, созданный из этой сметы. */
  expenseId?: Id | null;
}

export interface Settings extends BaseEntity {
  activeVehicleId: Id | null;
  theme: ThemeName;
  unitSystem: UnitSystem;
  currency: string;
}

export interface Database {
  schemaVersion: number;
  settings: Settings;
  vehicles: Vehicle[];
  fuel: FuelEntry[];
  expenses: Expense[];
  incomes: Income[];
  trips: Trip[];
  parts: Part[];
  rules: ServiceRule[];
  checklist: ChecklistItem[];
  estimates: Estimate[];
}

/** Коллекции, доступные через универсальный CRUD-роутер. */
export type CollectionName =
  | 'vehicles'
  | 'fuel'
  | 'expenses'
  | 'incomes'
  | 'trips'
  | 'parts'
  | 'rules'
  | 'checklist'
  | 'estimates';

export interface ConsumptionSegment {
  fromDate: string;
  toDate: string;
  fromOdometer: number;
  toOdometer: number;
  distanceKm: number;
  liters: number;
  l100km: number;
  cost: number;
}

export interface WearStatus {
  ruleId: Id;
  name: string;
  status: RuleStatus;
  remainingKm: number | null;
  remainingDays: number | null;
  usedKm: number | null;
  percentUsed: number | null;
  nextServiceOdometer: number | null;
  nextServiceDate: string | null;
}

export interface OverviewStats {
  vehicleId: Id | null;
  currentOdometer: number;
  totalDistanceKm: number;
  l100km: number | null;
  consumptionMethod: 'full-tank' | 'simplified' | 'none';
  costPerKm: number | null;
  fuelCostPerKm: number | null;
  monthSpend: number;
  yearSpend: number;
  totalSpend: number;
  totalFuelCost: number;
  totalOtherCost: number;
  income: number;
  profit: number;
  fuelLiters: number;
  entriesCount: number;
}
