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
}

export interface ChecklistItem extends BaseEntity {
  /** null — пункт общий для всех автомобилей. */
  vehicleId: Id | null;
  label: string;
  isChecked: boolean;
  order: number;
  lastCheckedAt: string | null;
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
  | 'checklist';

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
