/** Авто-досье: отчёт о машине для продажи. Печатается в PDF средствами браузера. */

import React from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Button, Card, EmptyState, ErrorNote, Kpi, Loader } from '../ui.tsx';
import { DonutChart, StackedBarChart } from '../components/charts.tsx';
import { formatDate, formatMoney, formatMoneyShort, formatMonthKey, formatNumber, formatOdometer } from '../../../shared/format.ts';
import { toDisplayDistance } from '../utils/units.ts';

export default function DossierPage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const dossier = useLoad(() => (vehicleId ? api.dossier(vehicleId) : Promise.resolve(null)), [vehicleId], null);

  if (!activeVehicle) return <EmptyState title="Нет автомобиля" text="Сначала добавьте автомобиль в настройках." />;

  if (dossier.loading) return <Loader label="Готовим авто-досье…" />;
  if (dossier.error) return <ErrorNote message={dossier.error} />;
  const data = dossier.data;
  if (!data) return <EmptyState title="Нет данных для отчёта" text="Добавьте хотя бы несколько записей — и досье наполнится." />;

  const vehicle = data.vehicle;
  const economics = data.economics;
  const ownership = data.ownership;

  return (
    <div className="stack">
      <Card
        className="no-print"
        title="Авто-досье"
        subtitle={`Отчёт сформирован ${formatDate(data.generatedAt.slice(0, 10))}`}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              notify('Открываю диалог печати: выберите «Сохранить как PDF».', 'info');
              window.setTimeout(() => window.print(), 250);
            }}
          >
            Печать / сохранить в PDF
          </Button>
        }
      >
        <p className="hint-line">
          Отчёт печатается только вместе с содержимым досье. В диалоге печати выберите «Сохранить как PDF», чтобы отправить отчёт покупателю.
        </p>
      </Card>

      <article className="dossier">
        <header className="dossier__head">
          <div>
            <h1 className="dossier__title">
              {vehicle.make} {vehicle.model}, {vehicle.year ?? '—'}
            </h1>
            <p className="dossier__sub">
              {vehicle.name} · {vehicle.plateNumber || 'без номера'} · {vehicle.fuelTypeLabel}
              {vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}
            </p>
          </div>
          <div className="dossier__stamp">
            <span>АвтоЖурнал</span>
            <small>отчёт о содержании автомобиля</small>
          </div>
        </header>

        <section className="dossier__grid">
          <div>
            <span className="dossier__label">Пробег на дату отчёта</span>
            <strong className="dossier__value">{formatOdometer(toDisplayDistance(ownership.currentOdometer, unitSystem))}</strong>
          </div>
          <div>
            <span className="dossier__label">Пройдено под учётом</span>
            <strong className="dossier__value">{formatOdometer(toDisplayDistance(ownership.distanceUnderOwnership, unitSystem))}</strong>
          </div>
          <div>
            <span className="dossier__label">Учёт ведётся с</span>
            <strong className="dossier__value">{ownership.sinceLabel}</strong>
          </div>
          <div>
            <span className="dossier__label">Средний пробег в месяц</span>
            <strong className="dossier__value">{formatOdometer(toDisplayDistance(ownership.distancePerMonth, unitSystem))}</strong>
          </div>
        </section>

        <section className="dossier__kpis">
          <Kpi label="Всего вложено" value={formatMoney(economics.totalSpend)} hint={`${ownership.monthsLabel} владения`} />
          <Kpi label="Стоимость километра" value={formatMoney(economics.costPerKm)} hint="с учётом всех расходов" />
          <Kpi label="Расход" value={economics.l100km === null ? '—' : `${formatNumber(economics.l100km, 1)} ${vehicle.unit}/100 км`} hint={economics.consumptionMethod === 'full-tank' ? 'метод полного бака' : 'упрощённый расчёт'} />
          <Kpi label="Расходы в месяц" value={formatMoney(economics.costPerMonth)} hint="средние за период учёта" />
        </section>

        <section className="dossier__section">
          <h2>Структура затрат</h2>
          <DonutChart
            data={data.categories.slice(0, 6).map((row) => ({ label: row.label, value: row.amount }))}
            centerValue={formatMoneyShort(economics.totalSpend)}
            centerLabel="всего"
          />
          <table className="dossier__table">
            <thead>
              <tr>
                <th>Категория</th>
                <th className="is-right">Сумма</th>
                <th className="is-right">Доля</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((row) => (
                <tr key={row.category}>
                  <td>{row.label}</td>
                  <td className="is-right">{formatMoney(row.amount)}</td>
                  <td className="is-right">{row.share.toFixed(1).replace('.', ',')} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="dossier__section">
          <h2>Траты по месяцам</h2>
          <StackedBarChart data={data.monthly.map((row) => ({ label: formatMonthKey(row.key).replace(' ', '\u00A0'), fuel: row.fuel, other: row.other }))} formatValue={(value) => formatMoneyShort(value)} />
        </section>

        <section className="dossier__section">
          <h2>История обслуживания</h2>
          {data.maintenance.length ? (
            <table className="dossier__table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Работы</th>
                  <th className="is-right">Пробег</th>
                  <th className="is-right">Сумма</th>
                  <th>Исполнитель</th>
                </tr>
              </thead>
              <tbody>
                {data.maintenance.map((row, index) => (
                  <tr key={`${row.date}-${index}`}>
                    <td>{row.dateLabel}</td>
                    <td>
                      {row.category}: {row.description}
                    </td>
                    <td className="is-right">{row.odometer === null ? '—' : formatOdometer(toDisplayDistance(row.odometer, unitSystem))}</td>
                    <td className="is-right">{formatMoney(row.amount)}</td>
                    <td>{row.vendor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dossier__muted">Записи о ТО и ремонте отсутствуют.</p>
          )}
        </section>

        <section className="dossier__section">
          <h2>Состояние по регламентам</h2>
          <table className="dossier__table">
            <thead>
              <tr>
                <th>Узел</th>
                <th>Статус</th>
                <th className="is-right">Остаток, км</th>
                <th className="is-right">Остаток, дней</th>
                <th className="is-right">Износ</th>
              </tr>
            </thead>
            <tbody>
              {data.wear.map((row) => (
                <tr key={row.ruleId}>
                  <td>{row.name}</td>
                  <td>{row.status === 'overdue' ? 'Просрочено' : row.status === 'soon' ? 'Скоро' : 'В норме'}</td>
                  <td className="is-right">{row.remainingKm === null ? '—' : formatNumber(toDisplayDistance(row.remainingKm, unitSystem), 0)}</td>
                  <td className="is-right">{row.remainingDays === null ? '—' : row.remainingDays}</td>
                  <td className="is-right">{row.percentUsed === null ? '—' : `${row.percentUsed.toFixed(1).replace('.', ',')} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {data.parts.length > 0 && (
          <section className="dossier__section">
            <h2>Установленные запчасти</h2>
            <table className="dossier__table">
              <thead>
                <tr>
                  <th>Деталь</th>
                  <th>Артикул</th>
                  <th>Дата установки</th>
                  <th className="is-right">Пробег</th>
                </tr>
              </thead>
              <tbody>
                {data.parts.map((part) => (
                  <tr key={part.id}>
                    <td>{part.name}</td>
                    <td>{part.article || '—'}</td>
                    <td>{part.installDate ? formatDate(part.installDate) : '—'}</td>
                    <td className="is-right">{part.installOdometer === null ? '—' : formatOdometer(toDisplayDistance(part.installOdometer, unitSystem))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="dossier__section">
          <h2>Последние заправки</h2>
          <table className="dossier__table">
            <thead>
              <tr>
                <th>Дата</th>
                <th className="is-right">Одометр</th>
                <th className="is-right">Объём, {vehicle.unit}</th>
                <th className="is-right">Сумма</th>
                <th>АЗС</th>
              </tr>
            </thead>
            <tbody>
              {data.fuelHistory.slice(0, 25).map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td className="is-right">{formatOdometer(toDisplayDistance(row.odometer, unitSystem))}</td>
                  <td className="is-right">{formatNumber(row.volume, 1)}</td>
                  <td className="is-right">{formatMoney(row.totalCost)}</td>
                  <td>{row.station || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="dossier__foot">
          <p>
            Отчёт сформирован приложением «АвтоЖурнал» {formatDate(data.generatedAt.slice(0, 10))} на основе данных, которые вносил владелец.
            Стоимость километра рассчитана как (топливо + все прочие расходы) ÷ пройденный пробег.
          </p>
        </footer>
      </article>
    </div>
  );
}
