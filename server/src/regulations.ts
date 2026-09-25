/**
 * Библиотека локальных пакетов регламентов ТО.
 *
 * Принципиально без интернета: пакет — это обычный JSON-файл в `data/regulations/packs`.
 * Пользователь кладёт файл сам или импортирует через интерфейс, приложение только подбирает
 * подходящий пакет по марке, модели, годам и типу топлива и применяет его к автомобилю.
 *
 * Заводской интервал никогда не перезаписывается «в лоб»: пункты различаются по коду,
 * а пользовательские правки помечаются и при обновлении пакета сохраняются.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from './validate.ts';
import type {
  FuelType,
  RegulationItem,
  RegulationPack,
  ServiceRule,
  UsageClass,
  Vehicle,
} from '../../shared/types.ts';

export type ApplyMode = 'add-missing' | 'update-untouched' | 'replace-all';

export const USAGE_CLASS_LABELS: Record<UsageClass, string> = {
  highway: 'Трасса',
  normal: 'Смешанный',
  city: 'Город',
  severe: 'Тяжёлые условия',
  taxi: 'Такси и доставка',
};

export const USAGE_CLASS_MULTIPLIER: Record<UsageClass, number> = {
  highway: 1,
  normal: 1,
  city: 0.85,
  severe: 0.7,
  taxi: 0.6,
};

export interface PackSummary {
  packId: string;
  title: string;
  vendor: string;
  models: string[];
  yearFrom: number | null;
  yearTo: number | null;
  fuelTypes: FuelType[];
  items: number;
  source: RegulationPack['source'];
  disclaimer: string;
  /** Совпадает ли пакет с автомобилем: 0 — не подходит, чем больше, тем точнее. */
  relevance?: number;
}

export interface ApplyResult {
  packId: string;
  mode: ApplyMode;
  added: number;
  updated: number;
  kept: number;
  /** Сколько пунктов осталось только у пользователя (в пакете их нет). */
  leftAlone: number;
  preview: Array<{ code: string; name: string; action: 'add' | 'update' | 'keep'; reason: string }>;
}

const MAX_PACK_BYTES = 512 * 1024;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s_-]+/g, '');
}

