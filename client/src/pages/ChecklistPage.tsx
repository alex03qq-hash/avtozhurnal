/** Контрольный список перед выездом: давление в шинах, уровни, свет, аптечка. */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useCollection } from '../hooks/useLoad.ts';
import { Button, Card, EmptyState, ErrorNote, Field, Loader, TextInput } from '../ui.tsx';
import { formatDate, todayISO } from '../../../shared/format.ts';
import type { ChecklistItem } from '../../../shared/types.ts';

export default function ChecklistPage() {
  const { activeVehicle, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const { rows, loading, error, reload } = useCollection<ChecklistItem>('checklist', vehicleId);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = async (item: ChecklistItem) => {
    try {
      await api.update<ChecklistItem>('checklist', item.id, {
        isChecked: !item.isChecked,
        lastCheckedAt: !item.isChecked ? todayISO() : null,
      });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось обновить пункт.', 'error');
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.create<ChecklistItem>('checklist', { vehicleId: null, label, order: (rows[rows.length - 1]?.order ?? 0) + 1 });
      setLabel('');
      notify('Пункт добавлен.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось добавить пункт.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: ChecklistItem) => {
    if (!window.confirm(`Удалить пункт «${item.label}»?`)) return;
    try {
      await api.remove('checklist', item.id);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить пункт.', 'error');
    }
  };

  const reset = async () => {
    try {
      await Promise.all(rows.map((item) => api.update('checklist', item.id, { isChecked: false, lastCheckedAt: null })));
      notify('Галочки сняты — можно проверять машину заново.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сбросить галочки.', 'error');
    }
  };

  const done = rows.filter((row) => row.isChecked).length;

  return (
    <div className="stack">
      <Card
        title={`Проверка перед выездом · ${done} из ${rows.length}`}
        subtitle="Пункты хранятся в базе: можно закрыть приложение и вернуться к проверке позже"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void reset()} disabled={!rows.length}>
            Сбросить галочки
          </Button>
        }
      >
        {error && <ErrorNote message={error} />}
        {loading ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyState title="Список пуст" text="Добавьте пункты, которые важно проверять перед поездкой." />
        ) : (
          <ul className="checklist">
            {rows.map((item) => (
              <li key={item.id} className={`checklist__item ${item.isChecked ? 'is-done' : ''}`}>
                <label className="checklist__label">
                  <input type="checkbox" checked={item.isChecked} onChange={() => void toggle(item)} />
                  <span>{item.label}</span>
                </label>
                <div className="checklist__side">
                  {item.lastCheckedAt && <span className="checklist__date">проверено {formatDate(item.lastCheckedAt)}</span>}
                  <Button size="sm" variant="ghost" onClick={() => void remove(item)}>
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Добавить пункт">
        <form className="form-grid" onSubmit={add}>
          <Field label="Что проверяем" className="form-grid__wide-sm">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Например: давление в шинах" required />
          </Field>
          <div className="form-actions">
            <Button variant="primary" type="submit" disabled={busy}>
              Добавить
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
