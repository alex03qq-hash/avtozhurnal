/** Обслуживание: регламенты ТО, напоминания по пробегу и дате, прогноз износа деталей. */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Kpi, Loader, NumberInput, ProgressBar, Select, StatusBadge, TextInput } from '../ui.tsx';
import { formatDate, formatOdometer, todayISO } from '../../../shared/format.ts';
import type { ServiceRule, WearStatus } from '../../../shared/types.ts';
import { toDisplayDistance, toStoredDistance } from '../utils/units.ts';

const EMPTY_RULE = {
  name: '',
  intervalKm: '',
  intervalDays: '',
  componentLifeKm: '',
  lastServiceOdometer: '',
  lastServiceDate: '',
  warnKmBefore: '1000',
  warnDaysBefore: '14',
};

export default function ServicePage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const reminders = useLoad(() => api.reminders(vehicleId), [vehicleId], { odometer: 0, items: [] as Array<WearStatus & { rule: ServiceRule | null }> });
  const [form, setForm] = useState({ ...EMPTY_RULE });
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  const reload = reminders.reload;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api.create<ServiceRule>('rules', {
        vehicleId,
        name: form.name,
        intervalKm: form.intervalKm ? toStoredDistance(Number(form.intervalKm.replace(',', '.')), unitSystem) : null,
        intervalDays: form.intervalDays ? Number(form.intervalDays) : null,
        componentLifeKm: form.componentLifeKm ? toStoredDistance(Number(form.componentLifeKm.replace(',', '.')), unitSystem) : null,
        lastServiceOdometer: form.lastServiceOdometer ? toStoredDistance(Number(form.lastServiceOdometer.replace(',', '.')), unitSystem) : null,
        lastServiceDate: form.lastServiceDate || null,
        warnKmBefore: Number(form.warnKmBefore) || 0,
        warnDaysBefore: Number(form.warnDaysBefore) || 0,
      });
      notify('Регламент добавлен.', 'success');
      setForm({ ...EMPTY_RULE });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить регламент.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const complete = async (ruleId: string) => {
    setCompleting(ruleId);
    try {
      await api.completeRule(ruleId);
      notify('Отмечено выполнение: пробег и дата замены обновлены.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось отметить выполнение.', 'error');
    } finally {
      setCompleting(null);
    }
  };

  const remove = async (item: WearStatus) => {
    if (!window.confirm(`Удалить регламент «${item.name}»?`)) return;
    try {
      await api.remove('rules', item.ruleId);
      notify('Регламент удалён.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить регламент.', 'error');
    }
  };

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  const items = reminders.data.items;
  const overdue = items.filter((i) => i.status === 'overdue').length;
  const soon = items.filter((i) => i.status === 'soon').length;

  return (
    <div className="stack">
      <div className="kpi-grid kpi-grid--3">
        <Kpi label="Текущий пробег" value={formatOdometer(toDisplayDistance(reminders.data.odometer, unitSystem))} hint="по последним показаниям одометра" />
        <Kpi label="Просрочено" value={overdue} hint="нужно заменить как можно скорее" tone={overdue ? 'bad' : 'good'} />
        <Kpi label="Скоро потребуется" value={soon} hint="подходит к сроку замены" tone={soon ? 'warn' : 'default'} />
      </div>

      <Card title="Регламенты и износ" subtitle="Статус считается и по пробегу, и по дате — берётся более срочный">
        {reminders.error && <ErrorNote message={reminders.error} />}
        {reminders.loading ? (
          <Loader />
        ) : items.length === 0 ? (
          <EmptyState title="Регламентов нет" text="Добавьте первый регламент — например, «Замена масла каждые 10 000 км»." />
        ) : (
          <ul className="rule-list">
            {items.map((item) => (
              <li key={item.ruleId} className="rule rule--card">
                <div className="rule__head">
                  <div>
                    <span className="rule__name">{item.name}</span>
                    <div className="rule__meta">
                      {item.rule?.intervalKm ? <span>интервал {formatOdometer(toDisplayDistance(item.rule.intervalKm, unitSystem))}</span> : null}
                      {item.rule?.intervalDays ? <span>каждые {item.rule.intervalDays} дн.</span> : null}
                      {item.rule?.lastServiceDate ? <span>прошлая замена {formatDate(item.rule.lastServiceDate)}</span> : null}
                      {item.rule?.lastServiceOdometer ? <span>на пробеге {formatOdometer(toDisplayDistance(item.rule.lastServiceOdometer, unitSystem))}</span> : null}
                    </div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                <div className="rule__facts">
                  <div>
                    <span className="rule__fact-label">Осталось</span>
                    <span className="rule__fact-value">
                      {item.remainingKm === null ? '—' : formatOdometer(toDisplayDistance(Math.abs(item.remainingKm), unitSystem))}
                    </span>
                    {item.remainingKm !== null && item.remainingKm < 0 && <Badge tone="bad">просрочено</Badge>}
                  </div>
                  <div>
                    <span className="rule__fact-label">По дате</span>
                    <span className="rule__fact-value">{item.remainingDays === null ? '—' : `${item.remainingDays} дн.`}</span>
                  </div>
                  <div>
                    <span className="rule__fact-label">Следующая замена</span>
                    <span className="rule__fact-value">
                      {item.nextServiceDate ? formatDate(item.nextServiceDate) : '—'}
                      {item.nextServiceOdometer ? ` / ${formatOdometer(toDisplayDistance(item.nextServiceOdometer, unitSystem))}` : ''}
                    </span>
                  </div>
                  <div className="rule__fact-grow">
                    <span className="rule__fact-label">Износ детали {item.percentUsed === null ? '' : `· ${item.percentUsed.toFixed(1).replace('.', ',')} %`}</span>
                    <ProgressBar percent={item.percentUsed ?? 0} tone={(item.percentUsed ?? 0) >= 100 ? 'bad' : (item.percentUsed ?? 0) >= 80 ? 'warn' : 'accent'} />
                  </div>
                </div>

                <div className="rule__actions">
                  <Button size="sm" variant="primary" onClick={() => void complete(item.ruleId)} disabled={completing === item.ruleId}>
                    {completing === item.ruleId ? 'Сохраняем…' : 'Отметить выполненным'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(item)}>
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Новый регламент" subtitle="Укажите интервал по пробегу, по времени или оба — приложение выберет более срочный">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Название">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Замена масла" required />
          </Field>
          <Field label={unitSystem === 'imperial' ? 'Интервал, миль' : 'Интервал, км'}>
            <NumberInput value={form.intervalKm} onChange={(e) => setForm({ ...form, intervalKm: e.target.value })} placeholder="10000" />
          </Field>
          <Field label="Интервал, дней">
            <NumberInput value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} placeholder="365" />
          </Field>
          <Field label={unitSystem === 'imperial' ? 'Ресурс детали, миль' : 'Ресурс детали, км'} hint="для прогноза износа в процентах">
            <NumberInput value={form.componentLifeKm} onChange={(e) => setForm({ ...form, componentLifeKm: e.target.value })} placeholder="15000" />
          </Field>
          <Field label="Пробег последней замены">
            <NumberInput value={form.lastServiceOdometer} onChange={(e) => setForm({ ...form, lastServiceOdometer: e.target.value })} />
          </Field>
          <Field label="Дата последней замены">
            <TextInput type="date" value={form.lastServiceDate} onChange={(e) => setForm({ ...form, lastServiceDate: e.target.value })} />
          </Field>
          <Field label="Предупреждать за, км">
            <Select value={form.warnKmBefore} onChange={(e) => setForm({ ...form, warnKmBefore: e.target.value })}>
              {['0', '500', '1000', '2000', '3000', '5000'].map((value) => (
                <option key={value} value={value}>
                  {value} км
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Предупреждать за, дней">
            <Select value={form.warnDaysBefore} onChange={(e) => setForm({ ...form, warnDaysBefore: e.target.value })}>
              {['0', '7', '14', '30', '60'].map((value) => (
                <option key={value} value={value}>
                  {value} дней
                </option>
              ))}
            </Select>
          </Field>
          <div className="form-grid__wide form-actions">
            <span className="hint-line">Сегодня {formatDate(todayISO())}</span>
            <Button variant="primary" type="submit" disabled={busy || !vehicleId}>
              Добавить регламент
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
