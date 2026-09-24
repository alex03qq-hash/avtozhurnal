/** Журнал поездок: стоимость и прибыль каждой поездки считаются по среднему расходу. */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Button, Card, DataTable, EmptyState, ErrorNote, Field, Kpi, Loader, NumberInput, TextInput } from '../ui.tsx';
import { formatDate, formatMoney, formatNumber, todayISO } from '../../../shared/format.ts';
import type { Trip } from '../../../shared/types.ts';
import { formatConsumptionForUnit, toDisplayDistance, toStoredDistance } from '../utils/units.ts';

export default function TripsPage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const summary = useLoad(() => api.trips(vehicleId), [vehicleId], { averageConsumption: null, averagePrice: null, trips: [] });
  const [form, setForm] = useState({ date: todayISO(), distance: '', purpose: '', durationMinutes: '', revenue: '' });
  const [busy, setBusy] = useState(false);

  const reload = summary.reload;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api.create<Trip>('trips', {
        vehicleId,
        date: form.date,
        distance: toStoredDistance(Number(form.distance.replace(',', '.')) || 0, unitSystem),
        purpose: form.purpose,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        revenue: form.revenue ? Number(form.revenue.replace(',', '.')) : null,
      });
      notify('Поездка добавлена.', 'success');
      setForm({ ...form, distance: '', purpose: '', durationMinutes: '', revenue: '' });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить поездку.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Trip) => {
    if (!window.confirm(`Удалить поездку от ${formatDate(row.date)}?`)) return;
    try {
      await api.remove('trips', row.id);
      notify('Поездка удалена.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить поездку.', 'error');
    }
  };

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  const trips = summary.data.trips;
  const totalDistance = trips.reduce((acc, trip) => acc + trip.distance, 0);
  const totalProfit = trips.reduce((acc, trip) => acc + (trip.estimatedProfit ?? 0), 0);

  return (
    <div className="stack">
      <div className="kpi-grid kpi-grid--3">
        <Kpi
          label="Средний расход"
          value={formatConsumptionForUnit(summary.data.averageConsumption, unitSystem, activeVehicle?.fuelType === 'electric')}
          hint="база для расчёта стоимости поездки"
        />
        <Kpi label="Средняя цена топлива" value={formatMoney(summary.data.averagePrice)} hint="по всем заправкам" />
        <Kpi label="Прибыль по журналу" value={formatMoney(totalProfit)} hint={`пробег ${formatNumber(toDisplayDistance(totalDistance, unitSystem), 0)} ${unitSystem === 'imperial' ? 'миль' : 'км'}`} tone={totalProfit < 0 ? 'bad' : 'good'} />
      </div>

      <Card title="Новая поездка" subtitle="Стоимость считается автоматически по среднему расходу и средней цене топлива">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Дата">
            <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label={`Расстояние, ${unitSystem === 'imperial' ? 'миль' : 'км'}`}>
            <NumberInput value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} required />
          </Field>
          <Field label="Цель поездки">
            <TextInput value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Аэропорт, доставка, дача" />
          </Field>
          <Field label="Длительность, мин" hint="необязательно">
            <NumberInput value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          </Field>
          <Field label="Выручка, ₽" hint="если поездка принесла деньги">
            <NumberInput value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} />
          </Field>
          <div className="form-grid__wide form-actions">
            <span className="hint-line">{trips.length} поездок в журнале</span>
            <Button variant="primary" type="submit" disabled={busy || !vehicleId}>
              Добавить поездку
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Журнал поездок · ${trips.length}`}>
        {summary.error && <ErrorNote message={summary.error} />}
        {summary.loading ? (
          <Loader />
        ) : (
          <DataTable
            rows={trips}
            onDelete={(row) => void remove(row)}
            empty={<EmptyState title="Поездок нет" text="Добавьте поездку, чтобы увидеть её себестоимость и прибыль." />}
            columns={[
              { key: 'date', title: 'Дата', render: (row) => formatDate(row.date) },
              { key: 'purpose', title: 'Цель', render: (row) => row.purpose || '—' },
              {
                key: 'distance',
                title: unitSystem === 'imperial' ? 'Расстояние, миль' : 'Расстояние, км',
                align: 'right',
                render: (row) => formatNumber(toDisplayDistance(row.distance, unitSystem), 0),
              },
              { key: 'duration', title: 'Время', align: 'right', render: (row) => (row.durationMinutes ? `${row.durationMinutes} мин` : '—') },
              { key: 'cost', title: 'Себестоимость', align: 'right', render: (row) => formatMoney(row.estimatedCost) },
              { key: 'revenue', title: 'Выручка', align: 'right', render: (row) => formatMoney(row.revenue) },
              {
                key: 'profit',
                title: 'Прибыль',
                align: 'right',
                render: (row) => <span className={row.estimatedProfit !== null && row.estimatedProfit < 0 ? 'is-negative' : ''}>{formatMoney(row.estimatedProfit)}</span>,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
