/** Хук загрузки данных с состоянием «загрузка/ошибка/перезагрузить». */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await loader();
      if (current === version.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (current === version.current) setError(err instanceof Error ? err.message : 'Не удалось загрузить данные.');
    } finally {
      if (current === version.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

/** Хук списка записей коллекции с фильтром по автомобилю. */
export function useCollection<T>(collection: string, vehicleId?: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await api.list<T>(collection, vehicleId ? { vehicleId } : {});
      if (current === version.current) {
        setRows(result);
        setError(null);
      }
    } catch (err) {
      if (current === version.current) setError(err instanceof Error ? err.message : 'Не удалось загрузить список.');
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [collection, vehicleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, error, reload };
}
