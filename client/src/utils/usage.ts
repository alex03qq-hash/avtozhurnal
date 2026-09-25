/** Множители интервала по условиям эксплуатации — те же, что применяет сервер в пакетах регламентов. */

import type { UsageClass } from '../../../shared/types.ts';

export const USAGE_LABELS: Record<UsageClass, string> = {
  highway: 'Трасса',
  normal: 'Смешанный',
  city: 'Город',
  severe: 'Тяжёлые условия',
  taxi: 'Такси и доставка',
};

export const USAGE_MULTIPLIERS: Record<UsageClass, number> = {
  highway: 1,
  normal: 1,
  city: 0.85,
  severe: 0.7,
  taxi: 0.6,
};