/** Проверка структуры пакета: файлы приходят извне, доверять им нельзя. */
export function validatePack(input: unknown): RegulationPack {
  if (!input || typeof input !== 'object') throw new ValidationError('Файл пакета не распознан.');
  const raw = input as Partial<RegulationPack>;

  if (!raw.packId || typeof raw.packId !== 'string') throw new ValidationError('В пакете не указан packId.');
  if (!raw.title || typeof raw.title !== 'string') throw new ValidationError('В пакете не указано название.');
  if (!Array.isArray(raw.items) || raw.items.length === 0) throw new ValidationError('В пакете нет ни одного пункта регламента.');
  if (raw.items.length > 200) throw new ValidationError('В пакете слишком много пунктов (больше 200).');

  const items: RegulationItem[] = raw.items.map((item, index) => {
    const row = item as Partial<RegulationItem>;
    if (!row.code || typeof row.code !== 'string') throw new ValidationError(`У пункта ${index + 1} нет кода.`);
    if (!row.name || typeof row.name !== 'string') throw new ValidationError(`У пункта «${row.code}» нет названия.`);
    const everyKm = Number(row.everyKm);
    const everyMonths = Number(row.everyMonths);
    if ((!Number.isFinite(everyKm) || everyKm <= 0) && (!Number.isFinite(everyMonths) || everyMonths <= 0)) {
      throw new ValidationError(`У пункта «${row.name}» не задан ни интервал по пробегу, ни интервал по времени.`);
    }
    return {
      code: String(row.code).slice(0, 60),
      name: String(row.name).slice(0, 160),
      everyKm: Number.isFinite(everyKm) && everyKm > 0 ? Math.round(everyKm) : null,
      everyMonths: Number.isFinite(everyMonths) && everyMonths > 0 ? Math.round(everyMonths) : null,
      lifeKm: Number.isFinite(Number(row.lifeKm)) && Number(row.lifeKm) > 0 ? Math.round(Number(row.lifeKm)) : null,
      severity: row.severity === 'recommended' || row.severity === 'check' ? row.severity : 'required',
      category: (row.category ?? 'maintenance') as RegulationItem['category'],
      notes: String(row.notes ?? '').slice(0, 400),
      estimatedCost: Number.isFinite(Number(row.estimatedCost)) && Number(row.estimatedCost) > 0 ? Math.round(Number(row.estimatedCost)) : null,
      parts: Array.isArray(row.parts)
        ? row.parts.slice(0, 20).map((part) => ({
            name: String((part as { name?: unknown }).name ?? '').slice(0, 120),
            article: String((part as { article?: unknown }).article ?? '').slice(0, 60),
            quantity: Math.max(1, Math.round(Number((part as { quantity?: unknown }).quantity) || 1)),
          }))
        : [],
    };
  });

  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    revision: Number(raw.revision) > 0 ? Math.round(Number(raw.revision)) : 1,
    packId: String(raw.packId).slice(0, 80),
    title: String(raw.title).slice(0, 200),
    // Источник не выдумываем: если он не указан явно, помечаем как пользовательский.
    source: raw.source === 'owner-manual' || raw.source === 'public-data' ? raw.source : 'user',
    sourceUrl: String(raw.sourceUrl ?? '').slice(0, 300),
    vendor: String(raw.vendor ?? '').slice(0, 60),
    models: Array.isArray(raw.models) ? raw.models.map((model) => String(model).slice(0, 60)).slice(0, 20) : [],
    yearFrom: Number.isFinite(Number(raw.yearFrom)) ? Number(raw.yearFrom) : null,
    yearTo: Number.isFinite(Number(raw.yearTo)) ? Number(raw.yearTo) : null,
    fuelTypes: Array.isArray(raw.fuelTypes) ? (raw.fuelTypes as FuelType[]).slice(0, 8) : [],
    engineCodes: Array.isArray(raw.engineCodes) ? raw.engineCodes.map((code) => String(code).slice(0, 40)).slice(0, 20) : [],
    usageMultiplier: (raw.usageMultiplier ?? {}) as RegulationPack['usageMultiplier'],
    disclaimer:
      String(raw.disclaimer ?? '').slice(0, 500) ||
      'Источник не указан. Проверяйте регламент по руководству для вашего VIN, двигателя и рынка.',
    items,
  };
}

