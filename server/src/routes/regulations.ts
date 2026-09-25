/**
 * Пакеты регламентов ТО: список, подбор по автомобилю, предпросмотр и применение.
 * Ничего не скачивается из интернета — работаем только с локальными файлами.
 */

import { Router } from 'express';
import { ValidationError } from '../validate.ts';
import { ah } from './async-handler.ts';
import type { RegulationLibrary, ApplyMode } from '../regulations.ts';
import type { Store } from '../store.ts';
import type { Vehicle } from '../../../shared/types.ts';

const MODES: ApplyMode[] = ['add-missing', 'update-untouched', 'replace-all'];

export function createRegulationsRouter(store: Store, library: RegulationLibrary): Router {
  const router = Router();

  router.get('/regulations/packs', (_req, res) => {
    res.json({ packs: library.list(), directory: library.directory });
  });

  /** Пакеты, подходящие конкретному автомобилю (по марке, модели, годам и топливу). */
  router.get('/regulations/match', (req, res) => {
    const db = store.get();
    const vehicleId = typeof req.query.vehicleId === 'string' ? req.query.vehicleId : db.settings.activeVehicleId;
    const vehicle = db.vehicles.find((row) => row.id === vehicleId);
    if (!vehicle) throw new ValidationError('Автомобиль не найден.');
    res.json({ vehicleId: vehicle.id, packs: library.match(vehicle), generic: library.generic() });
  });

  /** Предпросмотр: что изменится, если применить пакет. */
  router.post('/regulations/preview', ah(async (req, res) => {
    const body = (req.body ?? {}) as { vehicleId?: string; packId?: string; mode?: string };
    const { vehicle, pack, mode } = resolve(store, library, body);
    const rules = [...store.get().rules].filter((rule) => rule.vehicleId === vehicle.id);
    // Считаем на копии: предпросмотр не должен менять журнал.
    const preview = library.apply(rules.map((rule) => ({ ...rule })), vehicle, pack, mode);
    res.json({ ...preview, packTitle: pack.title, disclaimer: pack.disclaimer });
  }));

  /** Применение пакета. История замен сохраняется, пользовательские правки — под защитой. */
  router.post('/regulations/apply', ah(async (req, res) => {
    const body = (req.body ?? {}) as { vehicleId?: string; packId?: string; mode?: string };
    const { vehicle, pack, mode } = resolve(store, library, body);

    let summary: ReturnType<RegulationLibrary['apply']> | null = null;
    await store.mutate((db) => {
      const own = db.rules.filter((rule) => rule.vehicleId === vehicle.id);
      const others = db.rules.filter((rule) => rule.vehicleId !== vehicle.id);
      summary = library.apply(own, db.vehicles.find((row) => row.id === vehicle.id) ?? vehicle, pack, mode);
      db.rules.length = 0;
      db.rules.push(...others, ...own);
    });

    res.json({
      ok: true,
      ...(summary as unknown as ReturnType<RegulationLibrary['apply']>),
      packTitle: pack.title,
      disclaimer: pack.disclaimer,
      message: `Регламент применён: добавлено ${(summary as unknown as { added: number }).added}, обновлено ${(summary as unknown as { updated: number }).updated}, сохранено как есть ${(summary as unknown as { kept: number }).kept}.`,
    });
  }));

  /**
   * Пример пакета: показывает формат и служит заготовкой.
   * Интервалы здесь — заполнители, а не данные производителя: так и написано в самом файле.
   */
  router.get('/regulations/example', (_req, res) => {
    res.json({
      schemaVersion: 1,
      revision: 1,
      packId: 'example.template',
      title: 'Пример пакета (заготовка, не данные производителя)',
      source: 'user',
      sourceUrl: '',
      vendor: '',
      models: [],
      yearFrom: null,
      yearTo: null,
      fuelTypes: [],
      engineCodes: [],
      usageMultiplier: { highway: 1, normal: 1, city: 0.85, severe: 0.7, taxi: 0.6 },
      disclaimer:
        'Это заготовка для вашего собственного пакета: интервалы здесь условные. Заполните их по руководству владельца для вашей модели, двигателя и рынка — и проверяйте по VIN.',
      items: [
        { code: 'engine-oil', name: 'Моторное масло и масляный фильтр', everyKm: 10000, everyMonths: 12, lifeKm: 10000, severity: 'required', category: 'maintenance', notes: 'Пример: укажите интервал из руководства', estimatedCost: 6000, parts: [{ name: 'Масляный фильтр', article: '', quantity: 1 }] },
        { code: 'air-filter', name: 'Воздушный фильтр', everyKm: 20000, everyMonths: null, lifeKm: 20000, severity: 'recommended', category: 'maintenance', notes: 'Пример: укажите интервал из руководства', estimatedCost: 1500, parts: [] },
        { code: 'brake-fluid', name: 'Тормозная жидкость', everyKm: null, everyMonths: 24, lifeKm: null, severity: 'required', category: 'maintenance', notes: 'Пример: замена по времени', estimatedCost: 3000, parts: [] },
      ],
    });
  });

  /** Импорт пакета из файла: содержимое проверяется перед сохранением. */
  router.post('/regulations/import', ah(async (req, res) => {
    const body = (req.body ?? {}) as { pack?: unknown; packs?: unknown[]; packId?: unknown; items?: unknown };
    // Принимаем три формы: {packs:[…]}, {pack:{…}} и просто сам пакет — файлы люди делают руками.
    const incoming = Array.isArray(body.packs)
      ? body.packs
      : body.pack
        ? [body.pack]
        : body.packId && body.items
          ? [body]
          : [];
    if (!incoming.length) throw new ValidationError('В файле не найден пакет регламентов.');

    const saved: string[] = [];
    const failed: string[] = [];
    for (const candidate of incoming.slice(0, 20)) {
      try {
        const pack = await library.save(candidate);
        saved.push(pack.packId);
      } catch (error) {
        failed.push(error instanceof Error ? error.message : 'неизвестная ошибка');
      }
    }
    if (!saved.length) throw new ValidationError(`Не удалось прочитать пакет: ${failed[0] ?? 'неизвестная ошибка'}`);
    res.status(201).json({ ok: true, saved, failed, directory: library.directory });
  }));

  /** Удаление пакета из библиотеки. Пункты, уже перенесённые в журнал, остаются. */
  router.delete('/regulations/import/:packId', ah(async (req, res) => {
    const removed = await library.remove(req.params.packId);
    if (!removed) return res.status(404).json({ error: 'Пакет не найден.' });
    return res.json({ ok: true, message: 'Пакет удалён из библиотеки. Пункты в журнале остались.' });
  }));

  return router;
}

function resolve(store: Store, library: RegulationLibrary, body: { vehicleId?: string; packId?: string; mode?: string }) {
  const db = store.get();
  const vehicleId = body.vehicleId ?? db.settings.activeVehicleId ?? '';
  const vehicle: Vehicle | undefined = db.vehicles.find((row) => row.id === vehicleId);
  if (!vehicle) throw new ValidationError('Автомобиль не найден.');

  const packId = String(body.packId ?? '');
  const pack = library.get(packId);
  if (!pack) throw new ValidationError('Пакет регламентов не найден в библиотеке.');

  const mode = (MODES as string[]).includes(String(body.mode)) ? (body.mode as ApplyMode) : 'update-untouched';
  return { vehicle, pack, mode };
}
