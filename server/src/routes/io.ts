/**
 * Служебные маршруты: настройки, экспорт CSV/JSON, восстановление из бэкапа,
 * демонстрационные данные. Секретов здесь нет — приложение полностью локальное.
 */

import { Router } from 'express';
import qrcode from 'qrcode-generator';
import { buildServerInfo } from '../network.ts';
import type { CollectionName, Database, Settings, ThemeName, UnitSystem } from '../../../shared/types.ts';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildDemoData } from '../demo.ts';
import { createZip, type ZipEntry } from '../zip.ts';
import { expensesCsv, fuelCsv, incomesCsv } from '../csv.ts';
import { newId, sanitize, ValidationError } from '../validate.ts';
import type { Store } from '../store.ts';
import { ah } from './async-handler.ts';

const THEMES: readonly ThemeName[] = ['light', 'dark', 'system'];
const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];

export function createIoRouter(
  store: Store,
  server: { port: number; host: string } = { port: 4000, host: '0.0.0.0' },
  files: { photosDir?: string; regulationsDir?: string } = {},
): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const db = store.get();
    res.json({
      ok: true,
      schemaVersion: db.schemaVersion,
      vehicles: db.vehicles.length,
      fuelEntries: db.fuel.length,
      expenses: db.expenses.length,
      incomes: db.incomes.length,
      trips: db.trips.length,
      parts: db.parts.length,
      rules: db.rules.length,
      dataFile: store.filePath,
      time: new Date().toISOString(),
    });
  });

  /** Адреса, по которым приложение доступно с телефона, и признак установки как приложения. */
  router.get('/network', (req, res) => {
    const protocol = (req.headers['x-forwarded-proto'] as string) === 'https' || req.protocol === 'https' ? 'https' : 'http';
    const info = buildServerInfo(server.port, server.host, protocol);
    res.json({ ...info, installable: true, authEnabled: Boolean(process.env.ACCESS_TOKEN?.trim()) });
  });

  /** QR-код со ссылкой на приложение: телефон наводит камеру и открывает журнал. */
  router.get('/network/qr.svg', (req, res) => {
    const info = buildServerInfo(server.port, server.host, req.protocol === 'https' ? 'https' : 'http');
    const target = typeof req.query.url === 'string' && req.query.url ? req.query.url : info.lanUrls[0] ?? info.localUrl;
    const qr = qrcode(0, 'M');
    qr.addData(target);
    qr.make();
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    res.send(qr.createSvgTag({ cellSize: 6, margin: 14, scalable: true }));
  });

  /** Состояние данных: была ли аварийная ситуация, какие есть ежедневные копии. */
  router.get('/diagnostics', ah(async (_req, res) => {
    const state = await store.describeState();
    res.json({ ...state, accessProtected: Boolean(process.env.ACCESS_TOKEN?.trim()), dataFile: store.filePath });
  }));

  router.get('/settings', (_req, res) => res.json(store.get().settings));

  router.patch('/settings', ah(async (req, res) => {
    const body = (req.body ?? {}) as Partial<Settings>;
    const patch: Partial<Settings> = {};
    if (body.theme !== undefined) {
      if (!THEMES.includes(body.theme)) throw new ValidationError('Недопустимая тема оформления.');
      patch.theme = body.theme;
    }
    if (body.unitSystem !== undefined) {
      if (!UNIT_SYSTEMS.includes(body.unitSystem)) throw new ValidationError('Недопустимая система единиц.');
      patch.unitSystem = body.unitSystem;
    }
    if (body.currency !== undefined) patch.currency = String(body.currency).slice(0, 8) || 'RUB';
    if (body.activeVehicleId !== undefined) {
      const id = body.activeVehicleId;
      if (id !== null && !store.get().vehicles.some((v) => v.id === id)) throw new ValidationError('Автомобиль не найден.');
      patch.activeVehicleId = id;
    }

    await store.mutate((db) => {
      db.settings = { ...db.settings, ...patch, updatedAt: new Date().toISOString() };
    });
    res.json(store.get().settings);
  }));

  /** Экспорт CSV. type: fuel | expenses | incomes | all */
  router.get('/export/csv', (req, res) => {
    const db = store.get();
    const vehicleId = typeof req.query.vehicleId === 'string' && req.query.vehicleId ? req.query.vehicleId : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : 'all';
    const match = (row: { vehicleId: string }) => !vehicleId || row.vehicleId === vehicleId;

    let csv = '';
    let filename = 'avtozhurnal';
    if (type === 'fuel') {
      csv = fuelCsv(db.fuel.filter(match), db.vehicles);
      filename += '-zapravki';
    } else if (type === 'expenses') {
      csv = expensesCsv(db.expenses.filter(match), db.vehicles);
      filename += '-rashody';
    } else if (type === 'incomes') {
      csv = incomesCsv(db.incomes.filter(match), db.vehicles);
      filename += '-dohody';
    } else {
      // «Всё» — три таблицы в одном файле, разделённые пустыми строками.
      csv = [
        'ЗАПРАВКИ',
        fuelCsv(db.fuel.filter(match), db.vehicles).replace(/^\uFEFF/, ''),
        '',
        'РАСХОДЫ',
        expensesCsv(db.expenses.filter(match), db.vehicles).replace(/^\uFEFF/, ''),
        '',
        'ДОХОДЫ',
        incomesCsv(db.incomes.filter(match), db.vehicles).replace(/^\uFEFF/, ''),
      ].join('\r\n');
      csv = `\uFEFF${csv}`;
      filename += '-vse';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  /** Ежедневные копии базы: видны пользователю, чтобы было понятно, что защита работает. */
  router.get('/backups', ah(async (_req, res) => {
    const copies = await store.listBackups();
    res.json({ count: copies.length, copies, directory: path.dirname(store.filePath), keepDays: 14 });
  }));

  /**
   * Полный архив: данные, фотографии чеков и пакеты регламентов одним ZIP-файлом.
   * Обычный JSON-бэкап остаётся основным (данные важнее снимков), архив — для полного переезда.
   */
  router.get('/export/archive', ah(async (_req, res) => {
    const db = store.get();
    const entries: ZipEntry[] = [];

    entries.push({
      name: 'КАК-ВОССТАНОВИТЬ.txt',
      data: Buffer.from(
        [
          'Полный архив АвтоЖурнала',
          '',
          'Что внутри:',
          '  data/db.json                     — все записи журнала (авто, заправки, расходы, доходы, поездки, запчасти, регламенты)',
          '  data/photos/                     — фотографии чеков',
          '  data/regulations/packs/          — пакеты регламентов ТО',
          '',
          'Как восстановить:',
          '  1. Распакуйте архив в папку приложения (туда, где лежат package.json и server/).',
          '  2. Запустите приложение: npm install && npm run build && npm start',
          '  3. Откройте http://localhost:4000 — данные будут на месте.',
          '',
          'Данные первичны: их можно восстановить и без фотографий — через «Настройки → Восстановление из JSON».',
          '',
        ].join('\n'),
        'utf8',
      ),
    });

    entries.push({ name: 'data/db.json', data: Buffer.from(`${JSON.stringify(db, null, 2)}\n`, 'utf8') });

    const collect = async (dir: string | undefined, prefix: string) => {
      if (!dir || !fs.existsSync(dir)) return;
      const names = await fsp.readdir(dir);
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const file = path.join(dir, name);
        const stat = await fsp.stat(file);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
        entries.push({ name: `${prefix}${name}`, data: await fsp.readFile(file) });
      }
    };

    await collect(files.photosDir, 'data/photos/');
    await collect(files.regulationsDir, 'data/regulations/packs/');

    const zip = createZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="avtozhurnal-archive-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(zip);
  }));

  /** Полный бэкап базы в JSON. */
  router.get('/export/json', (req, res) => {
    const db = store.get();
    const vehicleId = typeof req.query.vehicleId === 'string' && req.query.vehicleId ? req.query.vehicleId : undefined;
    const payload: Database = vehicleId
      ? {
          ...db,
          vehicles: db.vehicles.filter((v) => v.id === vehicleId),
          fuel: db.fuel.filter((f) => f.vehicleId === vehicleId),
          expenses: db.expenses.filter((e) => e.vehicleId === vehicleId),
          incomes: db.incomes.filter((i) => i.vehicleId === vehicleId),
          trips: db.trips.filter((t) => t.vehicleId === vehicleId),
          parts: db.parts.filter((p) => p.vehicleId === vehicleId),
          rules: db.rules.filter((r) => r.vehicleId === vehicleId),
          checklist: db.checklist.filter((c) => c.vehicleId === vehicleId || c.vehicleId === null),
        }
      : db;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="avtozhurnal-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify({ ...payload, exportedAt: new Date().toISOString() }, null, 2));
  });

  /** Восстановление из бэкапа: mode = replace | merge. */
  router.post('/import/json', ah(async (req, res) => {
    const body = (req.body ?? {}) as { mode?: string; data?: Partial<Database> };
    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    const data = body.data;
    if (!data || typeof data !== 'object') throw new ValidationError('В файле не найдены данные для восстановления.');

    const collections: Array<keyof Database> = ['vehicles', 'fuel', 'expenses', 'incomes', 'trips', 'parts', 'rules', 'checklist'];
    const found = collections.filter((key) => Array.isArray(data[key]) && (data[key] as unknown[]).length > 0);
    if (!found.length) throw new ValidationError('В файле нет ни одной записи: проверьте, что это бэкап «АвтоЖурнала».');

    const added: Record<string, number> = {};
    let skipped = 0;
    // Замена всей базы — необратимое действие: спасательная копия делается до записи
    const rescue = mode === 'replace' ? await store.snapshot('before-import') : null;

    await store.mutate((db) => {
      if (mode === 'replace') {
        const fresh = buildEmptyLike(db);
        Object.assign(db, fresh);
      }
      for (const key of collections) {
        const incoming = (data[key] as unknown[] | undefined) ?? [];
        const target = db[key] as unknown as Array<Record<string, unknown>>;
        let count = 0;
        for (const row of incoming) {
          // Файл бэкапа — внешние данные: каждую строку прогоняем через ту же валидацию,
          // что и обычный запрос. Битые строки пропускаем и считаем.
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            skipped += 1;
            continue;
          }
          const source = row as Record<string, unknown>;
          if (mode === 'merge' && source.id && target.some((t) => t.id === source.id)) continue;

          let clean: Record<string, unknown>;
          try {
            clean = sanitize<Record<string, unknown>>(key as CollectionName, source);
          } catch {
            skipped += 1;
            continue;
          }

          const now = new Date().toISOString();
          target.push({
            ...clean,
            id: typeof source.id === 'string' && source.id ? source.id : newId(),
            createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
            updatedAt: now,
          });
          count += 1;
        }
        if (count) added[key] = count;
      }

      if (data.settings && typeof data.settings === 'object') {
        const incoming = data.settings as Partial<Settings>;
        const patch: Partial<Settings> = {};
        if (incoming.theme && THEMES.includes(incoming.theme)) patch.theme = incoming.theme;
        if (incoming.unitSystem && UNIT_SYSTEMS.includes(incoming.unitSystem)) patch.unitSystem = incoming.unitSystem;
        if (typeof incoming.currency === 'string' && incoming.currency) patch.currency = incoming.currency.slice(0, 8);
        db.settings = { ...db.settings, ...patch, id: db.settings.id };
      }
      if (!db.vehicles.some((v) => v.id === db.settings.activeVehicleId)) {
        db.settings.activeVehicleId = db.vehicles[0]?.id ?? null;
      }
    });

    res.json({
      ok: true,
      mode,
      added,
      skipped,
      rescue,
      message:
        (mode === 'replace'
          ? `Данные восстановлены из бэкапа${skipped ? `, пропущено повреждённых строк: ${skipped}` : ''}.`
          : `Данные добавлены к текущим${skipped ? `, пропущено повреждённых строк: ${skipped}` : ''}.`) +
        (rescue ? ` Копия прежнего журнала сохранена: ${rescue}` : ''),
    });
  }));

  /** Демонстрационные данные. */
  router.post('/demo', ah(async (req, res) => {
    // Загрузка демо-набора заменяет всю базу. Требуем явное подтверждение: без него одну
    // неосторожную команду было не отличить от намерения, и данные владельца терялись.
    const confirmed = (req.body as { confirm?: boolean } | undefined)?.confirm === true || req.query.confirm === '1';
    if (!confirmed) {
      throw new ValidationError('Загрузка демонстрационных данных заменит весь журнал. Подтвердите действие: confirm=true.');
    }
    const rescue = await store.snapshot('before-demo');
    const demo = buildDemoData();
    await store.mutate((db) => {
      const fresh = buildEmptyLike(db);
      Object.assign(db, fresh);
      for (const key of Object.keys(demo) as Array<keyof typeof demo>) {
        const target = db[key] as unknown as Array<Record<string, unknown>>;
        target.length = 0;
        target.push(...(demo[key] as unknown as Array<Record<string, unknown>>));
      }
      db.settings.activeVehicleId = demo.vehicles[0]?.id ?? null;
    });
    const db = store.get();
    res.json({
      ok: true,
      message: rescue
        ? `Демонстрационные данные загружены. Копия прежнего журнала сохранена: ${rescue}`
        : 'Демонстрационные данные загружены.',
      rescue,
      summary: {
        vehicles: db.vehicles.length,
        fuel: db.fuel.length,
        expenses: db.expenses.length,
        incomes: db.incomes.length,
        trips: db.trips.length,
        parts: db.parts.length,
        rules: db.rules.length,
        checklist: db.checklist.length,
      },
    });
  }));

  /** Очистка всех данных. */
  router.delete('/demo', ah(async (_req, res) => {
    await store.clear();
    res.json({ ok: true, message: 'Все данные удалены.' });
  }));

  return router;
}

/** Чистая структура тех же массивов, что уже есть в базе (без пересоздания settings). */
function buildEmptyLike(db: Database): Database {
  return {
    ...db,
    vehicles: [],
    fuel: [],
    expenses: [],
    incomes: [],
    trips: [],
    parts: [],
    rules: [],
    checklist: [],
  };
}
