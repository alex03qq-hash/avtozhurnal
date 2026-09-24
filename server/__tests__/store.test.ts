/**
 * Тесты хранилища на JSON-файле: сохранность, откат при сбое, устойчивость
 * к повреждённому файлу и к параллельным записям.
 *
 * Каждый тест работает в своём временном каталоге и намеренно не удаляет его —
 * так тест не зависит от прав на удаление и не может задеть данные пользователя.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import type { Vehicle } from '../../shared/types.ts';

async function freshDir(label: string): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), `avtozhurnal-store-${label}-`));
}

function makeVehicle(id: string, name: string): Vehicle {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    name,
    make: 'Lada',
    model: 'Vesta',
    year: 2020,
    plateNumber: '',
    vin: '',
    fuelType: 'petrol',
    tankCapacity: 55,
    initialOdometer: 1000,
    purchaseDate: null,
    isArchived: false,
    color: '#2F6F6B',
    notes: '',
  };
}

describe('хранилище на JSON-файле', () => {
  it('при первом запуске создаёт файл с пустыми коллекциями и чек-листом по умолчанию', async () => {
    const store = new Store(await freshDir('init'));
    await store.init();

    expect(fs.existsSync(store.filePath)).toBe(true);
    expect(store.get().vehicles).toEqual([]);
    expect(store.get().checklist.length).toBeGreaterThan(0);
    expect(store.get().settings.theme).toBe('system');
  });

  it('сохраняет изменения на диск — данные видит новый экземпляр хранилища', async () => {
    const dir = await freshDir('persist');
    const store = new Store(dir);
    await store.init();
    await store.mutate((db) => {
      db.vehicles.push(makeVehicle('v1', 'Первая'));
    });

    const reopened = new Store(dir);
    await reopened.init();
    expect(reopened.get().vehicles.map((v) => v.name)).toEqual(['Первая']);
  });

  it('откатывает состояние в памяти, если мутация завершилась ошибкой', async () => {
    const dir = await freshDir('rollback');
    const store = new Store(dir);
    await store.init();
    await store.mutate((db) => {
      db.vehicles.push(makeVehicle('v1', 'Первая'));
    });

    await expect(
      store.mutate((db) => {
        db.vehicles.push(makeVehicle('v2', 'Мусор'));
        throw new Error('валидация не прошла');
      }),
    ).rejects.toThrow('валидация не прошла');

    expect(store.get().vehicles.map((v) => v.id)).toEqual(['v1']);

    const reopened = new Store(dir);
    await reopened.init();
    expect(reopened.get().vehicles.map((v) => v.id)).toEqual(['v1']);
  });

  it('не теряет записи при параллельных мутациях', async () => {
    const dir = await freshDir('parallel');
    const store = new Store(dir);
    await store.init();

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.mutate((db) => {
          db.vehicles.push(makeVehicle(`v${index}`, `Машина ${index}`));
        }),
      ),
    );

    expect(store.get().vehicles).toHaveLength(25);
    const reopened = new Store(dir);
    await reopened.init();
    expect(reopened.get().vehicles).toHaveLength(25);
  });

  it('сохраняет повреждённый файл рядом и стартует с чистого состояния', async () => {
    const dir = await freshDir('broken');
    await fsp.writeFile(path.join(dir, 'db.json'), '{ это не JSON', 'utf8');
    const store = new Store(dir);
    await store.init();

    const broken = (await fsp.readdir(dir)).filter((name) => name.startsWith('db.json.broken-'));
    expect(broken).toHaveLength(1);
    expect(store.get().vehicles).toEqual([]);
  });

  it('заменяет не-массивы на пустые коллекции вместо падения', async () => {
    const dir = await freshDir('normalize');
    await fsp.writeFile(
      path.join(dir, 'db.json'),
      JSON.stringify({ schemaVersion: 1, vehicles: { broken: true }, fuel: 'нет', settings: 'мусор' }),
      'utf8',
    );
    const store = new Store(dir);
    await store.init();

    expect(store.get().vehicles).toEqual([]);
    expect(store.get().fuel).toEqual([]);
    expect(typeof store.get().settings.theme).toBe('string');
  });

  it('очищает «сиротские» временные файлы записи', async () => {
    const dir = await freshDir('orphan');
    await fsp.writeFile(path.join(dir, 'db.json.tmp-застрявший'), '{}', 'utf8');
    const store = new Store(dir);
    await store.init();

    const leftovers = (await fsp.readdir(dir)).filter((name) => name.startsWith('db.json.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('полная замена и очистка базы работают', async () => {
    const store = new Store(await freshDir('replace'));
    await store.init();
    await store.mutate((db) => {
      db.vehicles.push(makeVehicle('v1', 'Первая'));
    });

    await store.replace({ vehicles: [makeVehicle('v2', 'Вторая')] });
    expect(store.get().vehicles.map((v) => v.id)).toEqual(['v2']);

    await store.clear();
    expect(store.get().vehicles).toEqual([]);
    expect(store.get().checklist.length).toBeGreaterThan(0);
  });
});
