/** Тесты валидации входных данных: разумные границы, обязательные поля, авторасчёты. */

import { describe, expect, it } from 'vitest';
import { sanitize, ValidationError } from '../src/validate.ts';

describe('валидация заправок', () => {
  it('считает сумму из объёма и цены, если сумму не передали', () => {
    const record = sanitize<Record<string, unknown>>('fuel', {
      vehicleId: 'v1',
      date: '2026-09-01',
      odometer: 1000,
      volume: 40,
      pricePerUnit: 60.5,
    });
    expect(record.totalCost).toBe(2420);
  });

  it('считает цену из суммы, если цену не передали', () => {
    const record = sanitize<Record<string, unknown>>('fuel', {
      vehicleId: 'v1',
      date: '2026-09-01',
      odometer: 1000,
      volume: 40,
      totalCost: 2420,
    });
    expect(record.pricePerUnit).toBe(60.5);
  });

  it('принимает запятую как десятичный разделитель', () => {
    const record = sanitize<Record<string, unknown>>('fuel', {
      vehicleId: 'v1',
      date: '2026-09-01',
      odometer: 1000,
      volume: '40,5',
      pricePerUnit: '60,5',
    });
    expect(record.volume).toBe(40.5);
    expect(record.pricePerUnit).toBe(60.5);
  });

  it('отклоняет неправдоподобно большие числа и «бесконечности»', () => {
    expect(() => sanitize('fuel', { vehicleId: 'v1', date: '2026-09-01', odometer: 1e308, volume: 40 })).toThrow(
      ValidationError,
    );
    expect(() => sanitize('fuel', { vehicleId: 'v1', date: '2026-09-01', odometer: 'Infinity', volume: 40 })).toThrow(
      ValidationError,
    );
  });

  it('отклоняет отрицательные значения там, где они запрещены', () => {
    expect(() => sanitize('expenses', { vehicleId: 'v1', date: '2026-09-01', amount: -100 })).toThrow(ValidationError);
  });
});

describe('валидация общих полей', () => {
  it('требует название автомобиля', () => {
    expect(() => sanitize('vehicles', { name: '   ' })).toThrow(/название/i);
  });

  it('требует корректную дату', () => {
    expect(() => sanitize('expenses', { vehicleId: 'v1', date: '01.09.2026', amount: 100 })).toThrow(/датой/i);
  });

  it('отклоняет неизвестную категорию расхода', () => {
    expect(() =>
      sanitize('expenses', { vehicleId: 'v1', date: '2026-09-01', amount: 100, category: 'космос' }),
    ).toThrow(/Недопустимое значение/i);
  });

  it('в режиме частичного обновления не трогает непереданные поля', () => {
    const patch = sanitize('expenses', { amount: 500 }, true);
    expect(patch).toEqual({ amount: 500 });
  });

  it('пустые необязательные числа превращает в null', () => {
    const record = sanitize('expenses', { vehicleId: 'v1', date: '2026-09-01', amount: 100, odometer: '' });
    expect(record.odometer).toBeNull();
  });

  it('ограничивает длину текстовых полей', () => {
    const record = sanitize<Record<string, unknown>>('vehicles', { name: 'А'.repeat(500) });
    expect(String(record.name).length).toBe(200);
  });
});
