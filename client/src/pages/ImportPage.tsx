/**
 * Импорт истории: год расходов и заправок, которые уже есть, но разбросаны по выгрузкам.
 *
 * Два пути: файл Excel/CSV (привычная таблица) и вставка текста. Данные разбираются на этом же
 * компьютере — наружу ничего не отправляется.
 */

import React, { useState } from 'react';
import { api, importTemplateUrl } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Badge, Button, Card, Checkbox, EmptyState, Field, InfoNote, NumberInput, Select, TextArea } from '../ui.tsx';
import { formatDate, formatMoney, formatNumber } from '../../../shared/format.ts';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from '../../../shared/constants.ts';
import type { ExpenseCategory } from '../../../shared/types.ts';

type FilePreview = Awaited<ReturnType<typeof api.importFilePreview>>;
type TextPreview = Awaited<ReturnType<typeof api.importPreview>>;

export default function ImportPage() {
  const { vehicles, activeVehicle, notify, reload } = useApp();
  const hints = useLoad(() => api.importHint(), [], []);
  const [busy, setBusy] = useState(false);

  // Общие настройки: пробеги машин нужны и файлу, и вставке текста
  const [odometers, setOdometers] = useState<Record<string, string>>({});
  const [markFullTank, setMarkFullTank] = useState(false);
  const [expenseVehicleId, setExpenseVehicleId] = useState(activeVehicle?.id ?? vehicles[0]?.id ?? '');
  const [defaultCategory, setDefaultCategory] = useState<ExpenseCategory>('other');

  // Файл
  const [file, setFile] = useState<{ name: string; size: number; content: string } | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [textPreview, setTextPreview] = useState<TextPreview | null>(null);

  // Вставка текста
  const [fuelText, setFuelText] = useState('');
  const [variant, setVariant] = useState<'single' | 'mileage'>('mileage');
  const [singleVehicleId, setSingleVehicleId] = useState(activeVehicle?.id ?? vehicles[0]?.id ?? '');
  const [expenseText, setExpenseText] = useState('');

  if (!vehicles.length) return <EmptyState title="Нет автомобилей" text="Сначала добавьте машины в настройках." />;

  const targets = vehicles.map((vehicle) => ({
    vehicleId: vehicle.id,
    currentOdometer: Number((odometers[vehicle.id] ?? '').replace(',', '.')) || 0,
  }));
  const filledTargets = targets.filter((target) => target.currentOdometer > 0);
  const odometerFor = (vehicleId: string) => {
    const hint = hints.data.find((row) => row.vehicleId === vehicleId);
    if (!hint) return undefined;
    return `в журнале известно: ${formatNumber(hint.currentOdometer, 0)} км${hint.purchaseDate ? `, покупка ${formatDate(hint.purchaseDate)}` : ''}`;
  };

  const odometerFields = (only?: string) => (
    <div className="form-grid">
      {(only ? vehicles.filter((v) => v.id === only) : vehicles).map((vehicle) => (
        <Field key={vehicle.id} label={`Текущий пробег: ${vehicle.name}`} hint={odometerFor(vehicle.id)}>
          <NumberInput
            value={odometers[vehicle.id] ?? ''}
            onChange={(event) => setOdometers({ ...odometers, [vehicle.id]: event.target.value })}
            placeholder="например, 12500"
          />
        </Field>
      ))}
    </div>
  );

  const readFile = async (picked: File) => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
        reader.readAsDataURL(picked);
      });
      const content = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      setFile({ name: picked.name, size: picked.size, content });
      setFilePreview(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось прочитать файл.', 'error');
    }
  };

  const previewFile = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.importFilePreview({ filename: file.name, content: file.content });
      setFilePreview(result);
      if (!result.fuel.count && !result.expenses.count) notify('В файле не нашлось ни заправок, ни расходов.', 'error');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось разобрать файл.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const importFile = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const needsOdometer = filePreview && !filePreview.hasVehicleColumn && filePreview.fuel.count > filePreview.fuel.withOdometer;
      if (needsOdometer && !filledTargets.length) {
        notify('В файле нет колонок «Машина» и «Пробег» — укажите текущий пробег машин, иначе записи некуда поставить.', 'error');
        return;
      }
      const result = await api.importFile({
        filename: file.name,
        content: file.content,
        targets: filledTargets.length ? filledTargets : undefined,
        markFullTank,
        vehicleId: expenseVehicleId,
        defaultCategory,
      });
      notify(result.message, 'success');
      if (result.warnings.length) result.warnings.forEach((warning) => notify(warning, 'info'));
      setFile(null);
      setFilePreview(null);
      await reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось импортировать файл.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runTextPreview = async () => {
    try {
      const result = await api.importPreview({ fuelText, expensesText: expenseText });
      setTextPreview(result);
      if (!result.fuel.count && !result.expenses.count) notify('В тексте не нашлось строк с датой и суммой.', 'error');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось разобрать текст.', 'error');
    }
  };

  const importFuelText = async () => {
    setBusy(true);
    try {
      const chosen = variant === 'single' ? [singleVehicleId] : vehicles.map((vehicle) => vehicle.id);
      const chosenTargets = chosen.map((vehicleId) => ({ vehicleId, currentOdometer: Number((odometers[vehicleId] ?? '').replace(',', '.')) || 0 }));
      if (chosenTargets.some((target) => target.currentOdometer <= 0)) {
        notify('Укажите текущий пробег — без него некуда расставить одометры импортируемых заправок.', 'error');
        return;
      }
      const result = await api.importFuel({ text: fuelText, variant, targets: chosenTargets, markFullTank });
      notify(result.message, 'success');
      setFuelText('');
      setTextPreview(null);
      await reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось импортировать заправки.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const importExpenseText = async () => {
    setBusy(true);
    try {
      const result = await api.importExpenses({ text: expenseText, vehicleId: expenseVehicleId, defaultCategory });
      notify(result.message, 'success');
      setExpenseText('');
      setTextPreview(null);
      await reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось импортировать расходы.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <InfoNote>
        Год расходов и заправок уже есть — в выгрузке АЗС и в банковской выписке. Загрузите файл Excel или CSV
        либо вставьте текст: приложение разберёт строки само. Всё считается на этом компьютере, наружу ничего не уходит.
      </InfoNote>

      <Card title="Пробег машин" subtitle="Нужен, если в файле нет колонок «Машина» и «Пробег»: по нему распределяются заправки и расставляются одометры">
        {odometerFields()}
        <Checkbox
          label="Отмечать импортированные заправки как «полный бак» (включает точный расчёт расхода)"
          checked={markFullTank}
          onChange={(event) => setMarkFullTank(event.target.checked)}
        />
      </Card>

      <Card
        title="Из файла Excel или CSV"
        subtitle="Лист «Заправки» и лист «Расходы» — можно заполнить шаблон или загрузить свою таблицу"
        actions={
          <div className="button-row">
            <a className="btn btn--secondary btn--sm" href={importTemplateUrl()} download>Скачать шаблон</a>
            <a className="btn btn--ghost btn--sm" href={importTemplateUrl(true)} download>Пустой шаблон</a>
          </div>
        }
      >
        <label
          className={`file-drop${dragOver ? ' file-drop--over' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const picked = event.dataTransfer.files?.[0];
            if (picked) void readFile(picked);
          }}
        >
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void readFile(picked);
              event.target.value = '';
            }}
          />
          {file ? (
            <span>
              <strong>{file.name}</strong> · {formatNumber(file.size / 1024, 0)} КБ — нажмите, чтобы выбрать другой файл.
              Можно просто перетащить файл сюда.
            </span>
          ) : (
            <span>
              Нажмите или перетащите файл: <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>, <strong>.txt</strong>
              <br />
              <span className="hint-line">Шапка таблицы должна быть в первой строке: Дата, Машина, Объём, Сумма, АЗС. В шаблоне она уже готова.</span>
            </span>
          )}
        </label>

        <div className="button-row">
          <Button variant="primary" onClick={() => void previewFile()} disabled={busy || !file}>
            Проверить файл
          </Button>
          <Button variant="secondary" onClick={() => void importFile()} disabled={busy || !file || !filePreview}>
            Импортировать из файла
          </Button>
        </div>

        {filePreview && (
          <div className="stack">
            <p className="hint-line">
              Листов с данными: <strong>{filePreview.sheets.filter((sheet) => sheet.kind !== 'empty').length}</strong>
              {' · '}заправок: <strong>{filePreview.fuel.count}</strong>
              {filePreview.fuel.count > 0 && ` на ${formatMoney(filePreview.fuel.totalCost)} (${formatNumber(filePreview.fuel.totalLiters, 1)} л)`}
              {' · '}расходов: <strong>{filePreview.expenses.count}</strong>
              {filePreview.expenses.count > 0 && ` на ${formatMoney(filePreview.expenses.totalCost)}`}
              {filePreview.hasVehicleColumn ? ' · машина указана в файле' : filledTargets.length > 1 ? ' · строки без машины распределятся по пробегу' : ''}
            </p>

            {filePreview.expenses.count > 0 && (
              <p className="hint-line">
                По категориям:{' '}
                {Object.entries(filePreview.expenses.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([category, sum]) => `${EXPENSE_CATEGORY_LABELS[category as ExpenseCategory] ?? category} — ${formatMoney(sum)}`)
                  .join(' · ')}
              </p>
            )}

            {filePreview.fuel.sample.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Машина</th>
                      <th className="is-right">Объём, л</th>
                      <th className="is-right">Сумма</th>
                      <th>АЗС</th>
                      <th>Пробег</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filePreview.fuel.sample.slice(0, 6).map((row, index) => (
                      <tr key={`${row.date}-${index}`}>
                        <td data-label="Дата">{formatDate(row.date)}</td>
                        <td data-label="Машина">{row.vehicleName ?? '—'}</td>
                        <td className="is-right" data-label="Объём, л">{row.volume === null ? '—' : formatNumber(row.volume, 1)}</td>
                        <td className="is-right" data-label="Сумма">{row.totalCost === null ? '—' : formatMoney(row.totalCost)}</td>
                        <td data-label="АЗС">{row.station || '—'}</td>
                        <td data-label="Пробег">{row.odometer === null ? 'рассчитаем' : formatNumber(row.odometer, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filePreview.expenses.sample.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Машина</th>
                      <th>Категория</th>
                      <th>Описание</th>
                      <th className="is-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filePreview.expenses.sample.slice(0, 6).map((row, index) => (
                      <tr key={`${row.date}-${index}`}>
                        <td data-label="Дата">{formatDate(row.date)}</td>
                        <td data-label="Машина">{row.vehicleName ?? '—'}</td>
                        <td data-label="Категория">{EXPENSE_CATEGORY_LABELS[row.category ?? 'other']}</td>
                        <td data-label="Описание">{row.description}</td>
                        <td className="is-right" data-label="Сумма">{formatMoney(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filePreview.warnings.length > 0 && (
              <ul className="hint-line">
                {filePreview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}

            {filePreview.skippedTotal > 0 && (
              <div>
                <p className="hint-line">
                  Не разобрано строк: <strong>{filePreview.skippedTotal}</strong>. Они не попадут в журнал — проверьте их в файле:
                </p>
                <ul className="hint-line">
                  {filePreview.skipped.map((row, index) => (
                    <li key={index}>
                      лист «{row.sheet}», строка {row.row}: {row.raw.slice(0, 120)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Заправки вставкой текста" subtitle="Если удобнее скопировать историю из приложения АЗС, а не выгружать файл">
        <div className="form-grid">
          <Field label="Как распределить">
            <Select value={variant} onChange={(event) => setVariant(event.target.value as 'single' | 'mileage')}>
              <option value="mileage">Раскидать между машинами по пробегу</option>
              <option value="single">Все на одну машину</option>
            </Select>
          </Field>
          {variant === 'single' && (
            <Field label="Машина">
              <Select value={singleVehicleId} onChange={(event) => setSingleVehicleId(event.target.value)}>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Field label="Текст выгрузки" hint="например: «05.09.2025 42,5 л 2 601 ₽ Газпромнефть» — по строке на заправку">
          <TextArea
            value={fuelText}
            onChange={(event) => setFuelText(event.target.value)}
            placeholder={'05.09.2025 42,5 л 2 601 ₽ Газпромнефть\n18.09.2025 55,1 л 3 340,50 ₽ Газпромнефть'}
          />
        </Field>

        <div className="button-row">
          <Button variant="secondary" onClick={() => void runTextPreview()} disabled={!fuelText.trim() && !expenseText.trim()}>
            Разобрать текст
          </Button>
          <Button variant="primary" onClick={() => void importFuelText()} disabled={busy || !fuelText.trim()}>
            Импортировать заправки
          </Button>
        </div>

        {textPreview && textPreview.fuel.count > 0 && (
          <p className="hint-line">
            Разобрано заправок: <strong>{textPreview.fuel.count}</strong>, {formatNumber(textPreview.fuel.totalLiters, 1)} л
            на {formatMoney(textPreview.fuel.totalCost)}. Первая строка: {formatDate(textPreview.fuel.sample[0].date)}.
          </p>
        )}
      </Card>

      <Card title="Расходы вставкой текста" subtitle="Страховка, шины, оклейка, антикор, ТО — строки из выписки">
        <div className="form-grid">
          <Field label="Машина">
            <Select value={expenseVehicleId} onChange={(event) => setExpenseVehicleId(event.target.value)}>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Категория по умолчанию" hint="если по описанию не угадать">
            <Select value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value as ExpenseCategory)}>
              {EXPENSE_CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>{EXPENSE_CATEGORY_LABELS[category]}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Текст выписки" hint="например: «15.10.2025 ОСАГО 12 800 ₽» — по строке на платёж">
          <TextArea
            value={expenseText}
            onChange={(event) => setExpenseText(event.target.value)}
            placeholder={'15.10.2025 ОСАГО 12 800 ₽\n20.10.2025 Комплект зимних колёс с дисками 96 000 ₽\n01.11.2025 Оклейка защитной плёнкой 89 000 ₽'}
          />
        </Field>

        <div className="button-row">
          <Button variant="primary" onClick={() => void importExpenseText()} disabled={busy || !expenseText.trim()}>
            Импортировать расходы
          </Button>
        </div>

        {textPreview && textPreview.expenses.count > 0 && (
          <p className="hint-line">
            Разобрано расходов: <strong>{textPreview.expenses.count}</strong> на {formatMoney(textPreview.expenses.totalCost)}.
            Категория первой строки: <Badge>{EXPENSE_CATEGORY_LABELS[textPreview.expenses.sample[0].categoryHint ?? 'other']}</Badge>
          </p>
        )}
      </Card>

      <InfoNote>
        Повторный импорт того же файла безопасен: одинаковые строки (дата, пробег, сумма) второй раз не добавляются.
        Расчётный пробег помечается в заметках. Расход по импортированным заправкам считается упрощённым способом,
        пока не появятся заправки «до полного бака».
      </InfoNote>
    </div>
  );
}
