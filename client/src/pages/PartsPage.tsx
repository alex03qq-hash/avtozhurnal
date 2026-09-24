/** Склад запчастей: артикулы, цены и даты установки — с копированием артикула в буфер. */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useCollection } from '../hooks/useLoad.ts';
import { Button, Card, DataTable, EmptyState, ErrorNote, Field, Loader, NumberInput, TextInput } from '../ui.tsx';
import { formatDate, formatMoney, formatOdometer } from '../../../shared/format.ts';
import type { Part } from '../../../shared/types.ts';
import { toDisplayDistance, toStoredDistance } from '../utils/units.ts';

export default function PartsPage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const { rows, loading, error, reload } = useCollection<Part>('parts', vehicleId);
  const [form, setForm] = useState({ name: '', article: '', vendor: '', price: '', quantity: '1', installDate: '', installOdometer: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api.create<Part>('parts', {
        vehicleId,
        name: form.name,
        article: form.article,
        vendor: form.vendor,
        price: Number(form.price.replace(',', '.')) || 0,
        quantity: Number(form.quantity.replace(',', '.')) || 1,
        installDate: form.installDate || null,
        installOdometer: form.installOdometer ? toStoredDistance(Number(form.installOdometer.replace(',', '.')), unitSystem) : null,
      });
      notify('Запчасть добавлена в склад.', 'success');
      setForm({ name: '', article: '', vendor: '', price: '', quantity: '1', installDate: '', installOdometer: '' });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить запчасть.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Part) => {
    if (!window.confirm(`Удалить «${row.name}» из склада?`)) return;
    try {
      await api.remove('parts', row.id);
      notify('Запчасть удалена.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить запчасть.', 'error');
    }
  };

  const copyArticle = async (article: string) => {
    try {
      await navigator.clipboard.writeText(article);
      notify(`Артикул «${article}» скопирован.`, 'success');
    } catch {
      notify('Браузер не разрешил копирование — выделите артикул вручную.', 'error');
    }
  };

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  const total = rows.reduce((acc, row) => acc + row.price * row.quantity, 0);

  return (
    <div className="stack">
      <Card title="Добавить запчасть" subtitle="Артикул пригодится при поиске в магазинах — его можно скопировать одной кнопкой">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Название">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Фильтр масляный" required />
          </Field>
          <Field label="Артикул">
            <TextInput value={form.article} onChange={(e) => setForm({ ...form, article: e.target.value })} placeholder="MANN W 914/2" />
          </Field>
          <Field label="Где куплено">
            <TextInput value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Exist, Ozon…" />
          </Field>
          <Field label="Цена, ₽">
            <NumberInput value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="Количество">
            <NumberInput value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </Field>
          <Field label="Дата установки" hint="необязательно">
            <TextInput type="date" value={form.installDate} onChange={(e) => setForm({ ...form, installDate: e.target.value })} />
          </Field>
          <Field label={unitSystem === 'imperial' ? 'Пробег установки, миль' : 'Пробег установки, км'}>
            <NumberInput value={form.installOdometer} onChange={(e) => setForm({ ...form, installOdometer: e.target.value })} />
          </Field>
          <div className="form-grid__wide form-actions">
            <span className="hint-line">Стоимость склада: {formatMoney(total)}</span>
            <Button variant="primary" type="submit" disabled={busy || !vehicleId}>
              Добавить в склад
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Склад запчастей · ${rows.length}`}>
        {error && <ErrorNote message={error} />}
        {loading ? (
          <Loader />
        ) : (
          <DataTable<Part>
            rows={rows}
            onDelete={(row) => void remove(row)}
            empty={<EmptyState title="Склад пуст" text="Добавьте запчасти, которые лежат в запасе или уже установлены." />}
            columns={[
              { key: 'name', title: 'Название', render: (row) => row.name },
              {
                key: 'article',
                title: 'Артикул',
                render: (row) =>
                  row.article ? (
                    <button type="button" className="article" onClick={() => void copyArticle(row.article)} title="Скопировать артикул">
                      {row.article} ⧉
                    </button>
                  ) : (
                    '—'
                  ),
              },
              { key: 'vendor', title: 'Магазин', render: (row) => row.vendor || '—' },
              { key: 'price', title: 'Цена', align: 'right', render: (row) => formatMoney(row.price) },
              { key: 'quantity', title: 'Кол-во', align: 'right', render: (row) => row.quantity },
              { key: 'install', title: 'Установлено', render: (row) => (row.installDate ? `${formatDate(row.installDate)}${row.installOdometer ? ` · ${formatOdometer(toDisplayDistance(row.installOdometer, unitSystem))}` : ''}` : 'в запасе') },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
