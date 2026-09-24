/** Заправки и зарядки: быстрая запись + полный список. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useCollection, useLoad } from '../hooks/useLoad.ts';
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorNote, Field, Loader, Modal, NumberInput, Select, TextInput } from '../ui.tsx';
import { formatDate, formatMoney, formatNumber, formatOdometer, todayISO } from '../../../shared/format.ts';
import { FUEL_TYPE_LABELS } from '../../../shared/constants.ts';
import type { FuelEntry } from '../../../shared/types.ts';
import { priceLabel, toDisplayDistance, toDisplayPrice, toDisplayVolume, toStoredDistance, toStoredPrice, toStoredVolume, volumeLabel } from '../utils/units.ts';
import { priceFromTotal, volumeFromTotal } from '../../../shared/calc.ts';
import { useHashParam } from '../router.ts';
import PhotoField from '../components/PhotoField.tsx';
import { photoUrl } from '../api.ts';

interface FormState {
  date: string;
  odometer: string;
  volume: string;
  pricePerUnit: string;
  totalCost: string;
  fuelType: string;
  isFullTank: boolean;
  station: string;
  notes: string;
}

function emptyForm(fuelType: string, odometer: number): FormState {
  return {
    date: todayISO(),
    odometer: odometer ? String(Math.round(odometer)) : '',
    volume: '',
    pricePerUnit: '',
    totalCost: '',
    fuelType,
    isFullTank: true,
    station: '',
    notes: '',
  };
}

export default function FuelPage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const isElectric = activeVehicle?.fuelType === 'electric';
  const { rows, loading, error, reload } = useCollection<FuelEntry>('fuel', vehicleId);
  // Быстрое действие с домашнего экрана телефона открывает форму и ставит курсор в одометр.
  const startNew = useHashParam('new') === '1';
  const odometerRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(activeVehicle?.fuelType ?? 'petrol', 0));

  useEffect(() => {
    if (!startNew) return undefined;
    const timer = window.setTimeout(() => {
      odometerRef.current?.focus();
      odometerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [startNew]);
  const [editing, setEditing] = useState<FuelEntry | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  // Быстрый режим: главное на чеке — сумма и объём, цена за литр считается сама.
  const [mode, setMode] = useState<'quick' | 'full'>('quick');
  const stations = useLoad(() => api.stations(vehicleId), [vehicleId], []);
  const [busy, setBusy] = useState(false);

  const lastOdometer = useMemo(() => {
    const values = rows.map((row) => row.odometer);
    return values.length ? Math.max(...values) : activeVehicle?.initialOdometer ?? 0;
  }, [rows, activeVehicle?.initialOdometer]);

  const stationInfo = useMemo(
    () => stations.data.find((row) => row.station.trim().toLowerCase() === form.station.trim().toLowerCase()) ?? null,
    [stations.data, form.station],
  );

  const totalNumber = Number(form.totalCost.replace(',', '.')) || 0;
  const volumeNumber = Number(form.volume.replace(',', '.')) || 0;
  const priceFromInputs = priceFromTotal(totalNumber, volumeNumber);
  const suggestedVolume = volumeNumber ? null : volumeFromTotal(totalNumber, stationInfo?.lastPrice ?? null);

  const quick = useMemo(() => {
    const volume = Number(form.volume.replace(',', '.')) || 0;
    const price = Number(form.pricePerUnit.replace(',', '.')) || 0;
    const total = Number(form.totalCost.replace(',', '.')) || 0;
    if (total) return total;
    return Math.round(volume * price * 100) / 100;
  }, [form.volume, form.pricePerUnit, form.totalCost]);

  const buildPayload = (source: FormState) => {
    const total = Number(source.totalCost.replace(',', '.')) || quick;
    const volume = Number(source.volume.replace(',', '.')) || 0;
    // В быстром режиме цену за литр не спрашиваем: сервер посчитает её из суммы и объёма.
    const price = mode === 'quick' ? 0 : toStoredPrice(Number(source.pricePerUnit.replace(',', '.')) || 0, unitSystem);
    return {
      vehicleId,
      date: source.date,
      odometer: toStoredDistance(Number(source.odometer.replace(',', '.')) || 0, unitSystem),
      volume: toStoredVolume(volume, unitSystem),
      pricePerUnit: price,
      totalCost: total,
      fuelType: source.fuelType,
      isFullTank: source.isFullTank,
      station: source.station,
      photoId,
      notes: source.notes,
    };
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api.create<FuelEntry>('fuel', buildPayload(form));
      notify('Заправка добавлена.', 'success');
      setForm(emptyForm(activeVehicle?.fuelType ?? 'petrol', 0));
      setPhotoId(null);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить заправку.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.update<FuelEntry>('fuel', editing.id, {
        date: editing.date,
        odometer: editing.odometer,
        volume: editing.volume,
        pricePerUnit: editing.pricePerUnit,
        totalCost: editing.totalCost,
        station: editing.station,
        photoId: editing.photoId ?? null,
        isFullTank: editing.isFullTank,
        notes: editing.notes,
      });
      setEditing(null);
      notify('Запись обновлена.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось обновить запись.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: FuelEntry) => {
    if (!window.confirm(`Удалить заправку от ${formatDate(row.date)}?`)) return;
    try {
      await api.remove('fuel', row.id);
      notify('Запись удалена.', 'success');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить запись.', 'error');
    }
  };

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  return (
    <div className="stack">
      <Card
        className={startNew ? 'card--attention' : ''}
        title="Быстрая запись"
        subtitle={startNew ? 'Открыто быстрым действием: введите показание одометра' : 'Заполните объём и цену — сумма посчитается сама'}
      >
        <div className="mode-switch">
          <button
            type="button"
            className={`mode-switch__item ${mode === 'quick' ? 'is-active' : ''}`}
            onClick={() => setMode('quick')}
          >
            Быстро: сумма и объём
          </button>
          <button
            type="button"
            className={`mode-switch__item ${mode === 'full' ? 'is-active' : ''}`}
            onClick={() => setMode('full')}
          >
            Подробно: все поля
          </button>
        </div>

        <form className="form-grid" onSubmit={submit}>
          {mode === 'quick' ? (
            <>
              <Field label="Сумма по чеку, ₽" hint="главное число из чека">
                <NumberInput
                  className="input--big"
                  value={form.totalCost}
                  onChange={(e) => setForm({ ...form, totalCost: e.target.value })}
                  inputMode="decimal"
                />
              </Field>
              <Field label={`Объём, ${volumeLabel(unitSystem, isElectric)}`} hint="без него не считается расход">
                <NumberInput
                  className="input--big"
                  value={form.volume}
                  onChange={(e) => setForm({ ...form, volume: e.target.value })}
                />
              </Field>
              <Field label="АЗС" hint={stationInfo ? `здесь в среднем ${formatMoney(stationInfo.averagePrice)} за литр` : 'начните вводить название'}>
                <TextInput
                  list="station-list"
                  value={form.station}
                  onChange={(e) => setForm({ ...form, station: e.target.value })}
                  placeholder="Лукойл, Газпромнефть…"
                />
                <datalist id="station-list">
                  {stations.data.map((row) => (
                    <option key={row.station} value={row.station} />
                  ))}
                </datalist>
              </Field>
              <Field
                label="Одометр, км"
                hint={`в прошлый раз: ${formatOdometer(toDisplayDistance(lastOdometer, unitSystem))}`}
              >
                <NumberInput
                  inputRef={odometerRef}
                  value={form.odometer}
                  onChange={(e) => setForm({ ...form, odometer: e.target.value })}
                  placeholder={String(Math.round(toDisplayDistance(lastOdometer, unitSystem)))}
                />
              </Field>

              <div className="form-grid__wide quick-price">
                <span className="quick-price__value">
                  {priceFromInputs !== null ? `Цена: ${formatMoney(priceFromInputs)} за литр` : 'Цена за литр посчитается из суммы и объёма'}
                </span>
                {stationInfo && (
                  <span className="quick-price__hint">
                    На АЗС «{stationInfo.station}» в прошлый раз было {formatMoney(stationInfo.lastPrice)} за литр
                    {' '}({formatDate(stationInfo.lastDate)}).
                  </span>
                )}
                {suggestedVolume !== null && (
                  <span className="quick-price__hint">
                    При прошлой цене {formatMoney(stationInfo?.lastPrice ?? null)} сумма {formatMoney(totalNumber)} — это
                    {' '}
                    <strong>{formatNumber(suggestedVolume, 1)} л</strong>
                    {' '}
                    <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, volume: String(suggestedVolume) })}>
                      подставить
                    </Button>
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
          <Field label="Дата">
            <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label={`Одометр, ${unitSystem === 'imperial' ? 'миль' : 'км'}`} hint={`прошлое показание: ${formatOdometer(toDisplayDistance(lastOdometer, unitSystem))}`}>
            <NumberInput
              inputRef={odometerRef}
              value={form.odometer}
              onChange={(e) => setForm({ ...form, odometer: e.target.value })}
              placeholder={String(Math.round(toDisplayDistance(lastOdometer, unitSystem)))}
              required
            />
          </Field>
          <Field label={`Объём, ${volumeLabel(unitSystem, isElectric)}`}>
            <NumberInput value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} required />
          </Field>
          <Field label={priceLabel(unitSystem, isElectric)}>
            <NumberInput value={form.pricePerUnit} onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })} />
          </Field>
          <Field label="Сумма, ₽" hint={quick ? `автоматически: ${formatMoney(quick)}` : 'можно оставить пустым'}>
            <NumberInput value={form.totalCost} onChange={(e) => setForm({ ...form, totalCost: e.target.value })} />
          </Field>
          <Field label="Тип">
            <Select value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
              {Object.entries(FUEL_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="АЗС">
            <TextInput
              list="station-list"
              value={form.station}
              onChange={(e) => setForm({ ...form, station: e.target.value })}
              placeholder="Лукойл, Газпромнефть…"
            />
            <datalist id="station-list">
              {stations.data.map((row) => (
                <option key={row.station} value={row.station} />
              ))}
            </datalist>
          </Field>
            </>
          )}

          <div className="form-grid__wide form-actions">
            <Checkbox
              label="Заправка до полного бака (нужно для точного расхода)"
              checked={form.isFullTank}
              onChange={(e) => setForm({ ...form, isFullTank: e.target.checked })}
            />
            <PhotoField photoId={photoId} onChange={setPhotoId} onError={(message) => notify(message, 'error')} />
            <p className="form-hint">Фото — это исходник. В резервную копию попадают данные, а не снимок: внесите объём и сумму из чека, и запись будет полной даже без фотографии.</p>
          </div>
          <div className="form-grid__wide form-actions">
            <span className="hint-line">Дата: {formatDate(form.date)}</span>
            <Button variant="primary" type="submit" disabled={busy || !vehicleId}>
              Добавить заправку
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Все заправки · ${rows.length}`} subtitle="Новые записи сверху">
        {error && <ErrorNote message={error} />}
        {loading ? (
          <Loader />
        ) : (
          <DataTable<FuelEntry>
            rows={rows}
            onDelete={(row) => void remove(row)}
            empty={<EmptyState title="Заправок нет" text="Добавьте первую запись — и расход начнёт считаться автоматически." />}
            columns={[
              { key: 'date', title: 'Дата', render: (row) => formatDate(row.date) },
              {
                key: 'odometer',
                title: unitSystem === 'imperial' ? 'Одометр, миль' : 'Одометр, км',
                align: 'right',
                render: (row) => formatOdometer(toDisplayDistance(row.odometer, unitSystem), ''),
              },
              {
                key: 'volume',
                title: `Объём, ${volumeLabel(unitSystem, isElectric)}`,
                align: 'right',
                render: (row) => formatNumber(isElectric ? row.volume : toDisplayVolume(row.volume, unitSystem), 1),
              },
              { key: 'price', title: 'Цена', align: 'right', render: (row) => formatMoney(toDisplayPrice(row.pricePerUnit, unitSystem)) },
              { key: 'total', title: 'Сумма', align: 'right', render: (row) => formatMoney(row.totalCost) },
              { key: 'station', title: 'АЗС', render: (row) => row.station || '—' },
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
              {
                key: 'full',
                title: 'Полный бак',
                render: (row) => (row.isFullTank ? <Badge tone="good">полный</Badge> : <Badge>частично</Badge>),
              },
              {
                key: 'edit',
                title: '',
                align: 'right',
                render: (row) => (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    Изменить
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        title="Изменить заправку"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Отмена</Button>
            <Button variant="primary" onClick={() => void saveEdit()} disabled={busy}>
              Сохранить
            </Button>
          </>
        }
      >
        {editing && (
          <div className="form-grid">
            <Field label="Дата">
              <TextInput type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </Field>
            <Field
              label="Одометр, км"
              hint={unitSystem === 'imperial' ? 'значение хранится в километрах' : undefined}
            >
              <NumberInput value={editing.odometer} onChange={(e) => setEditing({ ...editing, odometer: Number(e.target.value) })} />
            </Field>
            <Field label="Объём, л" hint={unitSystem === 'imperial' ? 'значение хранится в литрах' : undefined}>
              <NumberInput value={editing.volume} onChange={(e) => setEditing({ ...editing, volume: Number(e.target.value) })} />
            </Field>
            <Field label="Цена за литр, ₽">
              <NumberInput value={editing.pricePerUnit} onChange={(e) => setEditing({ ...editing, pricePerUnit: Number(e.target.value) })} />
            </Field>
            <Field label="Сумма, ₽">
              <NumberInput value={editing.totalCost} onChange={(e) => setEditing({ ...editing, totalCost: Number(e.target.value) })} />
            </Field>
            <Field label="АЗС">
              <TextInput value={editing.station} onChange={(e) => setEditing({ ...editing, station: e.target.value })} />
            </Field>
            <div className="form-grid__wide">
              <PhotoField
                photoId={editing.photoId ?? null}
                onChange={(next) => setEditing({ ...editing, photoId: next })}
                onError={(message) => notify(message, 'error')}
              />
            </div>
            <div className="form-grid__wide">
              <Checkbox
                label="Полный бак"
                checked={editing.isFullTank}
                onChange={(e) => setEditing({ ...editing, isFullTank: e.target.checked })}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
