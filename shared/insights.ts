/**
 * Выводы из накопленных данных: стиль вождения, прогноз износа и стоимость владения.
 *
 * Честная оговорка, которая повторяется и в интерфейсе: это ОЦЕНКА на основе косвенных признаков,
 * а не измерение и не финансовый совет. Прямых данных о манере езды (ускорения, торможения)
 * у приложения нет, поэтому стиль определяется по отклонению фактического расхода от нормы
 * и по интенсивности пробега.
 */

import { round } from './calc.ts';
import type { FuelEntry, Vehicle, WearStatus } from './types.ts';

/** Типовая норма расхода для типа привода: литры (или кВт·ч) на 100 км. */
export const REFERENCE_CONSUMPTION: Record<Vehicle['fuelType'], number> = {
  petrol: 8.5,
  diesel: 7.0,
  gas: 10.0,
  hybrid: 5.5,
  electric: 17.0,
};

export interface DrivingStyle {
  /** Фактический расход, л/100 км (или кВт·ч/100 км). */
  actual: number | null;
  /** Норма для этого типа привода. */
  reference: number;
  /** Отклонение от нормы в процентах: «+12 %» значит «расход выше нормы». */
  deviationPercent: number | null;
  /** Множитель износа: больше 1 — детали расходуются быстрее. */
  wearFactor: number;
  /** Короткое словесное описание. */
  label: 'экономный' | 'спокойный' | 'обычный' | 'активный' | 'нет данных';
  explanation: string;
}

/** Оценка стиля вождения по расходу и пробегу. */
export function drivingStyle(fuel: FuelEntry[], vehicle: Vehicle, averageConsumption: number | null, kmPerMonth: number): DrivingStyle {
  const reference = REFERENCE_CONSUMPTION[vehicle.fuelType];
  if (averageConsumption === null) {
    return {
      actual: null,
      reference,
      deviationPercent: null,
      wearFactor: 1,
      label: 'нет данных',
      explanation: 'Для оценки нужны хотя бы две заправки — пока данных мало.',
    };
  }

  const deviation = round(((averageConsumption - reference) / reference) * 100, 0);
  // Множитель износа от расхода: каждые 10 % перерасхода дают +4 % к износу.
  let factor = 1 + (deviation / 10) * 0.04;
  // Пробег влияет на износ городской езды: много коротких поездок — детали ходят меньше.
  if (kmPerMonth > 2500) factor += 0.03;
  factor = Math.min(1.35, Math.max(0.85, round(factor, 2)));

  const label: DrivingStyle['label'] =
    deviation <= -12 ? 'экономный' : deviation <= -3 ? 'спокойный' : deviation <= 10 ? 'обычный' : 'активный';

  const parts = [
    `средний расход ${averageConsumption.toFixed(1)} против типовой нормы ${reference.toFixed(1)} — это ${deviation >= 0 ? 'на' : 'ниже на'} ${Math.abs(deviation)} %`,
    `пробег около ${Math.round(kmPerMonth)} км в месяц`,
    `износ деталей считается с множителем ${factor.toFixed(2)}`,
  ];

  return {
    actual: averageConsumption,
    reference,
    deviationPercent: deviation,
    wearFactor: factor,
    label,
    explanation: `${parts.join('; ')}. Оценка сделана по косвенным признакам: точных данных о манере езды приложение не собирает.`,
  };
}

export interface WearForecast {
  ruleId: string;
  name: string;
  /** Остаток по пробегу с учётом стиля вождения. */
  adjustedRemainingKm: number | null;
  /** Сколько месяцев осталось при текущем темпе пробега. */
  monthsLeft: number | null;
  /** Прогноз даты замены. */
  predictedDate: string | null;
  /** Износ с учётом стиля, %. */
  adjustedPercent: number | null;
  status: WearStatus['status'];
}

