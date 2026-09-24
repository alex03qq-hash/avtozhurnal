import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppProvider } from './store.tsx';
import './styles/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент #root');

// Регистрируем service worker: благодаря нему приложение можно установить на телефон
// и открыть, даже когда компьютер с базой недоступен (оболочка берётся из кэша).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Не удалось зарегистрировать service worker:', error);
    });
  });
}

createRoot(container).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
