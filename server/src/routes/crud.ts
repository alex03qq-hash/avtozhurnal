/**
 * Универсальный CRUD для всех коллекций базы.
 * Отдельно описаны правила, которые зависят от предметной области:
 * каскадное удаление автомобиля, проверка одометра, отметка ТО выполненным.
 */

import { Router } from 'express';
import type { CollectionName, Database } from '../../../shared/types.ts';
import { formatDate } from '../../../shared/format.ts';
import { describeCategory, newId, sanitize, ValidationError } from '../validate.ts';
import type { Store } from '../store.ts';
import { ah } from './async-handler.ts';

type Record_ = Record<string, unknown> & { id?: string; vehicleId?: string | null; date?: string };

function sortRecords(name: CollectionName, rows: Record_[]): Record_[] {
  const copy = [...rows];
  switch (name) {
    case 'vehicles':
      return copy.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    case 'checklist':
      return copy.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    default:
      return copy.sort((a, b) => {
        const d = String(b.date ?? '').localeCompare(String(a.date ?? ''));
        if (d !== 0) return d;
        return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
      });
  }
}

function collectionOf(db: Database, name: CollectionName): Record_[] {
  return db[name] as unknown as Record_[];
}

export function createCollectionRouter(store: Store, name: CollectionName): Router {
  const router = Router();

  /** Список записей; ?vehicleId=… фильтрует по автомобилю. */
  router.get('/', (req, res) => {
    const db = store.get();
    const vehicleId = typeof req.query.vehicleId === 'string' ? req.query.vehicleId : undefined;
    let rows = collectionOf(db, name);
    if (vehicleId) rows = rows.filter((row) => row.vehicleId === vehicleId || (name === 'checklist' && row.vehicleId === null));
    if (name === 'vehicles') rows = rows.filter((row) => (req.query.includeArchived === 'true' ? true : !row.isArchived));
    res.json(sortRecords(name, rows));
  });

  router.get('/:id', (req, res) => {
    const row = collectionOf(store.get(), name).find((r) => r.id === req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена.' });
    return res.json(row);
  });

  router.post('/', ah(async (req, res) => {
    const payload = sanitize<Record_>(name, req.body ?? {});
    assertVehicleExists(store.get(), name, payload);

    if (name === 'fuel') assertOdometerOrder(store.get(), payload, null);

    const now = new Date().toISOString();
    const record = { ...payload, id: newId(), createdAt: now, updatedAt: now } as Record_;
    await store.mutate((db) => {
      collectionOf(db, name).push(record);
      if (name === 'vehicles' && !db.settings.activeVehicleId) {
        db.settings.activeVehicleId = record.id ?? null;
      }
    });
    res.status(201).json(record);
  }));

  router.patch('/:id', ah(async (req, res) => {
    // Чтение, валидация и запись выполняются ВНУТРИ очереди мутаций:
    // иначе два параллельных запроса прочитают одно состояние и потеряют правку друг друга.
    const outcome = await store.mutate((state) => {
      const rows = collectionOf(state, name);
      const index = rows.findIndex((r) => r.id === req.params.id);
      if (index === -1) return { notFound: true as const };
      const existing = rows[index];

      const patch = sanitize<Record_>(name, req.body ?? {}, true);
      assertVehicleExists(state, name, { ...existing, ...patch });
      if (name === 'fuel') assertOdometerOrder(state, { ...existing, ...patch }, req.params.id);

      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() } as Record_;
      rows[index] = updated;
      return { notFound: false as const, updated };
    });

    if (outcome.notFound) return res.status(404).json({ error: 'Запись не найдена.' });
    return res.json(outcome.updated);
  }));

  router.delete('/:id', ah(async (req, res) => {
    const outcome = await store.mutate((state) => {
      const rows = collectionOf(state, name);
      const index = rows.findIndex((r) => r.id === req.params.id);
      // Проверяем индекс обязательно: splice(-1, 1) удалил бы последнюю запись вместо ошибки.
      if (index === -1) return { notFound: true as const, removed: {} as Record<string, number> };

      rows.splice(index, 1);
      const removed: Record<string, number> = {};

      // Удаление автомобиля тянет за собой все связанные записи.
      if (name === 'vehicles') {
        const collections: CollectionName[] = ['fuel', 'expenses', 'incomes', 'trips', 'parts', 'rules'];
        for (const collection of collections) {
          const target = collectionOf(state, collection);
          const before = target.length;
          const kept = target.filter((row) => row.vehicleId !== req.params.id);
          target.length = 0;
          target.push(...kept);
          removed[collection] = before - kept.length;
        }
        for (const item of state.checklist) if (item.vehicleId === req.params.id) item.vehicleId = null;
        if (state.settings.activeVehicleId === req.params.id) {
          state.settings.activeVehicleId = state.vehicles[0]?.id ?? null;
        }
      }

      return { notFound: false as const, removed };
    });

    if (outcome.notFound) return res.status(404).json({ error: 'Запись не найдена.' });
    return res.json({ ok: true, removed: outcome.removed, message: 'Запись удалена.' });
  }));

  /** Отметить регламент ТО выполненным: проставляем пробег/дату текущими значениями. */
  router.post('/:id/complete', ah(async (req, res) => {
    if (name !== 'rules') return res.status(404).json({ error: 'Действие доступно только для регламентов ТО.' });
    const db = store.get();
    const rule = db.rules.find((r) => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'Регламент не найден.' });

    const vehicle = db.vehicles.find((v) => v.id === rule.vehicleId);
    const odometer =
      req.body?.odometer !== undefined && req.body?.odometer !== null && req.body?.odometer !== ''
        ? Number(req.body.odometer)
        : Math.max(
            vehicle?.initialOdometer ?? 0,
            ...db.fuel.filter((f) => f.vehicleId === rule.vehicleId).map((f) => f.odometer),
            ...db.expenses.filter((e) => e.vehicleId === rule.vehicleId && e.odometer !== null).map((e) => e.odometer as number),
          );
    const date = typeof req.body?.date === 'string' && req.body.date ? String(req.body.date).slice(0, 10) : new Date().toISOString().slice(0, 10);

    await store.mutate((state) => {
      const target = state.rules.find((r) => r.id === req.params.id);
      if (!target) return;
      target.lastServiceOdometer = Number.isFinite(odometer) ? odometer : null;
      target.lastServiceDate = date;
      target.updatedAt = new Date().toISOString();
    });
    return res.json(store.get().rules.find((r) => r.id === req.params.id));
  }));

  return router;
}

