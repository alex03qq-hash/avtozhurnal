/** Обслуживание: регламенты ТО, напоминания по пробегу и дате, прогноз износа деталей. */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { USAGE_MULTIPLIERS } from '../utils/usage.ts';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, InfoNote, Kpi, Loader, Modal, NumberInput, ProgressBar, Select, StatusBadge, TextArea, TextInput } from '../ui.tsx';
import { formatDate, formatMoney, formatOdometer, todayISO } from '../../../shared/format.ts';
import type { Estimate, EstimateItem, ServiceRule, WearStatus } from '../../../shared/types.ts';
import { toStoredDistance as storeDistance, toDisplayDistance as showDistance } from '../utils/units.ts';
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
  // Пакеты регламентов производителя: подбор идёт по марке, модели, годам и топливу.
  const packs = useLoad(() => api.regulationMatch(vehicleId), [vehicleId], { vehicleId: '', packs: [], generic: [] });
  const [applyMode, setApplyMode] = useState<'add-missing' | 'update-untouched' | 'replace-all'>('update-untouched');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.regulationPreview>> | null>(null);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  // Правка регламента: без неё человек удалял бы пункт и создавал заново, теряя историю замен.
  const [editing, setEditing] = useState<ServiceRule | null>(null);
  // Смета на ТО: черновик по пункту регламента, цены подсказываются по истории журнала.
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof api.estimateDraft>> | null>(null);
  const savedEstimates = useLoad(() => api.estimates(vehicleId), [vehicleId], [] as Estimate[]);
  const [busyEstimate, setBusyEstimate] = useState(false);

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

  const saveRule = async () => {
    if (!editing) return;
    try {
      await api.update<ServiceRule>('rules', editing.id, {
        name: editing.name,
        intervalKm: editing.intervalKm,
        intervalDays: editing.intervalDays,
        componentLifeKm: editing.componentLifeKm,
        lastServiceOdometer: editing.lastServiceOdometer,
        lastServiceDate: editing.lastServiceDate,
        notes: editing.notes,
      });
      setEditing(null);
      notify('Регламент обновлён. Ваши интервалы защищены от перезаписи пакетом.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить регламент.', 'error');
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

  const runPreview = async (packId: string) => {
    setBusyPack(packId);
    try {
      setPreview(await api.regulationPreview({ vehicleId, packId, mode: applyMode }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось построить предпросмотр.', 'error');
    } finally {
      setBusyPack(null);
    }
  };

  const runApply = async () => {
    if (!preview) return;
    setBusyPack(preview.packId);
    try {
      const result = await api.regulationApply({ vehicleId, packId: preview.packId, mode: applyMode });
      notify(result.message, 'success');
      setPreview(null);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось применить регламент.', 'error');
    } finally {
      setBusyPack(null);
    }
  };

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  const usageMultiplier = USAGE_MULTIPLIERS[activeVehicle.usageClass ?? 'normal'];

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

      <Card
        className="no-print"
        title="Регламент производителя"
        subtitle="Локальные пакеты: приложение подбирает подходящий по марке, модели, годам и типу топлива"
      >
        {packs.data.packs.length === 0 && packs.data.generic.length === 0 ? (
          <InfoNote>
            Для вашего автомобиля пакет не найден. Пакеты лежат файлами в папке <code>data/regulations/packs</code> —
            их можно добавить вручную или импортировать в «Настройках». Свои регламенты при этом никуда не пропадают.
          </InfoNote>
        ) : (
          <>
            <ul className="pack-list">
              {packs.data.packs.map((pack) => (
                <li key={pack.packId} className="pack">
                  <div className="pack__head">
                    <span className="pack__title">{pack.title}</span>
                    <Badge tone="accent">{pack.items} пунктов</Badge>
                  </div>
                  <p className="pack__source">{pack.disclaimer}</p>
                  <div className="pack__actions">
                    <Button size="sm" variant="secondary" onClick={() => void runPreview(pack.packId)} disabled={busyPack === pack.packId}>
                      {busyPack === pack.packId ? 'Считаем…' : 'Предпросмотр изменений'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="pack-modes">
              <Field label="Что делать с пунктами, которые у меня уже есть">
                <Select value={applyMode} onChange={(e) => setApplyMode(e.target.value as typeof applyMode)}>
                  <option value="add-missing">Добавить только недостающие</option>
                  <option value="update-untouched">Обновить неизменённые, мои правки сохранить</option>
                  <option value="replace-all">Заменить всё по регламенту</option>
                </Select>
              </Field>
              <span className="hint-line">
                Ваши интервалы, изменённые вручную, защищены: при обновлении пакета они сохраняются.
              </span>
            </div>

            {packs.data.generic.length > 0 && (
              <div className="pack-generic">
                <h3 className="settings-subtitle">Общие пакеты без привязки к модели</h3>
                <p className="hint-line">Их не подбираем автоматически — применяйте осознанно.</p>
                <ul className="pack-list">
                  {packs.data.generic.map((pack) => (
                    <li key={pack.packId} className="pack">
                      <div className="pack__head">
                        <span className="pack__title">{pack.title}</span>
                        <Badge tone="neutral">{pack.items} пунктов</Badge>
                      </div>
                      <p className="pack__source">{pack.disclaimer}</p>
                      <Button size="sm" variant="secondary" onClick={() => void runPreview(pack.packId)}>
                        Предпросмотр изменений
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview && (
              <div className="pack-preview">
                <p className="pack-preview__summary">
                  {preview.packTitle}: добавить {preview.added}, обновить {preview.updated}, оставить как есть {preview.kept}.
                </p>
                <ul className="pack-preview__list">
                  {preview.preview.slice(0, 12).map((row) => (
                    <li key={row.code}>
                      <Badge tone={row.action === 'add' ? 'good' : row.action === 'update' ? 'accent' : 'neutral'}>
                        {row.action === 'add' ? 'новый' : row.action === 'update' ? 'обновить' : 'не трогаем'}
                      </Badge>
                      <span>{row.name}</span>
                      <span className="hint-line">{row.reason}</span>
                    </li>
                  ))}
                </ul>
                <div className="button-row">
                  <Button variant="primary" onClick={() => void runApply()} disabled={busyPack === preview.packId}>
                    Применить регламент
                  </Button>
                  <Button onClick={() => setPreview(null)}>Отмена</Button>
                </div>
                <p className="hint-line">{preview.disclaimer}</p>
              </div>
            )}
          </>
        )}
      </Card>

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
                      {item.rule?.origin === 'pack' ? <span>источник: {item.rule.packTitle ?? 'пакет регламента'}</span> : null}
                      {item.rule?.intervalDays ? <span>каждые {item.rule.intervalDays} дн.</span> : null}
                      {item.rule?.lastServiceDate ? <span>прошлая замена {formatDate(item.rule.lastServiceDate)}</span> : null}
                      {item.rule?.lastServiceOdometer ? <span>на пробеге {formatOdometer(toDisplayDistance(item.rule.lastServiceOdometer, unitSystem))}</span> : null}
                    </div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                {item.rule?.manufacturerIntervalKm ? (
                  <p className="rule__intervals">
                    Завод: {formatOdometer(toDisplayDistance(item.rule.manufacturerIntervalKm, unitSystem))} · с учётом условий
                    ({Math.round(usageMultiplier * 100)}%): {formatOdometer(toDisplayDistance(item.rule.intervalKm ?? 0, unitSystem))}
                    {item.rule.userOverridden ? ' · ваша настройка сохранена' : ''}
                  </p>
                ) : null}

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
                  <Button size="sm" variant="secondary" onClick={() => item.rule && setEditing({ ...item.rule })} disabled={!item.rule}>
                    Изменить
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!item.rule) return;
                      try {
                        setEstimate(await api.estimateDraft({ vehicleId: activeVehicle?.id, ruleId: item.rule.id }));
                      } catch (err) {
                        notify(err instanceof Error ? err.message : 'Не удалось собрать смету.', 'error');
                      }
                    }}
                  >
                    Смета
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

      <Card
        className="no-print"
        title="Сметы на ремонт"
        subtitle="Сколько будет стоить по вашим данным: цены подсказываются из истории покупок и трат"
      >
        {savedEstimates.data.length === 0 ? (
          <InfoNote>
            Смет пока нет. Нажмите «Смета» рядом с любым пунктом обслуживания — приложение соберёт состав работ
            из пакета регламента и подставит цены из вашей истории. Принятая смета превращается в обычный расход.
          </InfoNote>
        ) : (
          <ul className="estimate-list">
            {savedEstimates.data.map((row) => (
              <li key={row.id}>
                <span className="estimate-list__title">{row.title}</span>
                <span className="estimate-list__sum">{formatMoney(row.total)}</span>
                <span className="hint-line">
                  {row.status === 'accepted' ? 'расход создан' : `смета от ${formatDate(row.createdAt.slice(0, 10))}`}
                  {' · '}цены подтверждены на {Math.round(row.confidence * 100)}%
                </span>
                {row.status !== 'accepted' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const result = await api.estimateAccept(row.id);
                        notify(result.message, 'success');
                        await savedEstimates.reload();
                      } catch (err) {
                        notify(err instanceof Error ? err.message : 'Не удалось создать расход.', 'error');
                      }
                    }}
                  >
                    Создать расход
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api.estimateRemove(row.id);
                      await savedEstimates.reload();
                      notify('Смета удалена.', 'success');
                    } catch (err) {
                      notify(err instanceof Error ? err.message : 'Не удалось удалить смету.', 'error');
                    }
                  }}
                >
                  Удалить
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(estimate)}
        title="Смета на ТО"
        wide
        onClose={() => setEstimate(null)}
        footer={
          <>
            <Button onClick={() => setEstimate(null)}>Отмена</Button>
            <Button
              variant="secondary"
              disabled={busyEstimate}
              onClick={async () => {
                if (!estimate) return;
                setBusyEstimate(true);
                try {
                  await api.estimateCreate({ ...estimate, vehicleId: estimate.vehicleId });
                  await savedEstimates.reload();
                  setEstimate(null);
                  notify('Смета сохранена.', 'success');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Не удалось сохранить смету.', 'error');
                } finally {
                  setBusyEstimate(false);
                }
              }}
            >
              Сохранить смету
            </Button>
            <Button
              variant="primary"
              disabled={busyEstimate}
              onClick={async () => {
                if (!estimate) return;
                setBusyEstimate(true);
                try {
                  const created = await api.estimateCreate({ ...estimate, vehicleId: estimate.vehicleId });
                  const result = await api.estimateAccept(created.id);
                  await savedEstimates.reload();
                  setEstimate(null);
                  notify(result.message, 'success');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Не удалось создать расход.', 'error');
                } finally {
                  setBusyEstimate(false);
                }
              }}
            >
              Сохранить и создать расход
            </Button>
          </>
        }
      >
        {estimate && (
          <div className="estimate-form">
            <p className="hint-line">{estimate.notes}</p>
            <table className="estimate-table">
              <thead>
                <tr>
                  <th>Позиция</th>
                  <th className="is-right">Кол-во</th>
                  <th className="is-right">Цена, ₽</th>
                  <th className="is-right">Сумма</th>
                  <th>Откуда цена</th>
                </tr>
              </thead>
              <tbody>
                {estimate.parts.map((row, index) => (
                  <tr key={`${row.name}-${index}`}>
                    <td>
                      <TextInput
                        value={row.name}
                        onChange={(e) => {
                          const parts = [...estimate.parts];
                          parts[index] = { ...row, name: e.target.value };
                          setEstimate({ ...estimate, parts });
                        }}
                      />
                      {row.article && <span className="hint-line">артикул {row.article}</span>}
                    </td>
                    <td className="is-right">
                      <NumberInput
                        value={row.quantity}
                        onChange={(e) => {
                          const parts = [...estimate.parts];
                          parts[index] = { ...row, quantity: Number(e.target.value) || 1 };
                          setEstimate({ ...estimate, parts, total: 0 });
                        }}
                      />
                    </td>
                    <td className="is-right">
                      <NumberInput
                        value={row.unitPrice}
                        onChange={(e) => {
                          const parts = [...estimate.parts];
                          parts[index] = { ...row, unitPrice: Number(e.target.value) || 0, priceSource: 'manual', note: 'цена вписана вручную' };
                          setEstimate({ ...estimate, parts });
                        }}
                      />
                    </td>
                    <td className="is-right">{formatMoney(row.quantity * row.unitPrice)}</td>
                    <td className="hint-line">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="form-grid">
              <Field label="Часы работ">
                <NumberInput value={estimate.laborHours} onChange={(e) => setEstimate({ ...estimate, laborHours: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Ставка за час, ₽">
                <NumberInput
                  value={estimate.laborRatePerHour}
                  onChange={(e) => setEstimate({ ...estimate, laborRatePerHour: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>

            <p className="estimate-total">
              Итого: {formatMoney(
                estimate.parts.reduce((acc, row) => acc + row.quantity * row.unitPrice, 0) + estimate.laborHours * estimate.laborRatePerHour,
              )}
              <span className="hint-line">
                {' '}цены подтверждены историей на {Math.round(
                  (estimate.parts.filter((row) => row.priceSource !== 'manual').length / Math.max(1, estimate.parts.length)) * 100,
                )}%
              </span>
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Изменить регламент"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Отмена</Button>
            <Button variant="primary" onClick={() => void saveRule()}>
              Сохранить
            </Button>
          </>
        }
      >
        {editing && (
          <div className="form-grid">
            <Field label="Название">
              <TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field
              label={unitSystem === 'imperial' ? 'Интервал, миль' : 'Интервал, км'}
              hint={editing.manufacturerIntervalKm ? `заводской: ${formatOdometer(showDistance(editing.manufacturerIntervalKm, unitSystem))}` : undefined}
            >
              <NumberInput
                value={editing.intervalKm ?? ''}
                onChange={(e) => setEditing({ ...editing, intervalKm: e.target.value ? storeDistance(Number(e.target.value), unitSystem) : null })}
              />
            </Field>
            <Field label="Интервал, дней">
              <NumberInput value={editing.intervalDays ?? ''} onChange={(e) => setEditing({ ...editing, intervalDays: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Ресурс детали, км" hint="для процента износа; пусто — износ не считается">
              <NumberInput
                value={editing.componentLifeKm ?? ''}
                onChange={(e) => setEditing({ ...editing, componentLifeKm: e.target.value ? storeDistance(Number(e.target.value), unitSystem) : null })}
              />
            </Field>
            <Field label="Пробег последней замены">
              <NumberInput
                value={editing.lastServiceOdometer ?? ''}
                onChange={(e) => setEditing({ ...editing, lastServiceOdometer: e.target.value ? storeDistance(Number(e.target.value), unitSystem) : null })}
              />
            </Field>
            <Field label="Дата последней замены">
              <TextInput type="date" value={editing.lastServiceDate ?? ''} onChange={(e) => setEditing({ ...editing, lastServiceDate: e.target.value || null })} />
            </Field>
            <div className="form-grid__wide">
              <Field label="Заметки" hint="например, марка масла и артикулы — пакет их не затирает">
                <TextArea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </Field>
            </div>
            {editing.packTitle && (
              <p className="hint-line">
                Пункт из пакета «{editing.packTitle}» (ревизия {editing.packRevision ?? 1}).
                Изменённый вами интервал при обновлении пакета сохраняется.
              </p>
            )}
          </div>
        )}
      </Modal>

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
