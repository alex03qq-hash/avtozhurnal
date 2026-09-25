import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildTemplate, readWorkbook } from '../src/xlsx.ts';
import { parseSheetTable } from '../../shared/tables.ts';

const VEHICLES = ['Haval H7', 'BMW X3 30Li Long M Premium'];

describe('шаблон для Excel', () => {
  const workbook = readWorkbook(buildTemplate({ vehicles: VEHICLES }));

  it('содержит листы «Заправки» и «Расходы» и пояснения', () => {
    const names = workbook.map((sheet) => sheet.name);
    expect(names).toContain('Заправки');
    expect(names).toContain('Расходы');
    expect(names).toContain('Как заполнять');
    expect(names).toContain('Категории');
  });

  it('примеры заполнены машинами владельца', () => {
    const fuel = workbook.find((sheet) => sheet.name === 'Заправки')!;
    expect(String(fuel.rows[0][1])).toBe('Машина');
    expect(String(fuel.rows[1][1])).toBe('Haval H7');
    expect(String(fuel.rows[2][1])).toBe('BMW X3 30Li Long M Premium');
  });

  it('примеры читаются как настоящие записи — иначе шаблон бесполезен', () => {
    const fuel = parseSheetTable(workbook.find((sheet) => sheet.name === 'Заправки')!);
    expect(fuel.kind).toBe('fuel');
    expect(fuel.fuel).toHaveLength(2);
    expect(fuel.fuel[0].vehicleName).toBe('Haval H7');
    expect(fuel.fuel[0].volume).toBe(42.5);

    const expenses = parseSheetTable(workbook.find((sheet) => sheet.name === 'Расходы')!);
    expect(expenses.kind).toBe('expenses');
    expect(expenses.expenses).toHaveLength(4);
    expect(expenses.expenses.map((row) => row.category)).toContain('tires');
  });

  it('листы-пояснения не попадают в данные', () => {
    for (const name of ['Как заполнять', 'Категории']) {
      const sheet = workbook.find((row) => row.name === name)!;
      expect(parseSheetTable(sheet).kind).toBe('empty');
    }
  });

  it('пустой шаблон (без примеров) не содержит строк данных', () => {
    const empty = readWorkbook(buildTemplate({ vehicles: VEHICLES, examples: false }));
    for (const name of ['Заправки', 'Расходы']) {
      const sheet = empty.find((row) => row.name === name)!;
      expect(parseSheetTable(sheet).fuel).toHaveLength(0);
      expect(parseSheetTable(sheet).expenses).toHaveLength(0);
    }
  });
});

describe('чтение книги Excel', () => {
  it('читает даты как даты, а не как числа', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Дата', 'Сумма'], [new Date(2025, 8, 5), 2601.5]]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Лист1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const sheets = readWorkbook(buffer);
    expect(sheets).toHaveLength(1);
    const parsed = parseSheetTable(sheets[0]);
    expect(parsed.expenses[0].date).toBe('2025-09-05');
    expect(parsed.expenses[0].amount).toBe(2601.5);
  });

  it('понимает текст «12 800 ₽» в колонке суммы', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Дата', 'Описание', 'Сумма'], ['15.10.2025', 'ОСАГО', '12 800 ₽']]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Расходы');
    const sheets = readWorkbook(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const parsed = parseSheetTable(sheets[0]);
    expect(parsed.expenses[0].amount).toBe(12800);
  });
});
