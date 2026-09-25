import { describe, expect, it } from 'vitest';
import {
  detectKind,
  isDocumentationSheet,
  mapColumns,
  matchCategory,
  matchVehicleId,
  normalizeHeader,
  parseDelimited,
  parseSheetTable,
} from '../tables.ts';

const VEHICLES = [
  { id: 'v-haval', name: 'Haval H7' },
  { id: 'v-bmw', name: 'BMW X3 30Li Long M Premium' },
];

describe('разбор таблиц: шапка', () => {
  it('узнаёт колонки по русским и английским названиям', () => {
    const { columns } = mapColumns(['Дата', 'Машина', 'Объём, л', 'Сумма, руб', 'АЗС']);
    expect(columns.date).toBe(0);
    expect(columns.vehicle).toBe(1);
    expect(columns.volume).toBe(2);
    expect(columns.amount).toBe(3);
    expect(columns.station).toBe(4);
  });

  it('понимает шапку из банковской выписки', () => {
    const { columns } = mapColumns(['Дата операции', 'Описание', 'Категория', 'Сумма операции']);
    expect(columns.date).toBe(0);
    expect(columns.description).toBe(1);
    expect(columns.category).toBe(2);
    expect(columns.amount).toBe(3);
  });

  it('не спотыкается на неразрывных пробелах и регистре', () => {
    expect(normalizeHeader('СУММА\u00a0операции')).toBe('сумма операции');
    const { columns } = mapColumns(['сумма\u00a0операции']);
    expect(columns.amount).toBe(0);
  });

  it('не считает ошибкой колонку-примечание рядом с описанием', () => {
    const { unknownHeaders } = mapColumns(['Дата', 'Машина', 'Категория', 'Описание', 'Сумма, руб', 'Комментарий']);
    expect(unknownHeaders).toEqual([]);
  });

  it('сообщает о непонятных колонках, а не молчит', () => {
    const { unknownHeaders } = mapColumns(['Дата', 'Сумма', 'Какой-то столбец']);
    expect(unknownHeaders).toEqual(['Какой-то столбец']);
  });

  it('определяет вид таблицы', () => {
    expect(detectKind(mapColumns(['Дата', 'Объём, л', 'Сумма']).columns)).toBe('fuel');
    expect(detectKind(mapColumns(['Дата', 'Описание', 'Сумма']).columns)).toBe('expenses');
    expect(detectKind(mapColumns(['Категория', 'Что относить']).columns)).toBe('empty');
    expect(detectKind(mapColumns(['Дата', 'Машина']).columns)).toBe('empty');
  });
});

describe('разбор таблиц: CSV', () => {
  it('сам выбирает разделитель', () => {
    expect(parseDelimited('Дата;Сумма\n05.09.2025;2601').rows[1]).toEqual(['05.09.2025', '2601']);
    expect(parseDelimited('Дата\tСумма\n05.09.2025\t2601').rows[1]).toEqual(['05.09.2025', '2601']);
    expect(parseDelimited('Дата,Сумма\n05.09.2025,2601').rows[1]).toEqual(['05.09.2025', '2601']);
  });

  it('понимает кавычки и разделитель внутри значения', () => {
    const table = parseDelimited('Дата;Описание;Сумма\n05.09.2025;"Мойка, комплекс";900');
    expect(table.rows[1]).toEqual(['05.09.2025', 'Мойка, комплекс', '900']);
  });

  it('убирает пустые строки и BOM', () => {
    const table = parseDelimited('\uFEFFДата;Сумма\n\n05.09.2025;2601\n');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toBe('Дата');
  });
});

