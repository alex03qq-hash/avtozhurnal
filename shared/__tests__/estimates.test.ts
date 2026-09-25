import { describe, expect, it } from 'vitest';
import { estimateConfidence, estimateSummary, estimateTotal, suggestPrice } from '../estimates.ts';
import type { EstimateItem } from '../types.ts';

const item = (over: Partial<EstimateItem> = {}): EstimateItem => ({
  name: 'Масляный фильтр',
  article: '',
  quantity: 1,
  unitPrice: 0,
  priceSource: 'manual',
  note: '',
  ...over,
});

describe('итог сметы', () => {
  it('складывает детали и работы', () => {
    const parts = [item({ quantity: 4, unitPrice: 1250 }), item({ name: 'Масло', quantity: 1, unitPrice: 4200 })];
    // 4 × 1250 + 4200 + 1,5 ч × 2500 = 5000 + 4200 + 3750
    expect(estimateTotal(parts, 1.5, 2500)).toBe(12950);
  });

  it('не считает работы при нулевой ставке', () => {
    expect(estimateTotal([item({ unitPrice: 1000 })], 3, 0)).toBe(1000);
  });

  it('пустая смета даёт ноль', () => {
    expect(estimateTotal([], 2, 2500)).toBe(5000);
  });
});

describe('достоверность сметы', () => {
  it('все цены из истории — единица', () => {
    expect(estimateConfidence([item({ priceSource: 'history' }), item({ priceSource: 'pack' })])).toBe(1);
  });

  it('половина вписана вручную — половина', () => {
    expect(estimateConfidence([item({ priceSource: 'history' }), item({ priceSource: 'manual' })])).toBe(0.5);
  });

  it('пустая смета — ноль', () => {
    expect(estimateConfidence([])).toBe(0);
  });
});

describe('подсказка цены по истории журнала', () => {
  const history = [
    { name: 'Фильтр масляный MANN', article: 'W 712/95', price: 690 },
    { name: 'Колодки тормозные передние', article: 'GDB1330', price: 5400 },
  ];

  it('находит цену по артикулу — это точнее названия', () => {
    const suggestion = suggestPrice({ name: 'другое название', article: 'w 712/95' }, history);
    expect(suggestion.unitPrice).toBe(690);
    expect(suggestion.source).toBe('history');
    expect(suggestion.note).toContain('артикул');
  });

  it('находит цену по названию, если артикула нет', () => {
    const suggestion = suggestPrice({ name: 'Колодки тормозные', article: '' }, history);
    expect(suggestion.unitPrice).toBe(5400);
    expect(suggestion.source).toBe('history');
  });

  it('честно говорит, что цены нет', () => {
    const suggestion = suggestPrice({ name: 'Ремень ГРМ', article: 'CT1234' }, history);
    expect(suggestion.unitPrice).toBe(0);
    expect(suggestion.source).toBe('manual');
    expect(suggestion.note).toContain('впишите');
  });
});

describe('расшифровка для расхода', () => {
  it('перечисляет позиции и работы', () => {
    const text = estimateSummary(
      [item({ name: 'Масло', quantity: 5, unitPrice: 800 }), item({ name: 'Фильтр', quantity: 1, unitPrice: 700 }), item({ name: 'Без цены' })],
      1,
      2500,
    );
    expect(text).toBe('Масло ×5, Фильтр, работы 1 ч × 2500 ₽');
  });
});