export class RegulationLibrary {
  private readonly dir: string;
  private packs = new Map<string, RegulationPack>();

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, 'regulations', 'packs');
  }

  get directory(): string {
    return this.dir;
  }

  /** Читает все пакеты из папки. Битые файлы пропускаются и перечисляются в отчёте. */
  async load(): Promise<{ loaded: number; skipped: Array<{ file: string; reason: string }> }> {
    await fsp.mkdir(this.dir, { recursive: true });
    this.packs.clear();
    const skipped: Array<{ file: string; reason: string }> = [];
    const files = (await fsp.readdir(this.dir)).filter((name) => name.endsWith('.json'));

    for (const file of files) {
      try {
        const text = await fsp.readFile(path.join(this.dir, file), 'utf8');
        if (Buffer.byteLength(text, 'utf8') > MAX_PACK_BYTES) throw new Error('файл больше 512 КБ');
        const pack = validatePack(JSON.parse(text));
        this.packs.set(pack.packId, pack);
      } catch (error) {
        skipped.push({ file, reason: error instanceof Error ? error.message : 'неизвестная ошибка' });
      }
    }
    return { loaded: this.packs.size, skipped };
  }

  list(): PackSummary[] {
    return [...this.packs.values()].map((pack) => ({
      packId: pack.packId,
      title: pack.title,
      vendor: pack.vendor,
      models: pack.models,
      yearFrom: pack.yearFrom,
      yearTo: pack.yearTo,
      fuelTypes: pack.fuelTypes,
      items: pack.items.length,
      source: pack.source,
      disclaimer: pack.disclaimer,
    }));
  }

  get(packId: string): RegulationPack | null {
    return this.packs.get(packId) ?? null;
  }

  /** Насколько пакет подходит автомобилю: 0 — не подходит. */
  relevance(pack: RegulationPack, vehicle: Vehicle): number {
    let score = 0;

    const vendor = normalize(pack.vendor);
    const make = normalize(vehicle.make);
    const model = normalize(vehicle.model);
    const modelFull = normalize(`${vehicle.make} ${vehicle.model}`);

    const vendorKnown = vendor.length > 0;
    const vendorMatch = !vendorKnown || modelFull.includes(vendor) || make.includes(vendor) || vendor.includes(make);
    if (!vendorMatch) return 0;
    if (vendorKnown) score += 2;

    if (pack.models.length) {
      const modelMatch = pack.models.some((candidate) => {
        const target = normalize(candidate);
        return target.length > 1 && (model.includes(target) || modelFull.includes(target));
      });
      if (!modelMatch) return 0;
      score += 3;
    }

    if (pack.yearFrom !== null || pack.yearTo !== null) {
      const year = vehicle.year ?? 0;
      if (!year) return 0;
      if (pack.yearFrom !== null && year < pack.yearFrom) return 0;
      if (pack.yearTo !== null && year > pack.yearTo) return 0;
      score += 2;
    }

    if (pack.fuelTypes.length) {
      if (!pack.fuelTypes.includes(vehicle.fuelType)) return 0;
      score += 2;
    }

    return score;
  }

  /** Подходящие пакеты, самые точные сверху. */
  match(vehicle: Vehicle): PackSummary[] {
    const matched: PackSummary[] = [];
    for (const summary of this.list()) {
      const pack = this.packs.get(summary.packId);
      if (!pack) continue;
      const relevance = this.relevance(pack, vehicle);
      if (relevance > 0) matched.push({ ...summary, relevance });
    }
    return matched.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  }

  /**
   * Пакеты без привязки к модели (свои шаблоны, общие наборы).
   * Подбор их не предлагает автоматически, но пользователь должен видеть их и применять осознанно.
   */
  generic(): PackSummary[] {
    return this.list().filter((summary) => {
      const pack = this.packs.get(summary.packId);
      if (!pack) return false;
      const hasTargeting =
        pack.vendor.trim() !== '' ||
        pack.models.length > 0 ||
        pack.fuelTypes.length > 0 ||
        pack.yearFrom !== null ||
        pack.yearTo !== null;
      return !hasTargeting;
    });
  }

  /**
   * Применяет пакет к автомобилю.
   * История замен не теряется никогда: обновляются только интервалы и описание пункта.
   */
  apply(rules: ServiceRule[], vehicle: Vehicle, pack: RegulationPack, mode: ApplyMode): ApplyResult {
    const usageClass: UsageClass = vehicle.usageClass ?? 'normal';
    const multiplier = pack.usageMultiplier[usageClass] ?? USAGE_CLASS_MULTIPLIER[usageClass] ?? 1;
    const now = new Date().toISOString();

    const result: ApplyResult = { packId: pack.packId, mode, added: 0, updated: 0, kept: 0, leftAlone: 0, preview: [] };
    const byCode = new Map<string, ServiceRule>();
    for (const rule of rules) {
      if (rule.code) byCode.set(rule.code, rule);
    }
    const covered = new Set<string>();

    for (const item of pack.items) {
      const existing = byCode.get(item.code);
      const effectiveKm = item.everyKm !== null ? Math.max(100, Math.round(item.everyKm * multiplier)) : null;
      // Средняя длина месяца 30,44 дня: 12 месяцев — это 365 дней, а не 360 (иначе срок «уезжает»).
      const effectiveDays = item.everyMonths !== null ? Math.max(1, Math.round(item.everyMonths * 30.44 * multiplier)) : null;
      // Ресурс детали берём только из пакета: подменять его интервалом нельзя — процент износа станет врать.
      const lifeKm = item.lifeKm !== null ? Math.max(100, Math.round(item.lifeKm * multiplier)) : null;

      if (!existing) {
        rules.push({
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          vehicleId: vehicle.id,
          name: item.name,
          intervalKm: effectiveKm,
          intervalDays: effectiveDays,
          componentLifeKm: lifeKm,
          lastServiceOdometer: null,
          lastServiceDate: null,
          warnKmBefore: item.severity === 'check' ? 500 : 1000,
          warnDaysBefore: 14,
          notes: item.notes,
          code: item.code,
          origin: 'pack',
          packId: pack.packId,
          packTitle: pack.title,
          packRevision: pack.revision,
          manufacturerIntervalKm: item.everyKm,
          manufacturerIntervalDays: item.everyMonths !== null ? Math.round(item.everyMonths * 30.44) : null,
          userOverridden: false,
        });
        result.added += 1;
        result.preview.push({ code: item.code, name: item.name, action: 'add', reason: `новый пункт: ${effectiveKm ?? '—'} км / ${effectiveDays ?? '—'} дн.` });
        continue;
      }

      covered.add(item.code);
      // Защищаем всё, что человек создал или правил сам:
      //   • пункт заведён вручную (origin !== 'pack');
      //   • интервал правился вручную (userOverridden).
      const protectedByUser = existing.userOverridden === true || existing.origin !== 'pack';

      if (mode === 'add-missing') {
        result.kept += 1;
        result.preview.push({ code: item.code, name: item.name, action: 'keep', reason: 'уже есть в вашем журнале' });
        continue;
      }
      if (protectedByUser && mode !== 'replace-all') {
        result.kept += 1;
        result.preview.push({ code: item.code, name: item.name, action: 'keep', reason: 'вы правили интервал вручную — настройка сохранена' });
        continue;
      }

      // Заметки пользователя не затираем: они часто содержат марку масла и артикулы.
      const userNotes = (existing.notes ?? '').trim();
      const packNotes = (item.notes ?? '').trim();
      if (userNotes && packNotes && userNotes !== packNotes) {
        result.preview.push({ code: item.code, name: item.name, action: 'keep', reason: 'ваши заметки сохранены (в пакете свой текст)' });
      }

      existing.name = item.name;
      existing.intervalKm = effectiveKm;
      existing.intervalDays = effectiveDays;
      existing.componentLifeKm = lifeKm ?? existing.componentLifeKm ?? null;
      existing.packNotes = packNotes || existing.packNotes || null;
      if (!userNotes) existing.notes = packNotes;
      existing.code = item.code;
      existing.origin = 'pack';
      existing.packId = pack.packId;
      existing.packTitle = pack.title;
      existing.packRevision = pack.revision;
      existing.manufacturerIntervalKm = item.everyKm;
      existing.manufacturerIntervalDays = item.everyMonths !== null ? Math.round(item.everyMonths * 30.44) : null;
      existing.updatedAt = now;
      result.updated += 1;
      result.preview.push({ code: item.code, name: item.name, action: 'update', reason: `интервал обновлён: ${effectiveKm ?? '—'} км / ${effectiveDays ?? '—'} дн.` });
    }

    // Пункты, которых нет в пакете, не трогаем — они остаются пользовательскими.
    // Добавленные только что пункты уже имеют код из пакета, поэтому в «оставшихся» не попадают.
    const packCodes = new Set(pack.items.map((item) => item.code));
    result.leftAlone = rules.filter((rule) => !rule.code || !packCodes.has(rule.code)).length;
    return result;
  }

  /** Сохраняет пакет в папку: файлы извне доверяются только после проверки. */
  async save(input: unknown): Promise<RegulationPack> {
    const pack = validatePack(input);
    await fsp.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${pack.packId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
    await fsp.writeFile(file, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    this.packs.set(pack.packId, pack);
    return pack;
  }

  /** Удаление пакета из библиотеки (применённые пункты в журнале остаются). */
  async remove(packId: string): Promise<boolean> {
    const pack = this.packs.get(packId);
    if (!pack) return false;
    const file = path.join(this.dir, `${packId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
    if (fs.existsSync(file)) await fsp.unlink(file).catch(() => undefined);
    this.packs.delete(packId);
    return true;
  }
}
