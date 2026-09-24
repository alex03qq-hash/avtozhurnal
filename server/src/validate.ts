/**
 * Валидация входящих данных. Все сообщения об ошибках — на русском,
 * потому что они показываются пользователю прямо в интерфейсе.
 */

import { randomUUID } from 'node:crypto';
import type { CollectionName } from '../../shared/types.ts';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
  FUEL_TYPE_LABELS,
  INCOME_SOURCE_LABELS,
} from '../../shared/constants.ts';

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

type FieldType = 'string' | 'text' | 'number' | 'int' | 'bool' | 'date' | 'enum' | 'nullableNumber' | 'nullableDate' | 'nullableId';

interface FieldSpec {
  type: FieldType;
  label: string;
  required?: boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
  default?: unknown;
}

const FUEL_TYPES = Object.keys(FUEL_TYPE_LABELS) as readonly string[];
const INPUT_SOURCES = Object.keys(INCOME_SOURCE_LABELS) as readonly string[];

const SPECS: Record<CollectionName, Record<string, FieldSpec>> = {
  vehicles: {
    name: { type: 'string', label: 'Название', required: true },
    make: { type: 'string', label: 'Марка', default: '' },
    model: { type: 'string', label: 'Модель', default: '' },
    year: { type: 'nullableNumber', label: 'Год выпуска', min: 1900, max: 2100 },
    plateNumber: { type: 'string', label: 'Госномер', default: '' },
    vin: { type: 'string', label: 'VIN', default: '' },
    fuelType: { type: 'enum', label: 'Тип привода', values: FUEL_TYPES, default: 'petrol' },
    tankCapacity: { type: 'number', label: 'Объём бака', min: 0, default: 0 },
    initialOdometer: { type: 'number', label: 'Начальный пробег', min: 0, default: 0 },
    purchaseDate: { type: 'nullableDate', label: 'Дата покупки' },
    isArchived: { type: 'bool', label: 'В архиве', default: false },
    color: { type: 'string', label: 'Цвет', default: '#7F8C8D' },
    notes: { type: 'text', label: 'Заметки', default: '' },
  },
  fuel: {
    vehicleId: { type: 'string', label: 'Автомобиль', required: true },
    date: { type: 'date', label: 'Дата', required: true },
    odometer: { type: 'number', label: 'Одометр', required: true, min: 0 },
    volume: { type: 'number', label: 'Объём', required: true, min: 0 },
    pricePerUnit: { type: 'number', label: 'Цена за литр', min: 0, default: 0 },
    totalCost: { type: 'number', label: 'Стоимость', min: 0, default: 0 },
    fuelType: { type: 'enum', label: 'Тип топлива', values: FUEL_TYPES, default: 'petrol' },
    isFullTank: { type: 'bool', label: 'Полный бак', default: false },
    photoId: { type: 'nullableId', label: 'Фото чека' },
    station: { type: 'string', label: 'АЗС', default: '' },
    notes: { type: 'text', label: 'Заметки', default: '' },
  },
  expenses: {
    vehicleId: { type: 'string', label: 'Автомобиль', required: true },
    date: { type: 'date', label: 'Дата', required: true },
    category: { type: 'enum', label: 'Категория', values: EXPENSE_CATEGORY_ORDER, default: 'other' },
    amount: { type: 'number', label: 'Сумма', required: true, min: 0 },
    odometer: { type: 'nullableNumber', label: 'Одометр', min: 0 },
    photoId: { type: 'nullableId', label: 'Фото чека' },
    vendor: { type: 'string', label: 'Исполнитель', default: '' },
    description: { type: 'string', label: 'Описание', default: '' },
    notes: { type: 'text', label: 'Заметки', default: '' },
  },
  incomes: {
    vehicleId: { type: 'string', label: 'Автомобиль', required: true },
    date: { type: 'date', label: 'Дата', required: true },
    amount: { type: 'number', label: 'Сумма', required: true, min: 0 },
    source: { type: 'enum', label: 'Источник', values: INPUT_SOURCES, default: 'other' },
    odometer: { type: 'nullableNumber', label: 'Одометр', min: 0 },
    description: { type: 'string', label: 'Описание', default: '' },
  },
  trips: {
    vehicleId: { type: 'string', label: 'Автомобиль', required: true },
    date: { type: 'date', label: 'Дата', required: true },
    distance: { type: 'number', label: 'Расстояние', required: true, min: 0 },
    purpose: { type: 'string', label: 'Цель поездки', default: '' },
    durationMinutes: { type: 'nullableNumber', label: 'Длительность, мин', min: 0 },
    revenue: { type: 'nullableNumber', label: 'Выручка', min: 0 },
    notes: { type: 'text', label: 'Заметки', default: '' },
  },
  parts: {
    vehicleId: { type: 'string', label: 'Автомобиль', required: true },
    name: { type: 'string', label: 'Название', required: true },
    article: { type: 'string', label: 'Артикул', default: '' },
    vendor: { type: 'string', label: 'Продавец', default: '' },
    price: { type: 'number', label: 'Цена', min: 0, default: 0 },
    quantity: { type: 'number', label: 'Количество', min: 0, default: 1 },
    installDate: { type: 'nullableDate', label: 'Дата установки' },
    installOdometer: { type: 'nullableNumber', label: 'Пробег при установке', min: 0 },
    notes: { type: 'text', label: 'Заметки', default: '' },
  },
  rules: {
    vehicleId: { type: 'string', label: 'Автомобиль', required: true },
    name: { type: 'string', label: 'Название', required: true },
    intervalKm: { type: 'nullableNumber', label: 'Интервал по пробегу', min: 0 },
    intervalDays: { type: 'nullableNumber', label: 'Интервал по времени, дней', min: 0 },
    componentLifeKm: { type: 'nullableNumber', label: 'Ресурс детали', min: 0 },
    lastServiceOdometer: { type: 'nullableNumber', label: 'Пробег последней замены', min: 0 },
    lastServiceDate: { type: 'nullableDate', label: 'Дата последней замены' },
    warnKmBefore: { type: 'number', label: 'Предупреждать за, км', min: 0, default: 1000 },
    warnDaysBefore: { type: 'number', label: 'Предупреждать за, дней', min: 0, default: 14 },
    notes: { type: 'text', label: 'Заметки', default: '' },
  },
  checklist: {
    vehicleId: { type: 'nullableId', label: 'Автомобиль' },
    label: { type: 'string', label: 'Пункт', required: true },
    isChecked: { type: 'bool', label: 'Отмечено', default: false },
    order: { type: 'number', label: 'Порядок', min: 0, default: 100 },
    lastCheckedAt: { type: 'nullableDate', label: 'Дата проверки' },
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Максимальная разумная величина для денег и пробега: защита от 1e308 и «бесконечностей». */
const MAX_ABS_NUMBER = 1e12;

function assertSaneNumber(value: number, label: string): void {
  if (Math.abs(value) > MAX_ABS_NUMBER) {
    throw new ValidationError(`Поле «${label}» вне допустимого диапазона.`);
  }
}

function coerce(spec: FieldSpec, value: unknown, key: string): unknown {
  const label = spec.label;
  switch (spec.type) {
    case 'string':
    case 'text': {
      if (value === undefined || value === null) return spec.default ?? '';
      const text = String(value).trim();
      if (spec.required && text === '') throw new ValidationError(`Поле «${label}» не может быть пустым.`);
      return spec.type === 'text' ? text.slice(0, 2000) : text.slice(0, 200);
    }
    case 'number':
    case 'int': {
      if (value === undefined || value === null || value === '') {
        if (spec.required) throw new ValidationError(`Укажите «${label}».`);
        return spec.default ?? 0;
      }
      const num = Number(String(value).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(num)) throw new ValidationError(`Поле «${label}» должно быть числом.`);
      assertSaneNumber(num, label);
      if (spec.min !== undefined && num < spec.min) throw new ValidationError(`Поле «${label}» не может быть меньше ${spec.min}.`);
      if (spec.max !== undefined && num > spec.max) throw new ValidationError(`Поле «${label}» не может быть больше ${spec.max}.`);
      return spec.type === 'int' ? Math.round(num) : Math.round(num * 100) / 100;
    }
    case 'nullableNumber': {
      if (value === undefined || value === null || value === '') return null;
      const num = Number(String(value).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(num)) throw new ValidationError(`Поле «${label}» должно быть числом.`);
      assertSaneNumber(num, label);
      if (spec.min !== undefined && num < spec.min) throw new ValidationError(`Поле «${label}» не может быть меньше ${spec.min}.`);
      return Math.round(num * 100) / 100;
    }
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0') return false;
      return spec.default ?? false;
    case 'date': {
      if (value === undefined || value === null || value === '') {
        if (spec.required) throw new ValidationError(`Укажите «${label}» в формате ГГГГ-ММ-ДД.`);
        return spec.default ?? null;
      }
      const text = String(value).slice(0, 10);
      if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        throw new ValidationError(`Поле «${label}» должно быть датой в формате ГГГГ-ММ-ДД.`);
      }
      return text;
    }
    case 'nullableDate':
      return value === undefined || value === null || value === '' ? null : coerce({ ...spec, type: 'date', required: true }, value, key);
    case 'nullableId':
      return value === undefined || value === null || value === '' ? null : String(value);
    case 'enum': {
      const text = String(value ?? spec.default ?? '');
      if (!spec.values?.includes(text)) {
        throw new ValidationError(`Недопустимое значение поля «${label}».`);
      }
      return text;
    }
    default:
      throw new ValidationError(`Неизвестный тип поля «${key}».`);
  }
}

/** Приводит входные данные к безопасному виду. `partial` — режим PATCH (меняются только переданные поля). */
export function sanitize<T extends Record<string, unknown>>(
  collection: CollectionName,
  input: Record<string, unknown>,
  partial = false,
): T {
  const spec = SPECS[collection];
  if (!spec) throw new ValidationError(`Неизвестная коллекция «${collection}».`);
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(spec)) {
    const provided = Object.prototype.hasOwnProperty.call(input, key);
    if (partial && !provided) continue;
    if (!provided && field.required && !partial) {
      throw new ValidationError(`Поле «${field.label}» обязательно.`);
    }
    result[key] = coerce(field, input[key], key);
  }

  if (collection === 'fuel') {
    const volume = Number(result.volume ?? 0);
    const price = Number(result.pricePerUnit ?? 0);
    const total = Number(result.totalCost ?? 0);
    // Если стоимость не указана, но есть объём и цена — считаем автоматически.
    if (!Number(result.totalCost) && volume && price) result.totalCost = Math.round(volume * price * 100) / 100;
    else if (!price && volume && total) result.pricePerUnit = Math.round((total / volume) * 100) / 100;
  }

  return result as T;
}

export function newId(): string {
  return randomUUID();
}

export function describeCategory(category: string): string {
  return (EXPENSE_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}
