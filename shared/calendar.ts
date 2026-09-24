/**
 * Выгрузка напоминаний о ТО в календарь.
 *
 * Формат iCalendar (RFC 5545) понимают все календари на телефонах: добавив файл один раз,
 * владелец получает обычные системные напоминания — без push-сервисов и внешних серверов.
 *
 * Особенности формата, которые здесь соблюдаются:
 *   • строки разделяются CRLF, а не «\n»;
 *   • запятые, точки с запятой и обратные слэши внутри текста экранируются;
 *   • длинные строки складываются по 75 байт;
 *   • для событий «на весь день» используется DATE без времени, поэтому часовой пояс не нужен.
 */

export interface CalendarEvent {
  uid: string;
  /** Дата начала в формате YYYY-MM-DD. */
  date: string;
  summary: string;
  description: string;
  /** За сколько дней напомнить (VALARM). */
  remindDaysBefore?: number;
}

const CRLF = '\r\n';

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Складывает длинные строки так, как требует RFC 5545. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let current = Buffer.alloc(0);
  for (const char of line) {
    const charBytes = Buffer.from(char, 'utf8');
    if (current.length + charBytes.length > 73) {
      parts.push(current.toString('utf8'));
      current = Buffer.alloc(0);
    }
    current = Buffer.concat([current, charBytes]);
  }
  if (current.length) parts.push(current.toString('utf8'));
  return parts.join(`${CRLF} `);
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function nextDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function buildCalendar(events: CalendarEvent[], options: { name: string; stamp: string }): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//АвтоЖурнал//Напоминания о ТО//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${options.stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay(event.date))}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push('TRANSP:TRANSPARENT');
    if (event.remindDaysBefore && event.remindDaysBefore > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeText(event.summary)}`);
      lines.push(`TRIGGER:-P${Math.round(event.remindDaysBefore)}D`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
