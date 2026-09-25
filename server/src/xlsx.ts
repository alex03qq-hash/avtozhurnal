/**
 * Чтение и создание файлов Excel.
 *
 * Файлы разбираются на этом же компьютере: наружу ничего не уходит. Шаблон создаётся кодом,
 * поэтому в репозитории нет двоичных заготовок, которые невозможно проверить глазами.
 */

import * as XLSX from 'xlsx';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from '../../shared/constants.ts';
import type { SheetTable } from '../../shared/tables.ts';

/** Читает все листы книги. Даты отдаются как Date, числа — как числа. */
export function readWorkbook(data: Buffer): SheetTable[] {
  const workbook = XLSX.read(data, { type: 'buffer', cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | Date | null>>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    // Лист с одной шапкой не выбрасываем: владелец должен видеть, что он пуст, а не гадать.
    return { name, rows: rows.map((row) => row.map((cell) => (cell === undefined ? null : cell))) };
  });
}

const FUEL_HEADERS = ['Дата', 'Машина', 'Пробег, км', 'Объём, л', 'Сумма, руб', 'АЗС', 'Полный бак', 'Комментарий'];
const EXPENSE_HEADERS = ['Дата', 'Машина', 'Категория', 'Описание', 'Сумма, руб', 'Комментарий'];

export interface TemplateOptions {
  /** Машины владельца: подставляем их в примеры, чтобы шапка была понятной. */
  vehicles?: string[];
  /** Примеры строк — владелец заменяет их своими. */
  examples?: boolean;
}

/** Шаблон для заполнения: листы «Заправки», «Расходы», «Как заполнять», «Категории». */
export function buildTemplate(options: TemplateOptions = {}): Buffer {
  const vehicles = (options.vehicles ?? []).filter(Boolean);
  const carA = vehicles[0] ?? 'Машина 1';
  const carB = vehicles[1] ?? carA;
  const withExamples = options.examples !== false;
  const year = new Date().getFullYear();

  const fuelRows: Array<Array<string | number>> = [FUEL_HEADERS];
  if (withExamples) {
    fuelRows.push([`01.09.${year}`, carA, 12500, 42.5, 2601.5, 'Газпромнефть', 'да', 'пример — удалите эту строку']);
    fuelRows.push([`15.09.${year}`, carB, 6500, 51.2, 3150, 'Газпромнефть', 'нет', 'пример — удалите эту строку']);
  }

  const expenseRows: Array<Array<string | number>> = [EXPENSE_HEADERS];
  if (withExamples) {
    expenseRows.push([`15.10.${year}`, carA, 'Страховка', 'ОСАГО', 12800, 'пример — удалите эту строку']);
    expenseRows.push([`20.10.${year}`, carB, 'Шины', 'Комплект зимних колёс с дисками', 96000, 'пример — удалите эту строку']);
    expenseRows.push([`01.11.${year}`, carA, 'Прочее', 'Оклейка защитной плёнкой', 89000, '']);
    expenseRows.push([`20.11.${year}`, carA, 'Прочее', 'Антикор днища', 34500, '']);
  }

  const instructions: Array<[string]> = [
    ['Как заполнять шаблон'],
    [''],
    ['1. Заполните лист «Заправки»: по строке на каждую заправку. Обязательны дата и объём или сумма.'],
    ['2. Заполните лист «Расходы»: по строке на каждый платёж. Обязательны дата и сумма.'],
    ['3. Колонку «Машина» указывайте, если расход относится к конкретной машине.'],
    ['   Без неё приложение раскидает заправки между машинами по пробегу.'],
    ['4. Колонка «Пробег, км» тоже не обязательна: если её не заполнять, приложение расставит'],
    ['   пробег по датам между покупкой и текущим пробегом и отметит это в заметках.'],
    ['5. Категорию расхода пишите словами («Страховка», «Шины», «ТО») — приложение поймёт;'],
    ['   полный список — на листе «Категории».'],
    ['6. Примеры строк удалите перед загрузкой — они попадут в журнал как настоящие данные.'],
    [''],
    ['Готовые файлы: загрузите .xlsx, .csv или .txt в приложении, раздел «Импорт».'],
    ['Повторная загрузка того же файла безопасна: одинаковые записи не задваиваются.'],
    [''],
    ['Ваши машины:'],
    ...(vehicles.length ? vehicles.map((name) => [`   • ${name}`] as [string]) : [['   (добавьте машины в приложении)'] as [string]]),
  ];

  const categories: Array<[string, string]> = [
    ['Категория', 'Что относить'],
    ...EXPENSE_CATEGORY_ORDER.map((category) => [EXPENSE_CATEGORY_LABELS[category], categoryHints(category)] as [string, string]),
  ];

  const workbook = XLSX.utils.book_new();
  const fuelSheet = XLSX.utils.aoa_to_sheet(fuelRows as Array<Array<string | number>>);
  const expenseSheet = XLSX.utils.aoa_to_sheet(expenseRows as Array<Array<string | number>>);
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
  const categorySheet = XLSX.utils.aoa_to_sheet(categories);

  fuelSheet['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 11 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 26 }];
  expenseSheet['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 44 }, { wch: 12 }, { wch: 26 }];
  instructionSheet['!cols'] = [{ wch: 100 }];
  categorySheet['!cols'] = [{ wch: 20 }, { wch: 70 }];

  XLSX.utils.book_append_sheet(workbook, fuelSheet, 'Заправки');
  XLSX.utils.book_append_sheet(workbook, expenseSheet, 'Расходы');
  XLSX.utils.book_append_sheet(workbook, categorySheet, 'Категории');
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Как заполнять');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function categoryHints(category: string): string {
  const hints: Record<string, string> = {
    maintenance: 'плановое ТО, замена масла и фильтров, диагностика',
    repair: 'ремонт, кузовные работы, покраска, стекло',
    parts: 'запчасти, масло, фильтры, колодки, свечи',
    tires: 'шины, колёса, диски, резина, шиномонтаж',
    insurance: 'ОСАГО, КАСКО, полис',
    tax: 'транспортный налог',
    fine: 'штрафы',
    wash: 'мойка, химчистка, детейлинг',
    parking: 'парковка, стоянка, платная дорога',
    other: 'оклейка плёнкой, антикор, аксессуары, всё остальное',
  };
  return hints[category] ?? '';
}
