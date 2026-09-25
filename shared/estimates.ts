/**
 * Смета на предстоящее ТО: сколько это будет стоить по вашим же данным.
 *
 * Принцип: никаких внешних сервисов и выдуманных цен. Цена позиции берётся из вашей истории
 * (склад запчастей, прошлые расходы) либо вписывается вручную, а смета честно показывает,
 * какие цены подтверждены историей, а какие вы ввели сами.
 */

import { round, sum } from './calc.ts';
import type { EstimateItem } from './types.ts';

/** Итог сметы: детали и жидкости + работы. */
export function estimateTotal(parts: EstimateItem[], laborHours: number, laborRatePerHour: number): number {
  const partsTotal = sum(parts.map((item) => item.quantity * item.unitPrice));
  const laborTotal = Math.max(0, laborHours) * Math.max(0, laborRatePerHour);
  return round(partsTotal + laborTotal, 2);
}

/**
 * Достоверность сметы: 1 — все цены подтверждены историей журнала,
 * ниже — часть позиций вписана вручную, значит итог можно только прикидывать.
 */
export function estimateConfidence(parts: EstimateItem[]): number {
  if (!parts.length) return 0;
  const known = parts.filter((item) => item.priceSource === 'history' || item.priceSource === 'pack').length;
  return round(known / parts.length, 2);
}

/** Строка для описания расхода: коротко перечисляем, из чего сложилась сумма. */
export function estimateSummary(parts: EstimateItem[], laborHours: number, laborRatePerHour: number): string {
  const rows = parts
    .filter((item) => item.quantity * item.unitPrice > 0)
    .map((item) => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`);
  if (laborHours > 0) rows.push(`работы ${laborHours} ч × ${Math.round(laborRatePerHour)} ₽`);
  return rows.join(', ');
}

/**
 * Цена позиции по вашей истории: точное совпадение артикула важнее, чем совпадение по названию.
 * Возвращает цену и пояснение, откуда она взялась.
 */
export interface PriceSuggestion {
  unitPrice: number;
  source: 'history' | 'manual';
  note: string;
}

export function suggestPrice(
  target: { name: string; article: string },
  history: Array<{ name: string; article: string; price: number }>,
): PriceSuggestion {
  const article = target.article.trim().toLowerCase();
  const name = target.name.trim().toLowerCase();

  if (article) {
    const byArticle = history.find((row) => row.article.trim().toLowerCase() === article && row.price > 0);
    if (byArticle) return { unitPrice: byArticle.price, source: 'history', note: `по артикулу: покупали за ${Math.round(byArticle.price)} ₽` };
  }

  if (name.length >= 4) {
    const byName = history.find(
      (row) => row.price > 0 && (row.name.trim().toLowerCase().includes(name) || name.includes(row.name.trim().toLowerCase())),
    );
    if (byName) return { unitPrice: byName.price, source: 'history', note: `по названию: покупали за ${Math.round(byName.price)} ₽` };
  }

  return { unitPrice: 0, source: 'manual', note: 'цены в истории нет — впишите сами' };
}
