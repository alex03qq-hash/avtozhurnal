/**
 * Перевод единиц на границе ввода-вывода.
 * В базе всё хранится в километрах и литрах; мили и галлоны — только представление.
 */

import { gallonsToLiters, kmToMiles, litersToGallons, milesToKm } from '../../../shared/calc.ts';
import type { UnitSystem } from '../../../shared/types.ts';

export function distanceLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? 'миль' : 'км';
}

export function volumeLabel(unitSystem: UnitSystem, isElectric = false): string {
  if (isElectric) return 'кВт·ч';
  return unitSystem === 'imperial' ? 'гал' : 'л';
}

export function priceLabel(unitSystem: UnitSystem, isElectric = false): string {
  return `₽ / ${volumeLabel(unitSystem, isElectric)}`;
}

/** Значение из базы → значение для показа пользователю. */
export function toDisplayDistance(km: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? kmToMiles(km) : km;
}

/** Значение, введённое пользователем → значение для хранения. */
export function toStoredDistance(value: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? milesToKm(value) : value;
}

export function toDisplayVolume(liters: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? litersToGallons(liters) : liters;
}

export function toStoredVolume(value: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? gallonsToLiters(value) : value;
}

export function consumptionLabel(unitSystem: UnitSystem, isElectric = false): string {
  if (isElectric) return 'кВт·ч/100 км';
  return unitSystem === 'imperial' ? 'MPG' : 'л/100 км';
}

export function formatConsumptionForUnit(value: number | null, unitSystem: UnitSystem, isElectric = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unitSystem === 'imperial' && !isElectric) {
    const mpg = 235.214583 / value;
    return `${mpg.toFixed(1).replace('.', ',')} MPG`;
  }
  return `${value.toFixed(1).replace('.', ',')} ${consumptionLabel(unitSystem, isElectric)}`;
}

export function costPerDistanceLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? '₽/миля' : '₽/км';
}

export function toDisplayCostPerKm(value: number | null, unitSystem: UnitSystem): number | null {
  if (value === null) return null;
  return unitSystem === 'imperial' ? Math.round(value * 1.609344 * 100) / 100 : value;
}

/** Цена топлива: в базе всегда ₽ за литр. */
export function toDisplayPrice(pricePerLiter: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? Math.round(pricePerLiter * 3.785411784 * 100) / 100 : pricePerLiter;
}

export function toStoredPrice(pricePerDisplay: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? Math.round((pricePerDisplay / 3.785411784) * 1000) / 1000 : pricePerDisplay;
}
