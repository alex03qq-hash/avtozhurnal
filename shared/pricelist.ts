/**
 * Разбор списка цен, скопированного из магазина или присланного сервисом.
 *
 * Зачем: приложение намеренно не ходит в интернет само. Цены ищет человек или ассистент,
 * а сюда попадает готовый список — текстом. Так работает и приватность (наружу ничего не уходит),
 * и проверяемость: рядом с ценой всегда видно, откуда она.
 *
 * Понимает строки в разных видах, какие обычно и получаются при копировании:
 *   «Масляный фильтр MANN W 712/95 — 690 ₽»
 *   «Масло BMW LL-17 FE+ 0W-20, 1 л; 1 850 ₽»
 *   «W 712/95   690,00 руб  2 шт»
 */

import type { EstimateItem } from './types.ts';

export interface ParsedPriceLine {
  name: string;
  article: string;
  price: number;
  quantity: number;
  /** Исходная строка — показываем её пользователю, чтобы было видно, что распознано верно. */
  raw: string;
  source: string;
}

/**
 * Цена — число с валютой либо последнее подходящее число в строке.
 *
 * Тонкость: разделителем разрядов бывает обычный и неразрывный пробел, но НЕ табуляция —
 * табуляция в скопированной таблице разделяет колонки, и склеивать через неё числа нельзя
 * (иначе «17801-0T030  2 400,00» превратится в 302400).
 */
const SPACES = ' \u00A0';
const NUMBER = `\\d[${SPACES}\\d]{0,12}(?:[.,]\\d{1,2})?`;

function extractPrice(line: string): number | null {
  const withCurrency = new RegExp(`(${NUMBER})[\\s\\u00A0]*(?:₽|руб\\.?|рублей|р\\.)\\b`, 'i').exec(line);
  if (withCurrency) return normalizeNumber(withCurrency[1]);

  // В шаблоне NUMBER нет своих групп захвата, поэтому берём совпадение целиком
  const numbers = [...line.matchAll(new RegExp(NUMBER, 'g'))].map((m) => normalizeNumber(m[0]) ?? 0);
  const candidates = numbers.filter((value) => value >= 10 && value <= 2_000_000);
  if (!candidates.length) return null;
  return candidates[candidates.length - 1];
}

function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00A0]/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/**
 * Артикул: сначала ищем компактный формат (17801-0T030, GDB1330),
 * затем формат с пробелом, как у фильтров Mann (W 712/95).
 */
function extractArticle(line: string): string {
  const compact = line.match(/\b(?=[A-Z0-9\-/]*[A-Z])(?=[A-Z0-9\-/]*\d)[A-Z0-9][A-Z0-9\-/.]{2,24}\b/);
  if (compact) {
    const candidate = compact[0];
    const isViscosity = /^\d+W-?\d*$/i.test(candidate) || /^FE\+?$/i.test(candidate) || /^L$/i.test(candidate);
    if (!isViscosity) return candidate;
  }

  const spaced = line.match(/\b([A-Z]{1,3}[ \u00A0]\d{2,5}[/\-]\d{1,3})\b/);
  return spaced ? spaced[1].replace(/\s+/g, ' ') : '';
}

/** Количество: «×2», «2 шт», «2 pcs». */
function extractQuantity(line: string): number {
  const match = line.match(/(?:[×xх]\s*(\d{1,3})\b)|(\b(\d{1,3})\s*(?:шт|pcs)\.?\b)/i);
  if (!match) return 1;
  const value = Number(match[1] ?? match[3]);
  return Number.isFinite(value) && value > 0 && value < 1000 ? value : 1;
}

function extractName(line: string, price: number, article: string): string {
  let name = line;
  name = name.replace(new RegExp(`(${NUMBER})[\\s\\u00A0]*(?:₽|руб\\.?|рублей|р\\.)\\b`, 'gi'), ' ');
  if (article) name = name.replace(article, ' ');
  name = name.replace(/(?:[×xх]\s*\d{1,3}\b|\b\d{1,3}\s*(?:шт|pcs)\.?)/gi, ' ');
  if (!/(?:₽|руб|рублей|р\.)/i.test(line) && price) {
    // Без валюты убираем само число — в любом написании (с пробелом или точкой)
    const plain = String(price);
    name = name.replace(new RegExp(plain.replace('.', '[.,]').replace(/\B(?=(\d{3})+(?!\d))/g, `[${SPACES}]?`), 'g'), ' ');
  }
  // Финальная зачистка: убираем любые остатки «число + валюта», в каком бы виде они ни были
  name = name.replace(/[\d\s\u00A0.,]*\d[\d\s\u00A0.,]*[\s\u00A0]*(?:₽|руб\.?|рублей|р\.)/gi, ' ');
  name = name.replace(/[;,|]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '');
  name = name.replace(/[\s\u00A0]+$/g, '');
  return name.slice(0, 160);
}

/**
 * Разбирает текст. Строка без цены пропускается — значит это заголовок или примечание,
 * и подставлять в смету нечего.
 */
export function parsePricelist(text: string, source = 'вставлено вручную'): ParsedPriceLine[] {
  const rows: ParsedPriceLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 3) continue;
    const price = extractPrice(line);
    if (price === null || price <= 0) continue;
    const article = extractArticle(line);
    const name = extractName(line, price, article);
    if (name.length < 2) continue;
    rows.push({ name, article, price, quantity: extractQuantity(line), raw: line.slice(0, 200), source });
  }
  return rows.slice(0, 100);
}

export interface PricelistResult {
  parts: EstimateItem[];
  matched: number;
  unmatched: number;
  /** Строки, которые ни с чем не совпали — показываем их, чтобы человек связал вручную. */
  leftovers: ParsedPriceLine[];
}

/**
 * Подставляет цены в позиции сметы. Артикул важнее названия: он однозначнее.
 * Ничего не додумываем: не нашли — оставляем цену как была и сообщаем об этом.
 */
export function applyPricelist(parts: EstimateItem[], parsed: ParsedPriceLine[]): PricelistResult {
  const used = new Set<number>();
  let matched = 0;

  const next = parts.map((part) => {
    const article = part.article.trim().toLowerCase();
    const name = part.name.trim().toLowerCase();

    let index = article ? parsed.findIndex((row, i) => !used.has(i) && row.article.trim().toLowerCase() === article) : -1;
    if (index === -1 && name.length >= 4) {
      index = parsed.findIndex(
        (row, i) =>
          !used.has(i) &&
          (row.name.toLowerCase().includes(name) || name.includes(row.name.toLowerCase()) ||
            (row.name.length >= 4 && name.includes(row.name.toLowerCase().split(' ')[0]))),
      );
    }
    if (index === -1) return part;

    used.add(index);
    matched += 1;
    const row = parsed[index];
    return {
      ...part,
      unitPrice: row.price,
      quantity: row.quantity > 1 ? row.quantity : part.quantity,
      article: part.article || row.article,
      priceSource: 'history' as const,
      note: `из списка цен: ${row.source}`,
    };
  });

  const leftovers = parsed.filter((_, index) => !used.has(index));
  return { parts: next, matched, unmatched: parts.length - matched, leftovers };
}
