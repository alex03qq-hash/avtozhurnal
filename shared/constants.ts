import type {
  ChecklistItem,
  ExpenseCategory,
  FuelType,
  IncomeSource,
  Settings,
  UnitSystem,
} from './types';

export const SCHEMA_VERSION = 1;

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  petrol: 'Бензин',
  diesel: 'Дизель',
  gas: 'Газ',
  hybrid: 'Гибрид',
  electric: 'Электро',
};

/** Единица измерения «топлива» для типа привода. */
export function fuelUnit(fuelType: FuelType): string {
  return fuelType === 'electric' ? 'кВт·ч' : 'л';
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  maintenance: 'ТО',
  repair: 'Ремонт',
  insurance: 'Страховка',
  tax: 'Налог',
  wash: 'Мойка',
  tires: 'Шины и шиномонтаж',
  parts: 'Запчасти',
  fine: 'Штрафы',
  parking: 'Парковка',
  other: 'Прочее',
};

export const EXPENSE_CATEGORY_ORDER: ExpenseCategory[] = [
  'maintenance',
  'repair',
  'parts',
  'tires',
  'insurance',
  'tax',
  'wash',
  'parking',
  'fine',
  'other',
];

export const INCOME_SOURCE_LABELS: Record<IncomeSource, string> = {
  taxi: 'Такси',
  delivery: 'Доставка',
  rent: 'Аренда',
  other: 'Прочее',
};

export const UNIT_SYSTEM_LABELS: Record<UnitSystem, string> = {
  metric: 'Километры и литры',
  imperial: 'Мили и галлоны',
};

export const DEFAULT_CHECKLIST: Array<Pick<ChecklistItem, 'label' | 'order'>> = [
  { label: 'Давление в шинах', order: 1 },
  { label: 'Уровень масла', order: 2 },
  { label: 'Уровень омывающей жидкости', order: 3 },
  { label: 'Работа света фар и стоп-сигналов', order: 4 },
  { label: 'Дворники и стеклоомыватель', order: 5 },
  { label: 'Тормозная жидкость', order: 6 },
  { label: 'Аптечка и огнетушитель', order: 7 },
];

export const DEFAULT_SETTINGS: Omit<Settings, 'id' | 'createdAt' | 'updatedAt'> = {
  activeVehicleId: null,
  theme: 'system',
  unitSystem: 'metric',
  currency: 'RUB',
};

/** Категории, которые чаще всего повторяются — используются в подсказках интерфейса. */
export const DEMO_MONTHS = 12;
