/**
 * Каркас приложения: боковое меню, переключатель автомобиля, тема,
 * выбор раздела (собственный минимальный роутер на hash — без лишних зависимостей).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './store.tsx';
import { Button, EmptyState, Loader, Toasts } from './ui.tsx';
import { api } from './api.ts';
import DashboardPage from './pages/DashboardPage.tsx';
import FuelPage from './pages/FuelPage.tsx';
import ExpensesPage from './pages/ExpensesPage.tsx';
import IncomesPage from './pages/IncomesPage.tsx';
import TripsPage from './pages/TripsPage.tsx';
import ServicePage from './pages/ServicePage.tsx';
import PartsPage from './pages/PartsPage.tsx';
import ChecklistPage from './pages/ChecklistPage.tsx';
import DossierPage from './pages/DossierPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';

interface NavItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Дашборд', hint: 'Сводка и графики', icon: '◔' },
  { id: 'fuel', label: 'Заправки', hint: 'Топливо и зарядки', icon: '⛽' },
  { id: 'expenses', label: 'Расходы', hint: 'ТО, ремонт, страховка', icon: '🧾' },
  { id: 'incomes', label: 'Доходы', hint: 'Такси, доставка, аренда', icon: '↑' },
  { id: 'trips', label: 'Поездки', hint: 'Журнал и стоимость', icon: '↔' },
  { id: 'service', label: 'Обслуживание', hint: 'Напоминания и износ', icon: '🛠' },
  { id: 'parts', label: 'Запчасти', hint: 'Склад и артикулы', icon: '⚙' },
  { id: 'checklist', label: 'Чек-лист', hint: 'Проверка перед выездом', icon: '✓' },
  { id: 'dossier', label: 'Авто-досье', hint: 'Отчёт для продажи', icon: '📄' },
  { id: 'settings', label: 'Настройки', hint: 'Данные и оформление', icon: '⚙' },
];

function useRoute(): [string, (next: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const handler = () => setRoute(read());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = (next: string) => {
    window.location.hash = `#/${next}`;
  };

  return [route, navigate];
}

export default function App() {
  const { loading, error, vehicles, activeVehicle, selectVehicle, reload, notify, resolvedTheme, updateSettings } = useApp();
  const [route, navigate] = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => NAV.find((item) => item.id === route) ?? NAV[0], [route]);

  const loadDemo = async () => {
    setBusy(true);
    try {
      const result = await api.loadDemo();
      await reload();
      notify(`Демонстрационные данные загружены: ${result.summary.fuel} заправок, ${result.summary.expenses} расходов.`, 'success');
      navigate('dashboard');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось загрузить демо-данные.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const renderPage = () => {
    switch (route) {
      case 'fuel':
        return <FuelPage />;
      case 'expenses':
        return <ExpensesPage />;
      case 'incomes':
        return <IncomesPage />;
      case 'trips':
        return <TripsPage />;
      case 'service':
        return <ServicePage />;
      case 'parts':
        return <PartsPage />;
      case 'checklist':
        return <ChecklistPage />;
      case 'dossier':
        return <DossierPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  if (loading) {
    return (
      <div className="boot">
        <Loader label="Открываем журнал…" />
      </div>
    );
  }

  return (
    <div className="app">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <span className="brand__mark">АЖ</span>
          <div>
            <div className="brand__name">АвтоЖурнал</div>
            <div className="brand__sub">расходы на автомобиль</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav__item ${route === item.id ? 'is-active' : ''}`}
              onClick={() => {
                navigate(item.id);
                setMenuOpen(false);
              }}
            >
              <span className="nav__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav__text">
                <span className="nav__label">{item.label}</span>
                <span className="nav__hint">{item.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar__foot">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => void updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })}
            aria-label="Переключить тему"
          >
            {resolvedTheme === 'dark' ? '☾ Тёмная тема' : '☀ Светлая тема'}
          </button>
        </div>
      </aside>

      {menuOpen && <div className="sidebar__scrim" onClick={() => setMenuOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button type="button" className="topbar__menu" onClick={() => setMenuOpen((v) => !v)} aria-label="Меню">
            ☰
          </button>
          <div className="topbar__titles">
            <h1 className="topbar__title">{current.label}</h1>
            <p className="topbar__hint">{current.hint}</p>
          </div>

          <div className="topbar__right">
            {vehicles.length > 0 && (
              <div className="vehicle-switch">
                {vehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    className={`vehicle-chip ${activeVehicle?.id === vehicle.id ? 'is-active' : ''}`}
                    onClick={() => void selectVehicle(vehicle.id)}
                    title={`${vehicle.make} ${vehicle.model}`}
                  >
                    <span className="vehicle-chip__dot" style={{ background: vehicle.color || 'var(--accent)' }} />
                    {vehicle.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="note note--error" role="alert">
            {error}
          </div>
        )}

        <div className="content">
          {vehicles.length === 0 && route !== 'settings' ? (
            <EmptyState
              title="Журнал пока пуст"
              text="Добавьте свой автомобиль в разделе «Настройки» или загрузите демонстрационные данные, чтобы посмотреть, как всё работает."
              action={
                <div className="empty__buttons">
                  <Button variant="primary" onClick={() => void loadDemo()} disabled={busy}>
                    Загрузить демо-данные
                  </Button>
                  <Button onClick={() => navigate('settings')}>Добавить автомобиль</Button>
                </div>
              }
            />
          ) : (
            renderPage()
          )}
        </div>

        <footer className="footer">
          <span>Данные хранятся только на этом компьютере — в файле data/db.json.</span>
          <span className="footer__muted">АвтоЖурнал · локальный учёт расходов</span>
        </footer>
      </main>

      <Toasts />
    </div>
  );
}
