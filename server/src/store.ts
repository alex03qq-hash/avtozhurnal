/**
 * Хранилище «АвтоЖурнала».
 *
 * Вся база лежит в одном JSON-файле. Запись атомарная (временный файл + rename)
 * и сериализованная очередью, поэтому одновременные запросы не теряют данные,
 * а падение процесса посреди записи не может испортить файл.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ChecklistItem,
  CollectionName,
  Database,
  Expense,
  FuelEntry,
  Income,
  Part,
  ServiceRule,
  Settings,
  Trip,
  Vehicle,
} from '../../shared/types.ts';
import { DEFAULT_CHECKLIST, DEFAULT_SETTINGS, SCHEMA_VERSION } from '../../shared/constants.ts';

function emptyDatabase(): Database {
  const now = new Date().toISOString();
  const settings: Settings = { ...DEFAULT_SETTINGS, id: randomUUID(), createdAt: now, updatedAt: now };
  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    vehicles: [],
    fuel: [],
    expenses: [],
    incomes: [],
    trips: [],
    parts: [],
    rules: [],
    checklist: DEFAULT_CHECKLIST.map((item) => ({
      id: randomUUID(),
      vehicleId: null,
      label: item.label,
      isChecked: false,
      order: item.order,
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

export type Collection = CollectionName;

/**
 * Гарантирует, что из файла пришёл именно массив.
 * Файл могут отредактировать руками, и тогда объект вместо массива ломал бы весь сервер.
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export class Store {
  private db: Database = emptyDatabase();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir);
    this.file = path.join(this.dir, 'db.json');
  }

  get filePath(): string {
    return this.file;
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    await this.removeOrphanTempFiles();
    if (!fs.existsSync(this.file)) {
      await this.persist();
      return;
    }
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Database>;
      this.db = this.normalize(parsed);
    } catch (error) {
      const backup = `${this.file}.broken-${Date.now()}`;
      await fsp.rename(this.file, backup).catch(() => undefined);
      console.error(`[store] Файл базы повреждён, сохранён как ${backup}. Создана пустая база.`);
      this.db = emptyDatabase();
      await this.persist();
    }
  }

  /**
   * Убирает «сиротские» временные файлы, оставшиеся после аварийного завершения
   * посреди записи. Данные в них всегда неполные, поэтому они не нужны.
   */
  private async removeOrphanTempFiles(): Promise<void> {
    try {
      const entries = await fsp.readdir(this.dir);
      for (const name of entries) {
        if (name.startsWith('db.json.tmp-')) {
          await fsp.unlink(path.join(this.dir, name)).catch(() => undefined);
        }
      }
    } catch {
      /* каталог может быть недоступен на чтение — это не повод падать */
    }
  }

  /** Приводит загруженный файл к актуальной схеме, не теряя данные. */
  private normalize(parsed: Partial<Database>): Database {
    const fresh = emptyDatabase();
    const now = new Date().toISOString();
    const settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : undefined;
    const checklist = asArray<ChecklistItem>(parsed.checklist);
    return {
      schemaVersion: SCHEMA_VERSION,
      settings: { ...fresh.settings, ...(settings ?? {}), id: settings?.id ?? fresh.settings.id, updatedAt: now },
      vehicles: asArray<Vehicle>(parsed.vehicles),
      fuel: asArray<FuelEntry>(parsed.fuel),
      expenses: asArray<Expense>(parsed.expenses),
      incomes: asArray<Income>(parsed.incomes),
      trips: asArray<Trip>(parsed.trips),
      parts: asArray<Part>(parsed.parts),
      rules: asArray<ServiceRule>(parsed.rules),
      checklist: checklist.length ? checklist : fresh.checklist,
    };
  }

  /** Текущее состояние базы (только чтение — не мутируйте напрямую). */
  get(): Database {
    return this.db;
  }

  /**
   * Мутация базы: изменение применяется в памяти, затем файл перезаписывается атомарно.
   * Вызовы выстраиваются в очередь, поэтому конкурентные запросы безопасны.
   */
  async mutate<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      // Снимок состояния до мутации: если запись на диск не удастся, память вернётся
      // к нему, и данные в памяти не разойдутся с данными в файле.
      const snapshot = structuredClone(this.db) as Database;
      try {
        const result = await fn(this.db);
        await this.persist();
        return result;
      } catch (error) {
        this.db = snapshot;
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    const tmp = `${this.file}.tmp-${randomUUID()}`;
    const payload = `${JSON.stringify(this.db, null, 2)}\n`;
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, this.file);
  }

  /** Полная замена базы (используется при восстановлении из бэкапа). */
  async replace(data: Partial<Database>): Promise<void> {
    await this.mutate((db) => {
      const next = this.normalize(data);
      Object.assign(db, next);
    });
  }

  /** Очистка всех данных пользователя. */
  async clear(): Promise<void> {
    await this.mutate((db) => {
      const fresh = emptyDatabase();
      Object.assign(db, fresh);
    });
  }
}
