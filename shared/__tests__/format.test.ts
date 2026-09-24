import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatConsumption,
  formatDate,
  formatDays,
  formatMoney,
  formatMoneyShort,
  formatMonthKey,
  formatMonthKeyFull,
  formatNumber,
  formatOdometer,
  monthKey,
  plural,
  todayISO,
} from '../format';

describe('форматирование денег и чисел', () => {
  it('деньги — с копейками и неразрывным пробелом', () => {
    expect(formatMoney(1234.56)).toBe('1\u00A0234,56\u00A0₽');
    expect(formatMoney(3000)).toBe('3\u00A0000\u00A0₽');
    expect(formatMoney(-500)).toBe('−500\u00A0₽');
    expect(formatMoney(null)).toBe('—');
  });

  it('короткий формат для крупных сумм', () => {
    expect(formatMoneyShort(15132)).toBe('15\u00A0тыс.\u00A0₽');
    expect(formatMoneyShort(2_500_000)).toBe('2,50\u00A0млн\u00A0₽');
    expect(formatMoneyShort(990)).toBe('990\u00A0₽');
  });

  it('числа — с запятой и нужным количеством знаков', () => {
    expect(formatNumber(8.556, 1)).toBe('8,6');
    expect(formatNumber(8.556, 2)).toBe('8,56');
    expect(formatNumber(undefined)).toBe('—');
  });

  it('расход и пробег', () => {
    expect(formatConsumption(8.56)).toBe('8,6\u00A0л/100 км');
    expect(formatOdometer(128400)).toBe('128\u00A0400\u00A0км');
  });
});

describe('форматирование дат', () => {
  it('дата в русском формате', () => {
    expect(formatDate('2026-09-24')).toBe('24.09.2026');
    expect(formatDate(null)).toBe('—');
  });

  it('месяцы', () => {
    expect(formatMonthKey('2026-09')).toBe('сен 2026');
    expect(formatMonthKeyFull('2026-09')).toBe('сентябрь 2026');
    expect(monthKey('2026-09-24')).toBe('2026-09');
  });

  it('арифметика дат', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetween('2026-03-01', '2026-06-01')).toBe(92);
    expect(todayISO(new Date('2026-09-24T18:30:00Z'))).toBe('2026-09-24');
  });
});

describe('склонения', () => {
  it('дни', () => {
    expect(formatDays(1)).toBe('1 день');
    expect(formatDays(3)).toBe('3 дня');
    expect(formatDays(12)).toBe('12 дней');
    expect(formatDays(22)).toBe('22 дня');
  });

  it('произвольные формы', () => {
    expect(plural(1, 'запись', 'записи', 'записей')).toBe('запись');
    expect(plural(5, 'запись', 'записи', 'записей')).toBe('записей');
  });
});
