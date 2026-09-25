/**
 * Импорт истории: заправки из выгрузки АЗС и расходы из банковской выписки.
 *
 * Текст вставляет сам владелец — приложение никуда не обращается. Заправки можно раскидать
 * между машинами по пробегу, а одометры расставляются по датам и помечаются как расчётные.
 */

import React, { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Button, Card, EmptyState, Field, InfoNote, NumberInput, Select, TextArea, Checkbox } from '../ui.tsx';
import { formatMoney, formatNumber } from '../../../shared/format.ts';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from '../../../shared/constants.ts';
import type { ExpenseCategory } from '../../../shared/types.ts';

export default function ImportPage() {
  const { vehicles, activeVehicle, notify, reload } = useApp();
  const hints = useLoad(() => api.importHint(), [], []);

  const [fuelText, setFuelText] = useState('');
  const [variant, setVariant] = useState<'single' | 'mileage'>('mileage');
  const [odometers, setOdometers] = useState<Record<string, string>>({});
  const [singleVehicleId, setSingleVehicleId] = useState(activeVehicle?.id ?? vehicles[0]?.id ?? '');
  const [markFullTank, setMarkFullTank] = useState(false);
  const [fuelPreview, setFuelPreview] = useState<Awaited<ReturnType<typeof api.importPreview>>['fuel'] | null>(null);

  const [expenseText, setExpenseText] = useState('');
  const [defaultCategory, setDefaultCategory] = useState<ExpenseCategory>('other');
  const [expensePreview, setExpensePreview] = useState<Awaited<ReturnType<typeof api.importPreview>>['expenses'] | null>(null);
  const [busy, setBusy] = useState(false);

  if (!vehicles.length) return <EmptyState title="Нет автомобилей" text="Сначала добавьте машины в настройках." />;

  const runPreview = async () => {
    try {
      const result = await api.importPreview({ fuelText, expensesText: expenseText });
      setFuelPreview(result.fuel);
      setExpensePreview(result.expenses);
      if (!result.fuel.count && !result.expenses.count) notify('В тексте не нашлось строк с датой и суммой.', 'error');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось разобрать текст.', 'error');
    }
  };

  const importFuel = async () => {
    setBusy(true);
    try {
      const chosen = variant === 'single' ? [singleVehicleId] : vehicles.map((vehicle) => vehicle.id);
      const targets = chosen.map((vehicleId) => ({
        vehicleId,
        currentOdometer: Number((odometers[vehicleId] ?? '').replace(',', '.')) || 0,
      }));
      if (targets.some((target) => target.currentOdometer <= 0)) {
        notify('Укажите текущий пробег — без него некуда расставить одометры импортируемых заправок.', 'error');
        return;
      }
      const result = await api.importFuel({ text: fuelText, variant, targets, markFullTank });
      notify(result.message, 'success');
      setFuelText('');
      setFuelPreview(null);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось импортировать заправки.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const importExpenses = async () => {
    setBusy(true);
    try {
      const result = await api.importExpenses({ text: expenseText, vehicleId: activeVehicle?.id, defaultCategory });
      notify(result.message, 'success');
      setExpenseText('');
      setExpensePreview(null);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось импортировать расходы.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <InfoNote>
        Вставьте текст, который скопировали из приложения АЗС или из банковской выписки. Приложение разберёт
        строки само: дата, объём, сумма, АЗС. Наружу ничего не отправляется.
      </InfoNote>

      <Card
        title="Заправки"
        subtitle="В выгрузке АЗС нет машины и одометра — распределяем по пробегу и расставляем одометры по датам"
      >
        <div className="form-grid">
          <Field label="Как распределить" hint="Заправки 95-го не разделены между машинами — делим по пройденному расстоянию">
            <Select value={variant} onChange={(e) => setVariant(e.target.value as 'single' | 'mileage')}>
              <option value="mileage">Раскидать между машинами по пробегу</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value="single">
                  Все на «{vehicle.name}»
                </option>
              ))}
            </Select>
          </Field>
          {variant === 'single' && (
            <Field label="Машина">
              <Select value={singleVehicleId} onChange={(e) => setSingleVehicleId(e.target.value)}>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {(variant === 'single' ? vehicles.filter((v) => v.id === singleVehicleId) : vehicles).map((vehicle) => (
            <Field
              key={vehicle.id}
              label={`Текущий пробег: ${vehicle.name}`}
              hint={
                hints.data.find((row) => row.vehicleId === vehicle.id)
                  ? `в журнале известно: ${formatNumber(hints.data.find((row) => row.vehicleId === vehicle.id)!.currentOdometer, 0)} км, покупка ${hints.data.find((row) => row.vehicleId === vehicle.id)!.purchaseDate ?? '—'}`
                  : undefined
              }
            >
              <NumberInput
                value={odometers[vehicle.id] ?? ''}
                onChange={(e) => setOdometers({ ...odometers, [vehicle.id]: e.target.value })}
                placeholder="например, 12500"
              />
            </Field>
          ))}
        </div>

        <Field label="Текст выгрузки" hint="например: «05.09.2025 42,5 л 2 601 ₽ Газпромнефть» — по строке на заправку">
          <TextArea
            value={fuelText}
            onChange={(e) => setFuelText(e.target.value)}
            placeholder={'05.09.2025 42,5 л 2 601 ₽ Газпромнефть\n18.09.2025 55,1 л 3 340,50 ₽ Газпромнефть'}
          />
        </Field>

        <div className="button-row">
          <Button variant="secondary" onClick={() => void runPreview()} disabled={!fuelText.trim() && !expenseText.trim()}>
            Разобрать текст
          </Button>
          <Button variant="primary" onClick={() => void importFuel()} disabled={busy || !fuelText.trim()}>
            Импортировать заправки
          </Button>
          <Checkbox
            label="Отмечать как «полный бак» (влияет на расчёт расхода)"
            checked={markFullTank}
            onChange={(e) => setMarkFullTank(e.target.checked)}
          />
        </div>

        {fuelPreview && (
          <p className="hint-line">
            Разобрано заправок: <strong>{fuelPreview.count}</strong>, объём {formatNumber(fuelPreview.totalLiters, 1)} л,
            сумма {formatMoney(fuelPreview.totalCost)}.
            {fuelPreview.sample.length > 0 && ` Первая строка: ${fuelPreview.sample[0].date}, ${fuelPreview.sample[0].volume ?? '—'} л.`}
          </p>
        )}
      </Card>

      <Card title="Расходы" subtitle="Страховка, оклейка, антикор, ТО — строки из банковской выписки">
        <div className="form-grid">
          <Field label="Машина">
            <Select value={activeVehicle?.id ?? ''} onChange={() => undefined} disabled>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Категория по умолчанию" hint="если по описанию не угадать">
            <Select value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value as ExpenseCategory)}>
              {EXPENSE_CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>
                  {EXPENSE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Текст выписки" hint="например: «15.10.2025 ОСАГО 12 800 ₽» — по строке на платёж">
          <TextArea
            value={expenseText}
            onChange={(e) => setExpenseText(e.target.value)}
            placeholder={'15.10.2025 ОСАГО 12 800 ₽\n01.11.2025 Оклейка защитной плёнкой 89 000 ₽\n20.11.2025 Антикор днища 34 500 ₽'}
          />
        </Field>

        <div className="button-row">
          <Button variant="secondary" onClick={() => void runPreview()} disabled={!fuelText.trim() && !expenseText.trim()}>
            Разобрать текст
          </Button>
          <Button variant="primary" onClick={() => void importExpenses()} disabled={busy || !expenseText.trim()}>
            Импортировать расходы
          </Button>
        </div>

        {expensePreview && (
          <p className="hint-line">
            Разобрано расходов: <strong>{expensePreview.count}</strong> на {formatMoney(expensePreview.totalCost)}.
            {expensePreview.sample.length > 0 && ` Первая строка: ${expensePreview.sample[0].date}, ${expensePreview.sample[0].description} (${EXPENSE_CATEGORY_LABELS[expensePreview.sample[0].categoryHint ?? 'other']}).`}
          </p>
        )}
      </Card>

      <InfoNote>
        Повторный импорт того же файла безопасен: одинаковые строки (дата, пробег, сумма) второй раз не добавляются.
        Пробег у импортированных заправок расчётный — он отмечен в заметках, и его можно поправить вручную.
        Расход по таким записям считается упрощённым способом, пока не появятся реальные заправки «до полного бака».
      </InfoNote>
    </div>
  );
}