function assertVehicleExists(db: Database, name: CollectionName, payload: Record_): void {
  if (name === 'vehicles') return;
  if (name === 'checklist') {
    // Пункт чек-листа может быть общим (vehicleId = null), но если автомобиль указан — он должен существовать.
    const linked = payload.vehicleId;
    if (typeof linked === 'string' && linked && !db.vehicles.some((v) => v.id === linked)) {
      throw new ValidationError('Автомобиль не найден.');
    }
    return;
  }
  const vehicleId = payload.vehicleId;
  if (typeof vehicleId !== 'string' || !vehicleId) throw new ValidationError('Не выбран автомобиль.');
  if (!db.vehicles.some((v) => v.id === vehicleId)) throw new ValidationError('Автомобиль не найден.');
}

/**
 * Одометр не может уменьшаться: новая запись не должна «откатывать» пробег назад
 * относительно более ранних записей по тому же автомобилю.
 */
function assertOdometerOrder(db: Database, payload: Record_, excludeId: string | null): void {
  const vehicleId = String(payload.vehicleId ?? '');
  const odometer = Number(payload.odometer ?? 0);
  const date = String(payload.date ?? '');
  const earlier = db.fuel
    .filter((f) => f.vehicleId === vehicleId && f.id !== excludeId && f.date <= date)
    .sort((a, b) => b.odometer - a.odometer)[0];

  if (earlier && odometer < earlier.odometer) {
    throw new ValidationError(
      `Одометр ${Math.round(odometer)} км меньше, чем в записи от ${formatDate(earlier.date)} (${Math.round(earlier.odometer)} км). Проверьте показания.`,
    );
  }
  if (odometer > 3_000_000) throw new ValidationError('Одометр выглядит неправдоподобно (больше 3 000 000 км).');
}
