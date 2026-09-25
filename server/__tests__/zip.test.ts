/** Тесты упаковщика ZIP: структура архива и контрольная сумма. */

import { describe, expect, it } from 'vitest';
import { createZip } from '../src/zip.ts';

describe('упаковка ZIP', () => {
  it('формирует корректную подпись и хвост архива', () => {
    const zip = createZip([{ name: 'hello.txt', data: Buffer.from('hello', 'utf8') }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // начало записи
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50); // конец центрального каталога
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(1); // число записей
    expect(zip.includes(Buffer.from('hello.txt'))).toBe(true);
  });

  it('считает контрольную сумму CRC32 по стандарту', () => {
    // CRC32 для строки «hello» — известное значение 0x3610A686
    const zip = createZip([{ name: 'hello.txt', data: Buffer.from('hello', 'utf8') }]);
    expect(zip.readUInt32LE(14)).toBe(0x3610a686);
  });

  it('умеет упаковать несколько файлов', () => {
    const zip = createZip([
      { name: 'data/db.json', data: Buffer.from('{"ok":true}', 'utf8') },
      { name: 'КАК-ВОССТАНОВИТЬ.txt', data: Buffer.from('инструкция', 'utf8') },
    ]);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
    expect(zip.includes(Buffer.from('КАК-ВОССТАНОВИТЬ.txt'))).toBe(true);
  });

  it('поддерживает пустой архив', () => {
    const zip = createZip([]);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(0);
  });
});
