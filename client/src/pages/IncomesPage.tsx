/** Доходы: работа в такси, доставка, сдача в аренду — чтобы видеть реальную прибыль. */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useCollection } from '../hooks/useLoad.ts';
import { Badge, Button, Card, DataTable, EmptyState, ErrorNote, Field, Loader, NumberInput, Select, TextInput } from '../ui.tsx';
import { formatDate, formatMoney, todayISO } from '../../../shared/format.ts';
import { INCOME_SOURCE_LABELS } from '../../../shared/constants.ts';
import type { Income } from '../../../shared/types.ts';

export default function IncomesPage() {
  const { activeVehicle, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const { rows, loading, error, reload } = useCollection<Income>('incomes', vehicleId);
  const [form, setForm] = useState({ date: todayISO(), amount: '', source: 'taxi', description: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api.create<Income>('incomes', {
        vehicleId,
        date: form.date,
        amount: Number(form.amount.replace(',', '.')) || 0,
        source: form.source,
        description: form.description,
      });
      notify('Доход добавлен.', 'success');
      setForm({ ...form, amount: '', description: '' });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить доход.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Income) => {
    if (!window.confirm(`Удалить доход от ${formatDate(row.date)} на ${formatMoney(row.amount)}?`)) return;
    try {
      await api.remove('incomes', row.id);
      notify('Доход удалён.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить доход.', 'error');
    }
  };

  const total = rows.reduce((acc, row) => acc + row.amount, 0);

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  return (
    <div className="stack">
      <Card title="Новый доход" subtitle="Если машина зарабатывает — фиксируйте выручку, чтобы видеть чистую прибыль">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Дата">
            <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label="Источник">
            <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {Object.entries(INCOME_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Сумма, ₽">
            <NumberInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          <Field label="Описание">
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Смена в такси" />
          </Field>
          <div className="form-grid__wide form-actions">
            <span className="hint-line">Всего доходов: {formatMoney(total)}</span>
            <Button variant="primary" type="submit" disabled={busy || !vehicleId}>
              Добавить доход
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Все доходы · ${rows.length}`} subtitle={`Итого ${formatMoney(total)}`}>
        {error && <ErrorNote message={error} />}
        {loading ? (
          <Loader />
        ) : (
          <DataTable<Income>
            rows={rows}
            onDelete={(row) => void remove(row)}
            empty={<EmptyState title="Доходов нет" text="Если машина не зарабатывает — этот раздел можно не заполнять." />}
            columns={[
              { key: 'date', title: 'Дата', render: (row) => formatDate(row.date) },
              { key: 'source', title: 'Источник', render: (row) => <Badge tone="accent">{INCOME_SOURCE_LABELS[row.source]}</Badge> },
              { key: 'description', title: 'Описание', render: (row) => row.description || '—' },
              { key: 'amount', title: 'Сумма', align: 'right', render: (row) => formatMoney(row.amount) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
