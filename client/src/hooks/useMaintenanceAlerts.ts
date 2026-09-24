/**
 * Напоминания о ТО на самом телефоне.
 *
 * Два независимых пути:
 *   1) файл календаря (.ics) — его добавляют в календарь телефона один раз, и дальше
 *      напоминания приходят системно, даже когда приложение закрыто;
 *   2) уведомление браузера — показывается, когда приложение открыто и есть срочные пункты.
 *
 * Настоящий push при закрытом приложении требует внешнего push-сервиса, поэтому
 * основным путём считается календарь, а уведомление — дополнением.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';

const LAST_ALERT_KEY = 'avtozhurnal.lastAlertDate';

export type AlertPermission = NotificationPermission | 'unsupported';

export interface MaintenanceAlertState {
  supported: boolean;
  permission: AlertPermission;
  /** Запросить разрешение и сразу проверить сроки. */
  request: () => Promise<AlertPermission>;
  /** Проверить сроки и показать уведомление, если оно разрешено. */
  check: () => Promise<{ overdue: number; soon: number }>;
}

export function useMaintenanceAlerts(vehicleId?: string): MaintenanceAlertState {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = useState<AlertPermission>(supported ? Notification.permission : 'unsupported');

  const check = useCallback(async () => {
    if (!vehicleId) return { overdue: 0, soon: 0 };
    const data = await api.reminders(vehicleId);
    const overdue = data.items.filter((item) => item.status === 'overdue');
    const soon = data.items.filter((item) => item.status === 'soon');

    if ((overdue.length > 0 || soon.length > 0) && supported && Notification.permission === 'granted') {
      const today = new Date().toISOString().slice(0, 10);
      // Не чаще одного уведомления в день, чтобы не надоедать.
      if (window.localStorage.getItem(LAST_ALERT_KEY) !== today) {
        const names = [...overdue, ...soon].slice(0, 3).map((item) => item.name).join(', ');
        const title = overdue.length > 0 ? `Просрочено: ${overdue.length}` : `Скоро замена: ${soon.length}`;
        new Notification(`АвтоЖурнал · ${title}`, { body: names, icon: '/icons/icon-192.png', tag: 'avtozhurnal-reminders' });
        window.localStorage.setItem(LAST_ALERT_KEY, today);
      }
    }

    return { overdue: overdue.length, soon: soon.length };
  }, [vehicleId, supported]);

  const request = useCallback(async () => {
    if (!supported) return 'unsupported' as AlertPermission;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') await check();
    return result;
  }, [supported, check]);

  useEffect(() => {
    void check().catch(() => undefined);
  }, [check]);

  return { supported, permission, request, check };
}
