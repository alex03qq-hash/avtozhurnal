/**
 * Сметы на ТО: черновик по пункту регламента, ручные правки, превращение в расход.
 * Цены подсказываются по истории журнала — внешние сервисы не используются.
 */

import { Router } from 'express';
import { estimateConfidence, estimateSummary, estimateTotal, suggestPrice } from '../../../shared/estimates.ts';
import { ValidationError } from '../validate.ts';
import { ah } from './async-handler.ts';
import type { Store } from '../store.ts';
import type { RegulationLibrary } from '../regulations.ts';
import type { Estimate, EstimateItem } from '../../../shared/types.ts';

/** Ставка за час по умолчанию — как в житейском расчёте сервиса; меняется в смете. */
const DEFAULT_LABOR_RATE = Number(process.env.LABOR_RATE_RUB_PER_HOUR ?? 2500);
/** Смету считаем актуальной сутки: цены меняются. */
const VALIDITY_HOURS = 24;

export function createEstimatesRouter(store: Store, library: RegulationLibrary): Router {
  const router = Router();

  /** История покупок для подсказок: склад запчастей + уже внесённые траты. */
  router.get('/estimates/sources', (req, res) => {
    const db = store.get();
    const rows = db.parts.map((part) => ({ name: part.name, article: part.article, price: part.price }));
    res.json({ rows, laborRate: DEFAULT_LABOR_RATE });
  });

  /**
   * Черновик сметы по пункту регламента: состав берём из пакета, цены — из истории.
   * Ничего не сохраняем: пользователь сначала смотрит и правит.
   */
  router.post('/estimates/draft', ah(async (req, res) => {
    const body = (req.body ?? {}) as { vehicleId?: string; ruleId?: string; laborRate?: number };
    const db = store.get();
    const rule = db.rules.find((row) => row.id === body.ruleId);
    if (!rule) throw new ValidationError('Пункт регламента не найден.');

    const history = db.parts.map((part) => ({ name: part.name, article: part.article, price: part.price }));

    // Состав позиций: если пункт пришёл из пакета, состав известен; иначе одна строка-заглушка.
    const packItem = rule.packId && rule.code ? findPackItem(library, rule.packId, rule.code) : null;
    const rawParts = packItem?.parts?.length
      ? packItem.parts
      : [{ name: rule.name, article: '', quantity: 1 }];

    const parts: EstimateItem[] = rawParts.map((item) => {
      const suggestion = suggestPrice({ name: item.name, article: item.article }, history);
      return {
        name: item.name,
        article: item.article,
        quantity: item.quantity || 1,
        unitPrice: suggestion.unitPrice,
        priceSource: suggestion.source,
        note: suggestion.note,
      };
    });

    const laborRate = Number(body.laborRate) > 0 ? Number(body.laborRate) : DEFAULT_LABOR_RATE;
    const laborHours = 1;

    res.json({
      vehicleId: body.vehicleId ?? rule.vehicleId,
      ruleCode: rule.code ?? null,
      ruleName: rule.name,
      title: `ТО: ${rule.name}`,
      parts,
      laborHours,
      laborRatePerHour: laborRate,
      laborDescription: rule.name,
      total: estimateTotal(parts, laborHours, laborRate),
      confidence: estimateConfidence(parts),
      notes: packItem
        ? `Состав из пакета «${rule.packTitle ?? 'регламент производителя'}». Цены подсказаны по вашей истории — поправьте, если магазин дал другую.`
        : 'Состав вписан вручную: из пакета регламента этот пункт не приходил.',
    });
  }));

  /** Сохранение сметы (создание или обновление). */
  router.post('/estimates', ah(async (req, res) => {
    const body = (req.body ?? {}) as Partial<Estimate>;
    const db = store.get();
    if (!body.vehicleId || !db.vehicles.some((v) => v.id === body.vehicleId)) throw new ValidationError('Автомобиль не найден.');

    const parts = Array.isArray(body.parts) ? body.parts : [];
    const laborHours = Number(body.laborHours) || 0;
    const laborRatePerHour = Number(body.laborRatePerHour) || 0;
    const now = new Date();
    const validUntil = new Date(now.getTime() + VALIDITY_HOURS * 3600 * 1000).toISOString().slice(0, 10);
    const id = crypto.randomUUID();

    const estimate: Estimate = {
      id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      vehicleId: body.vehicleId,
      ruleCode: body.ruleCode ?? null,
      ruleName: String(body.ruleName ?? '').slice(0, 200),
      title: String(body.title ?? 'Смета на ТО').slice(0, 200),
      validUntil,
      status: 'draft',
      parts,
      laborHours,
      laborRatePerHour,
      laborDescription: String(body.laborDescription ?? '').slice(0, 200),
      total: estimateTotal(parts, laborHours, laborRatePerHour),
      confidence: estimateConfidence(parts),
      notes: String(body.notes ?? '').slice(0, 500),
      expenseId: null,
    };

    await store.mutate((state) => {
      state.estimates.push(estimate);
    });
    res.status(201).json(estimate);
  }));

  router.get('/estimates', (req, res) => {
    const db = store.get();
    const vehicleId = typeof req.query.vehicleId === 'string' ? req.query.vehicleId : undefined;
    const rows = db.estimates
      .filter((row) => !vehicleId || row.vehicleId === vehicleId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(rows);
  });

  router.delete('/estimates/:id', ah(async (req, res) => {
    let found = false;
    await store.mutate((db) => {
      const index = db.estimates.findIndex((row) => row.id === req.params.id);
      if (index === -1) return;
      found = true;
      db.estimates.splice(index, 1);
    });
    if (!found) return res.status(404).json({ error: 'Смета не найдена.' });
    return res.json({ ok: true, message: 'Смета удалена.' });
  }));

  /**
   * Принять смету: создаём обычный расход с расшифровкой.
   * Смета остаётся в журнале как источник — можно посмотреть, из чего сложилась сумма.
   */
  router.post('/estimates/:id/accept', ah(async (req, res) => {
    const body = (req.body ?? {}) as { date?: string };
    // Результат складываем в объект: присваивание внутри мутации TypeScript не отслеживает.
    const outcome: {
      created: { id: string; title: string; total: number } | null;
      notFound: boolean;
      already: boolean;
      existingExpenseId: string | null;
    } = { created: null, notFound: false, already: false, existingExpenseId: null };

    await store.mutate((db) => {
      const estimate = db.estimates.find((row) => row.id === req.params.id);
      if (!estimate) {
        outcome.notFound = true;
        return;
      }
      if (estimate.status === 'accepted') {
        outcome.already = true;
        outcome.existingExpenseId = estimate.expenseId ?? null;
        return;
      }

      const now = new Date().toISOString();
      const date = body.date ?? now.slice(0, 10);
      const expenseId = crypto.randomUUID();
      const breakdown = estimateSummary(estimate.parts, estimate.laborHours, estimate.laborRatePerHour);

      db.expenses.push({
        id: expenseId,
        createdAt: now,
        updatedAt: now,
        vehicleId: estimate.vehicleId,
        date,
        category: 'maintenance',
        amount: estimate.total,
        odometer: null,
        vendor: '',
        description: estimate.title,
        photoId: null,
        notes: `Из сметы от ${estimate.createdAt.slice(0, 10)}: ${breakdown}`.slice(0, 900),
      });

      estimate.status = 'accepted';
      estimate.expenseId = expenseId;
      estimate.updatedAt = now;
      outcome.created = { id: expenseId, title: estimate.title, total: estimate.total };
    });

    if (outcome.notFound) return res.status(404).json({ error: 'Смета не найдена.' });
    if (outcome.already) {
      return res.json({
        ok: true,
        alreadyAccepted: true,
        expenseId: outcome.existingExpenseId,
        message: 'Смета уже была принята ранее — повторно расход не создаём.',
      });
    }
    const created = outcome.created as { id: string; title: string; total: number };
    return res
      .status(201)
      .json({ ok: true, expenseId: created.id, total: created.total, message: `Расход «${created.title}» создан на сумму ${created.total} ₽.` });
  }));

  return router;
}

/** Состав позиций из пакета регламента, если он есть в библиотеке. */
function findPackItem(library: RegulationLibrary, packId: string, code: string) {
  const pack = library.get(packId);
  if (!pack) return null;
  return pack.items.find((item) => item.code === code) ?? null;
}