/** Прогноз по каждой детали: пересчитывает остаток через множитель износа и темп пробега. */
export function wearForecast(items: WearStatus[], style: DrivingStyle, kmPerMonth: number, todayISO: string): WearForecast[] {
  return items.map((item) => {
    const adjustedRemainingKm = item.remainingKm === null ? null : round(item.remainingKm / style.wearFactor, 0);
    const adjustedPercent = item.percentUsed === null ? null : round(item.percentUsed * style.wearFactor, 1);
    const monthsLeft =
      adjustedRemainingKm !== null && kmPerMonth > 0 ? round(Math.max(0, adjustedRemainingKm) / kmPerMonth, 1) : null;

    let predictedDate: string | null = null;
    if (item.status === 'overdue') predictedDate = todayISO;
    else if (monthsLeft !== null) {
      const date = new Date(`${todayISO}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + Math.floor(monthsLeft));
      date.setUTCDate(date.getUTCDate() + Math.round((monthsLeft % 1) * 30));
      predictedDate = date.toISOString().slice(0, 10);
    } else if (item.nextServiceDate) predictedDate = item.nextServiceDate;

    return {
      ruleId: item.ruleId,
      name: item.name,
      adjustedRemainingKm,
      monthsLeft,
      predictedDate,
      adjustedPercent,
      status: item.status,
    };
  });
}

export interface OwnershipInsight {
  /** Средние траты в месяц за последние месяцы. */
  monthlyAverage: number;
  /** Стоимость километра сейчас и три месяца назад. */
  costPerKmNow: number | null;
  costPerKmBefore: number | null;
  /** Изменение стоимости километра, %. */
  costTrendPercent: number | null;
  /** Вывод одной-двумя фразами. */
  verdict: 'держать' | 'наблюдать' | 'подумать о продаже' | 'нет данных';
  explanation: string;
}

/**
 * Подсказка «когда думать о продаже» — намеренно осторожная:
 * сравнивает стоимость километра сейчас и три месяца назад и рост трат.
 */
export function ownershipInsight(
  monthly: Array<{ key: string; total: number }>,
  totals: { costPerKm: number | null; distanceKm: number },
  history: { costPerKmBefore: number | null },
): OwnershipInsight {
  const recent = monthly.slice(-6);
  const monthlyAverage = recent.length ? round(recent.reduce((acc, row) => acc + row.total, 0) / recent.length, 0) : 0;
  const costPerKmNow = totals.costPerKm;
  const costPerKmBefore = history.costPerKmBefore;

  const costTrendPercent =
    costPerKmNow !== null && costPerKmBefore !== null && costPerKmBefore > 0
      ? round(((costPerKmNow - costPerKmBefore) / costPerKmBefore) * 100, 0)
      : null;

  // Дорожающее владение + большой пробег = разумный повод посчитать выгоду продажи.
  const expensive = monthlyAverage >= 15000;
  const gettingWorse = costTrendPercent !== null && costTrendPercent >= 12;

  let verdict: OwnershipInsight['verdict'] = 'держать';
  if (costPerKmNow === null || costPerKmBefore === null) verdict = 'нет данных';
  else if (expensive && gettingWorse) verdict = 'подумать о продаже';
  else if (gettingWorse) verdict = 'наблюдать';

  const facts: string[] = [];
  if (monthlyAverage) facts.push(`в среднем ${Math.round(monthlyAverage)} ₽ в месяц за последние полгода`);
  if (costPerKmNow !== null) facts.push(`сейчас ${costPerKmNow.toFixed(2)} ₽ за километр`);
  if (costTrendPercent !== null) facts.push(`три месяца назад было ${costTrendPercent >= 0 ? 'на' : 'на'} ${Math.abs(costTrendPercent)} % ${costTrendPercent >= 0 ? 'дешевле' : 'дороже'}`);

  const explanations: Record<OwnershipInsight['verdict'], string> = {
    'держать': 'Стоимость километра не растёт — менять машину ради экономии смысла нет.',
    'наблюдать': 'Владение постепенно дорожает: стоит пересмотреть, что именно тянет расходы вверх.',
    'подумать о продаже': 'Владение дорогое и растёт: имеет смысл посчитать вариант продажи и сравнить с новым автомобилем.',
    'нет данных': 'Для вывода нужно больше истории — минимум несколько месяцев записей.',
  };

  return {
    monthlyAverage,
    costPerKmNow,
    costPerKmBefore,
    costTrendPercent,
    verdict,
    explanation: `${facts.length ? `${facts.join('; ')}. ` : ''}${explanations[verdict]} Это ориентир по вашим собственным цифрам, а не финансовая рекомендация.`,
  };
}
