import { describe, expect, it } from 'vitest';
import { buildCalendar } from '../calendar.ts';

const stamp = '20260924T000000Z';

describe('выгрузка напоминаний в календарь', () => {
  it('собирает корректный файл календаря', () => {
    const ics = buildCalendar(
      [{ uid: 'rule-1@avtozhurnal', date: '2026-10-05', summary: 'АвтоЖурнал: Замена масла', description: 'Осталось 900 км', remindDaysBefore: 3 }],
      { name: 'АвтоЖурнал — напоминания', stamp },
    );

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005');
    expect(ics).toContain('DTEND;VALUE=DATE:20261006');
    expect(ics).toContain('TRIGGER:-P3D');
    expect(ics).toContain('X-WR-CALNAME:АвтоЖурнал — напоминания');
  });

  it('разделяет строки по правилам формата', () => {
    const ics = buildCalendar([{ uid: 'a', date: '2026-01-01', summary: 'Проверка', description: '' }], { name: 'Календарь', stamp });
    expect(ics.includes('\r\n')).toBe(true);
    expect(ics.split('\r\n').length).toBeGreaterThan(8);
  });

  it('экранирует запятые, точки с запятой и переносы строк', () => {
    const ics = buildCalendar(
      [{ uid: 'b', date: '2026-01-01', summary: 'Замена, масла; фильтра', description: 'Первая строка\nВторая строка' }],
      { name: 'Календарь', stamp },
    );
    expect(ics).toContain('SUMMARY:Замена\\, масла\\; фильтра');
    expect(ics).toContain('DESCRIPTION:Первая строка\\nВторая строка');
  });

  it('складывает длинные строки', () => {
    const long = 'Очень длинное описание '.repeat(12).trim();
    const ics = buildCalendar([{ uid: 'c', date: '2026-01-01', summary: 'Тест', description: long }], { name: 'К', stamp });
    for (const line of ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });

  it('не добавляет напоминание, если срок не задан', () => {
    const ics = buildCalendar([{ uid: 'd', date: '2026-01-01', summary: 'Без напоминания', description: '' }], { name: 'К', stamp });
    expect(ics).not.toContain('VALARM');
  });

  it('считает события', () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      uid: `rule-${index}`,
      date: '2026-02-01',
      summary: `Событие ${index}`,
      description: '',
    }));
    const ics = buildCalendar(events, { name: 'К', stamp });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5);
  });
});
