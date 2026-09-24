/**
 * Маршрутизация на hash — без внешних библиотек.
 *
 * Адреса вида «#/fuel?new=1» нужны для быстрых действий с домашнего экрана телефона:
 * нажатие на «Новую заправку» открывает форму и сразу ставит курсор в поле одометра.
 */

import { useEffect, useState } from 'react';

export function currentRoute(fallback = 'dashboard'): string {
  if (typeof window === 'undefined') return fallback;
  const raw = window.location.hash.replace(/^#\/?/, '');
  return raw.split('?')[0] || fallback;
}

export function currentParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const query = window.location.hash.split('?')[1];
  if (!query) return null;
  return new URLSearchParams(query).get(name);
}

/** Переход в раздел. Используется и меню, и быстрыми действиями. */
export function navigateTo(route: string): void {
  window.location.hash = `#/${route}`;
}

/** Текущий раздел с подпиской на изменения адреса. */
export function useHashRoute(fallback = 'dashboard'): string {
  const [route, setRoute] = useState(() => currentRoute(fallback));
  useEffect(() => {
    const handler = () => setRoute(currentRoute(fallback));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [fallback]);
  return route;
}

/** Параметр адреса, например `new` в «#/fuel?new=1». */
export function useHashParam(name: string): string | null {
  const [value, setValue] = useState(() => currentParam(name));
  useEffect(() => {
    const handler = () => setValue(currentParam(name));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [name]);
  return value;
}
