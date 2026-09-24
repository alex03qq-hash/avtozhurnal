/** Главный экран: ключевые цифры, графики, ближайшее ТО и последние записи. */

import React from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Button, Card, EmptyState, ErrorNote, Kpi, Loader, ProgressBar, StatusBadge } from '../ui.tsx';
import { DonutChart, LineChart, StackedBarChart } from '../components/charts.tsx';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, formatOdometer, monthKey } from '../../../shared/format.ts';
import type { Expense, FuelEntry, Income } from '../../../shared/types.ts';
import { EXPENSE_CATEGORY_LABELS } from '../../../shared/constants.ts';
import { costPerDistanceLabel, formatConsumptionForUnit, toDisplayCostPerKm, toDisplayDistance } from '../utils/units.ts';
import { navigateTo } from '../router.ts';

export default function DashboardPage() {
  const { activeVehicle, unitSystem, notify } = useApp();
  const vehicleId = activeVehicle?.id;
  const isElectric = activeVehicle?.fuelType === 'electric';

  const overview = useLoad(() => api.overview(vehicleId), [vehicleId], null);
  const consumption = useLoad(() => api.consumption(vehicleId), [vehicleId], null);
  const monthly = useLoad(() => api.monthly(vehicleId, 12), [vehicleId], []);
  const categories = useLoad(() => api.categories(vehicleId), [vehicleId], []);
  const reminders = useLoad(() => api.reminders(vehicleId), [vehicleId], { odometer: 0, items: [] });
  const insights = useLoad(() => api.insights(vehicleId), [vehicleId], null);
  const recent = useLoad(
    async () => {
      const [fuel, expenses, incomes] = await Promise.all([
        api.list<FuelEntry>('fuel', vehicleId ? { vehicleId } : {}),
        api.list<Expense>('expenses', vehicleId ? { vehicleId } : {}),
        api.list<Income>('incomes', vehicleId ? { vehicleId } : {}),
      ]);
      const merged = [
        ...fuel.map((f) => ({ id: f.id, date: f.date, kind: 'Заправка', title: `${formatNumber(f.volume, 1)} ${isElectric ? 'кВт·ч' : 'л'} · ${f.station || 'АЗС'}`, amount: -f.totalCost })),
        ...expenses.map((e) => ({ id: e.id, date: e.date, kind: EXPENSE_CATEGORY_LABELS[e.category], title: e.description || e.vendor || 'Расход', amount: -e.amount })),
        ...incomes.map((i) => ({ id: i.id, date: i.date, kind: 'Доход', title: i.description || 'Поступление', amount: i.amount })),
      ];
      return merged.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    },
    [vehicleId, isElectric],
    [],
  );

  if (!activeVehicle) {
    return <EmptyState title="Нет активного автомобиля" text="Добавьте автомобиль в настройках — и дашборд заполнится автоматически." />;
  }

  const stats = overview.data;
  const chartData = (consumption.data?.segments ?? []).slice(-12).map((segment) => ({
    label: segment.toDate.slice(5),
    value: segment.l100km,
  }));

  const monthlyData = (monthly.data ?? []).slice(-9).map((row) => ({
    label: row.key.slice(5),
    fuel: row.fuel,
    other: row.other,
  }));

  const categoryData = (categories.data ?? []).slice(0, 6).map((row) => ({ label: row.label, value: row.amount }));
  const attention = (reminders.data?.items ?? []).filter((item) => item.status !== 'ok').slice(0, 3);
  const upcoming = (reminders.data?.items ?? []).slice(0, 4);

  return (
    <div className="stack">
      {(overview.error || consumption.error) && <ErrorNote message={overview.error ?? consumption.error ?? ''} />}

      <div className="kpi-grid">
        <Kpi
          label="Расход"
          value={stats ? formatConsumptionForUnit(stats.l100km, unitSystem, isElectric) : <Loader label="" />}
          hint={stats?.consumptionMethod === 'full-tank' ? 'метод полного бака' : stats?.consumptionMethod === 'simplified' ? 'упрощённый расчёт' : 'нужно ≥ 2 записей'}
          tone="accent"
        />
        <Kpi
          label="Стоимость километра"
          value={stats ? formatMoney(toDisplayCostPerKm(stats.costPerKm, unitSystem)) : <Loader label="" />}
          hint={
            stats && stats.fuelCostPerKm !== null
              ? `${costPerDistanceLabel(unitSystem)} с учётом всех расходов · из них топливо ${formatMoney(toDisplayCostPerKm(stats.fuelCostPerKm, unitSystem))}`
              : `${costPerDistanceLabel(unitSystem)}, с учётом всех расходов`
          }
        />
        <Kpi label="Траты за месяц" value={stats ? formatMoney(stats.monthSpend) : <Loader label="" />} hint="текущий календарный месяц" />
        <Kpi label="Траты за год" value={stats ? formatMoney(stats.yearSpend) : <Loader label="" />} hint="с 1 января" tone="warn" />
        <Kpi
          label="Пробег"
          value={stats ? formatOdometer(toDisplayDistance(stats.currentOdometer, unitSystem), unitSystem === 'imperial' ? 'миль' : 'км') : <Loader label="" />}
          hint={stats ? `пройдено с начала учёта: ${formatOdometer(toDisplayDistance(stats.totalDistanceKm, unitSystem), unitSystem === 'imperial' ? 'миль' : 'км')}` : ''}
        />
        <Kpi
          label="Прибыль"
          value={stats ? formatMoney(stats.profit) : <Loader label="" />}
          hint={stats ? `доходы ${formatMoneyShort(stats.income)}` : ''}
          tone={stats && stats.profit < 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="quick-actions">
        <Button variant="primary" onClick={() => navigateTo('fuel?new=1')}>
          + Заправка
        </Button>
        <Button onClick={() => navigateTo('checklist')}>Чек-лист перед выездом</Button>
        <Button onClick={() => navigateTo('service')}>Обслуживание</Button>
        <Button onClick={() => navigateTo('dossier')}>Авто-досье</Button>
      </div>

      <div className="grid grid--2">
        <Card title="Динамика расхода" subtitle="По отрезкам «от полного бака до полного бака»">
          <LineChart data={chartData} formatValue={(value) => formatNumber(value, 1)} />
        </Card>
        <Card title="Структура расходов" subtitle="Топливо и категории затрат">
          <DonutChart
            data={categoryData}
            centerValue={stats ? formatMoneyShort(stats.totalSpend) : undefined}
            centerLabel="всего"
          />
        </Card>
      </div>

      <Card title="Траты по месяцам" subtitle="Топливо (акцент) и прочие расходы (нейтральный)">
        <StackedBarChart data={monthlyData} formatValue={(value) => formatMoneyShort(value)} />
      </Card>

      <div className="grid grid--2">
        <Card
          title="Ближайшее обслуживание"
          subtitle={reminders.data ? `Одометр: ${formatOdometer(toDisplayDistance(reminders.data.odometer, unitSystem))}` : undefined}
        >
          {reminders.loading ? (
            <Loader />
          ) : upcoming.length ? (
            <ul className="rule-list">
              {upcoming.map((item) => (
                <li key={item.ruleId} className="rule">
                  <div className="rule__head">
                    <span className="rule__name">{item.name}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="rule__meta">
                    {item.remainingKm !== null && (
                      <span>
                        {item.remainingKm >= 0
                          ? `осталось ${formatOdometer(item.remainingKm)}`
                          : `просрочено на ${formatOdometer(Math.abs(item.remainingKm))}`}
                      </span>
                    )}
                    {item.remainingDays !== null && (
                      <span>
                        {item.remainingDays >= 0 ? `через ${item.remainingDays} дн.` : `${Math.abs(item.remainingDays)} дн. назад`}
                      </span>
                    )}
                  </div>
                  {item.percentUsed !== null && (
                    <ProgressBar percent={item.percentUsed} tone={item.percentUsed >= 100 ? 'bad' : item.percentUsed >= 80 ? 'warn' : 'accent'} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Регламенты не заданы" text="Добавьте регламенты в разделе «Обслуживание» — приложение само напомнит о замене." />
          )}
          {attention.length > 0 && (
            <p className="hint-line">
              Требуют внимания: {attention.map((item) => item.name).join(', ')}.
            </p>
          )}
        </Card>

        <Card title="Последние записи" subtitle="Заправки, расходы и доходы">
          {recent.loading ? (
            <Loader />
          ) : recent.data.length ? (
            <ul className="feed">
              {recent.data.map((item) => (
                <li key={item.id} className="feed__row">
                  <span className="feed__date">{formatDate(item.date)}</span>
                  <span className="feed__kind">{item.kind}</span>
                  <span className="feed__title">{item.title}</span>
                  <span className={`feed__amount ${item.amount >= 0 ? 'is-positive' : ''}`}>{formatMoney(item.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Пока ничего нет" text="Добавьте первую заправку — дашборд сразу начнёт считать." />
          )}
        </Card>
      </div>

      {insights.data && (
        <Card
          title="Что это значит"
          subtitle="Выводы по вашим цифрам: стиль вождения, прогноз по деталям и стоимость владения"
        >
          <div className="insight-grid">
            <div className="insight-grid__col">
              <span className="insight__label">Стиль вождения</span>
              <span className="insight__value">{insights.data.style.label}</span>
              <p className="insight__text">{insights.data.style.explanation}</p>
              <p className="hint-line">
                Пробег около {formatNumber(insights.data.kmPerMonth, 0)} км в месяц.
              </p>
            </div>

            <div className="insight-grid__col">
              <span className="insight__label">Прогноз по деталям</span>
              <ul className="insight-list">
                {insights.data.forecast.slice(0, 4).map((item) => (
                  <li key={item.ruleId}>
                    <span className="insight-list__name">{item.name}</span>
                    <span className="insight-list__meta">
                      {item.predictedDate ? `около ${formatDate(item.predictedDate)}` : 'нужно больше данных'}
                      {item.monthsLeft !== null ? ` · ${item.monthsLeft} мес.` : ''}
                    </span>
                    <StatusBadge status={item.status} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="insight-grid__col">
              <span className="insight__label">Стоимость владения</span>
              <span className="insight__value">{insights.data.ownership.verdict}</span>
              <p className="insight__text">{insights.data.ownership.explanation}</p>
            </div>
          </div>
        </Card>
      )}

      <p className="hint-line">
        Период данных: с {formatDate((recent.data[recent.data.length - 1]?.date) ?? activeVehicle.createdAt.slice(0, 10))} · текущий месяц{' '}
        {monthKey(new Date().toISOString().slice(0, 10))}. Каждая запись сохраняется в файл сразу после добавления.
      </p>
    </div>
  );
}
