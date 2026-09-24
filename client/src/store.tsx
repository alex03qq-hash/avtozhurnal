/**
 * Глобальное состояние интерфейса: настройки, список автомобилей,
 * активная машина, тема оформления и всплывающие уведомления.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import type { Settings, ThemeName, UnitSystem, Vehicle } from '../../shared/types.ts';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface AppContextValue {
  settings: Settings | null;
  vehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  unitSystem: UnitSystem;
  theme: ThemeName;
  resolvedTheme: 'light' | 'dark';
  loading: boolean;
  error: string | null;
  toasts: Toast[];
  reload: () => Promise<void>;
  selectVehicle: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [systemDark, setSystemDark] = useState(systemPrefersDark());

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  const reload = useCallback(async () => {
    try {
      const [nextSettings, nextVehicles] = await Promise.all([
        api.settings(),
        api.list<Vehicle>('vehicles', { includeArchived: 'true' }),
      ]);
      setSettings(nextSettings);
      setVehicles(nextVehicles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const theme = settings?.theme ?? 'system';
  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const selectVehicle = useCallback(
    async (id: string) => {
      setSettings((current) => (current ? { ...current, activeVehicleId: id } : current));
      try {
        const updated = await api.updateSettings({ activeVehicleId: id });
        setSettings(updated);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Не удалось переключить автомобиль.', 'error');
      }
    },
    [notify],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings((current) => (current ? { ...current, ...patch } : current));
      try {
        const updated = await api.updateSettings(patch);
        setSettings(updated);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Не удалось сохранить настройки.', 'error');
      }
    },
    [notify],
  );

  const activeVehicle = useMemo(() => {
    if (!vehicles.length) return null;
    return vehicles.find((v) => v.id === settings?.activeVehicleId) ?? vehicles[0];
  }, [vehicles, settings?.activeVehicleId]);

  const value: AppContextValue = {
    settings,
    vehicles,
    activeVehicle,
    unitSystem: settings?.unitSystem ?? 'metric',
    theme,
    resolvedTheme,
    loading,
    error,
    toasts,
    reload,
    selectVehicle,
    updateSettings,
    notify,
    dismissToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp должен вызываться внутри AppProvider');
  return context;
}