describe('разбор таблиц: заправки', () => {
  const csv = [
    'Дата;Машина;Пробег, км;Объём, л;Сумма, руб;АЗС;Полный бак',
    '05.09.2025;Haval H7;12500;42,5;2 601,50;Газпромнефть;да',
    '18.09.2025;BMW X3;6500;55,1;3 340,50;Газпромнефть;нет',
    '02.10.2025;;;48;2950;Газпромнефть;',
  ].join('\n');

  it('переносит все заполненные строки в записи', () => {
    const parsed = parseSheetTable(parseDelimited(csv));
    expect(parsed.kind).toBe('fuel');
    expect(parsed.fuel).toHaveLength(3);
    expect(parsed.skipped).toHaveLength(0);
    expect(parsed.fuel[0]).toMatchObject({ date: '2025-09-05', volume: 42.5, totalCost: 2601.5, station: 'Газпромнефть', odometer: 12500, vehicleName: 'Haval H7', fullTank: true });
    expect(parsed.fuel[2]).toMatchObject({ date: '2025-10-02', volume: 48, totalCost: 2950, vehicleName: null, fullTank: false });
  });

  it('видит, что машина указана в файле', () => {
    expect(parseSheetTable(parseDelimited(csv)).hasVehicleColumn).toBe(true);
  });

  it('не теряет строку без суммы и объёма, а показывает её владельцу', () => {
    const parsed = parseSheetTable(parseDelimited('Дата;Объём, л;Сумма\n05.09.2025;;\n06.09.2025;40;2600'));
    expect(parsed.fuel).toHaveLength(1);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0].raw).toContain('05.09.2025');
  });
});

describe('разбор таблиц: расходы', () => {
  const csv = [
    'Дата;Машина;Категория;Описание;Сумма, руб',
    '15.10.2025;Haval H7;Страховка;ОСАГО;12 800',
    '20.10.2025;BMW X3;Шины;Комплект зимних колёс с дисками;96 000',
    '01.11.2025;;;Оклейка защитной плёнкой;89 000',
  ].join('\n');

  it('понимает категорию словом и по описанию', () => {
    const parsed = parseSheetTable(parseDelimited(csv));
    expect(parsed.kind).toBe('expenses');
    expect(parsed.expenses).toHaveLength(3);
    expect(parsed.expenses[0].category).toBe('insurance');
    expect(parsed.expenses[1].category).toBe('tires');
    expect(parsed.expenses[2].category).toBe('other');
  });

  it('распознаёт колёса, диски и резину как шины', () => {
    expect(matchCategory('Колёса')).toBe('tires');
    expect(matchCategory('Резина зимняя')).toBe('tires');
    expect(matchCategory('Диски литые')).toBe('tires');
    expect(matchCategory('tires')).toBe('tires');
  });

  it('сохраняет сумму и описание без изменений', () => {
    const parsed = parseSheetTable(parseDelimited(csv));
    expect(parsed.expenses[1]).toMatchObject({ date: '2025-10-20', amount: 96000, description: 'Комплект зимних колёс с дисками', vehicleName: 'BMW X3' });
  });
});

describe('разбор таблиц: машины', () => {
  it('сопоставляет название из файла с журналом', () => {
    expect(matchVehicleId('Haval H7', VEHICLES)).toBe('v-haval');
    expect(matchVehicleId('haval h7', VEHICLES)).toBe('v-haval');
    expect(matchVehicleId('Haval', VEHICLES)).toBe('v-haval');
    expect(matchVehicleId('BMW X3 30Li Long M Premium', VEHICLES)).toBe('v-bmw');
  });

  it('не угадывает при неоднозначности', () => {
    const ambiguous = [
      { id: 'a', name: 'Haval H7' },
      { id: 'b', name: 'Haval H9' },
    ];
    expect(matchVehicleId('Haval', ambiguous)).toBeNull();
    expect(matchVehicleId('Лада', VEHICLES)).toBeNull();
    expect(matchVehicleId(null, VEHICLES)).toBeNull();
  });
});

describe('разбор таблиц: листы-пояснения', () => {
  it('пропускает служебные листы шаблона', () => {
    expect(isDocumentationSheet('Как заполнять')).toBe(true);
    expect(isDocumentationSheet('Категории')).toBe(true);
    expect(isDocumentationSheet('Заправки')).toBe(false);
  });

  it('не считает данными лист без колонки суммы', () => {
    const sheet = { name: 'Категории', rows: [['Категория', 'Что относить'], ['Шины', 'колёса, диски']] };
    expect(parseSheetTable(sheet).kind).toBe('empty');
  });
});
