/** Расходы: ТО, ремонт, страховка, налоги, мойка, шины, штрафы и прочее. */

import React, { useState } from 'react';
import { api, photoUrl } from '../api.ts';
import { useApp } from '../store.tsx';
import { useCollection } from '../hooks/useLoad.ts';
import { Badge, Button, Card, DataTable, EmptyState, ErrorNote, Field, Loader, NumberInput, Select, TextInput } from '../ui.tsx';
import { formatDate, formatMoney, formatOdometer, todayISO } from '../../../shared/format.ts';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from '../../../shared/constants.ts';
import type { Expense } from '../../../shared/types.ts';
import { toDisplayDistance, toStoredDistance } from '../utils/units.ts';
import PhotoField from '../components/PhotoField.tsx';

export default function ExpensesPage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const { rows, loading, error, reload } = useCollection<Expense>('expenses', vehicleId);
  const [form, setForm] = useState({
    date: todayISO(),
    category: 'maintenance',
    amount: '',
    odometer: '',
    vendor: '',
    description: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api.create<Expense>('expenses', {
        vehicleId,
        date: form.date,
        category: form.category,
        amount: Number(form.amount.replace(',', '.')) || 0,
        odometer: form.odometer ? toStoredDistance(Number(form.odometer.replace(',', '.')), unitSystem) : null,
        vendor: form.vendor,
        description: form.description,
        photoId,
        notes: form.notes,
      });
      notify('Расход добавлен.', 'success');
      setForm({ ...form, amount: '', description: '', notes: '' });
      setPhotoId(null);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить расход.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Expense) => {
    if (!window.confirm(`Удалить расход «${row.description || EXPENSE_CATEGORY_LABELS[row.category]}» от ${formatDate(row.date)}?`)) return;
    try {
      await api.remove('expenses', row.id);
      notify('Расход удалён.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить расход.', 'error');
    }
  };

  const total = rows.reduce((acc, row) => acc + row.amount, 0);

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  return (
    <div className="stack">
      <Card title="Новый расход" subtitle="Любая трата, кроме топлива: ТО, ремонт, страховка, налог, мойка, шины">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Дата">
            <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label="Категория">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>
                  {EXPENSE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Сумма, ₽">
            <NumberInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          <Field label={unitSystem === 'imperial' ? 'Одометр, миль' : 'Одометр, км'} hint="необязательно">
            <NumberInput value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
          </Field>
          <Field label="Исполнитель">
            <TextInput value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="СТО, магазин, страховая" />
          </Field>
          <Field label="Описание">
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Замена масла и фильтров" />
          </Field>
          <div className="form-grid__wide form-actions">
            <PhotoField photoId={photoId} onChange={setPhotoId} onError={(message) => notify(message, 'error')} />
            <p className="form-hint">Фото — это исходник. В резервную копию попадают данные, а не снимок: внесите объём и сумму из чека, и запись будет полной даже без фотографии.</p>
            <span className="hint-line">Всего расходов: {formatMoney(total)}</span>
            <Button variant="primary" type="submit" disabled={busy || !vehicleId}>
              Добавить расход
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Все расходы · ${rows.length}`} subtitle={`Итого ${formatMoney(total)}`}>
        {error && <ErrorNote message={error} />}
        {loading ? (
          <Loader />
        ) : (
          <DataTable<Expense>
            rows={rows}
            onDelete={(row) => void remove(row)}
            empty={<EmptyState title="Расходов нет" text="Добавьте первую трату — она появится в структуре расходов на дашборде." />}
            columns={[
              { key: 'date', title: 'Дата', render: (row) => formatDate(row.date) },
              { key: 'category', title: 'Категория', render: (row) => <Badge tone="neutral">{EXPENSE_CATEGORY_LABELS[row.category]}</Badge> },
              { key: 'description', title: 'Описание', render: (row) => row.description || '—' },
              { key: 'vendor', title: 'Исполнитель', render: (row) => row.vendor || '—' },
              {
                key: 'odometer',
                title: unitSystem === 'imperial' ? 'Одометр, миль' : 'Одометр, км',
                align: 'right',
                render: (row) => (row.odometer === null ? '—' : formatOdometer(toDisplayDistance(row.odometer, unitSystem), '')),
              },
              { key: 'amount', title: 'Сумма', align: 'right', render: (row) => formatMoney(row.amount) },
              {
                key: 'photo',
                title: 'Чек',
                render: (row) =>
                  row.photoId ? (
                    <a href={photoUrl(row.photoId)} target="_blank" rel="noreferrer" className="photo-thumb">
                      <img src={photoUrl(row.photoId)} alt="Фото чека" />
                    </a>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
