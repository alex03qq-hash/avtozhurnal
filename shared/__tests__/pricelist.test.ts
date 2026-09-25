import { describe, expect, it } from 'vitest';
import { applyPricelist, parsePricelist } from '../pricelist.ts';
import type { EstimateItem } from '../types.ts';

const part = (over: Partial<EstimateItem> = {}): EstimateItem => ({
  name: 'Масляный фильтр',
  article: '',
  quantity: 1,
  unitPrice: 0,
  priceSource: 'manual',
  note: '',
  ...over,
});

describe('разбор списка цен', () => {
  it('читает строку с названием, артикулом и ценой', () => {
    const rows = parsePricelist('Масляный фильтр MANN W 712/95 — 690 ₽');
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(690);
    expect(rows[0].article).toBe('W 712/95');
    expect(rows[0].name).toContain('фильтр');
  });

  it('читает цену с копейками и валютой «руб»', () => {
    const rows = parsePricelist('Масло BMW LL-17 FE+ 0W-20, 1 л; 1 850,50 руб');
    expect(rows[0].price).toBe(1850.5);
  });

  it('понимает разделители: точка с запятой, табуляцию, несколько колонок', () => {
    const rows = parsePricelist('Фильтр воздушный\t17801-0T030\t2 400,00\t1 шт');
    expect(rows[0].price).toBe(2400);
    expect(rows[0].article).toBe('17801-0T030');
    expect(rows[0].quantity).toBe(1);
  });

  it('читает количество «×4»', () => {
    const rows = parsePricelist('Свеча зажигания 12290-R1A-H01 ×4 — 1 200 ₽');
    expect(rows[0].quantity).toBe(4);
    expect(rows[0].price).toBe(1200);
  });

  it('пропускает строки без цены и заголовки', () => {
    const rows = parsePricelist('Прайс-лист\nНаличие уточняйте\n\nФильтр салона 1 500 ₽');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain('салона');
  });

  it('не путает вязкость масла с артикулом', () => {
    const rows = parsePricelist('Масло моторное 5W-30 4 л 3 200 ₽');
    expect(rows[0].article).toBe('');
    expect(rows[0].price).toBe(3200);
  });
});

describe('подстановка цен в смету', () => {
  it('находит позицию по артикулу', () => {
    const parts = [part({ article: 'w 712/95' })];
    const parsed = parsePricelist('Фильтр масляный;W 712/95;690 ₽');
    const result = applyPricelist(parts, parsed);
    expect(result.matched).toBe(1);
    expect(result.parts[0].unitPrice).toBe(690);
    expect(result.parts[0].priceSource).toBe('history');
  });

  it('находит позицию по названию, если артикула нет', () => {
    const parts = [part({ name: 'Воздушный фильтр двигателя' })];
    const parsed = parsePricelist('Фильтр воздушный двигателя — 2 400 ₽');
    const result = applyPricelist(parts, parsed);
    expect(result.matched).toBe(1);
    expect(result.parts[0].unitPrice).toBe(2400);
  });

  it('оставляет цену как есть, если совпадения нет, и сообщает об этом', () => {
    const parts = [part({ name: 'Ремень ГРМ', unitPrice: 5000 })];
    const parsed = parsePricelist('Масло моторное — 3 200 ₽');
    const result = applyPricelist(parts, parsed);
    expect(result.matched).toBe(0);
    expect(result.parts[0].unitPrice).toBe(5000);
    expect(result.unmatched).toBe(1);
    expect(result.leftovers).toHaveLength(1);
  });

  it('не использует одну строку дважды', () => {
    const parts = [part({ name: 'Фильтр масляный' }), part({ name: 'Фильтр масляный' })];
    const parsed = parsePricelist('Фильтр масляный — 700 ₽');
    const result = applyPricelist(parts, parsed);
    expect(result.matched).toBe(1);
    expect(result.parts[1].unitPrice).toBe(0);
  });

  it('берёт количество из списка', () => {
    const parts = [part({ name: 'Свеча зажигания', quantity: 1 })];
    const parsed = parsePricelist('Свеча зажигания ×4 — 1 200 ₽');
    const result = applyPricelist(parts, parsed);
    expect(result.parts[0].quantity).toBe(4);
  });
});
