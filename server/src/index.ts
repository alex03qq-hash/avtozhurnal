/**
 * Точка входа сервера «АвтоЖурнала».
 *
 * В режиме разработки здесь только REST API (интерфейс отдаёт Vite).
 * Если рядом лежит собранный клиент (client/dist), сервер сам раздаёт
 * статику и SPA-роутинг — именно так работает `npm start` после сборки.
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Store } from './store.ts';
import { ValidationError } from './validate.ts';
import { createCollectionRouter } from './routes/crud.ts';
import { createStatsRouter } from './routes/stats.ts';
import { createIoRouter } from './routes/io.ts';
import { buildServerInfo } from './network.ts';
import type { CollectionName } from '../../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const PORT = Number(process.env.PORT ?? 4000);
// По умолчанию слушаем все интерфейсы: так телефон в той же сети видит приложение.
const HOST = process.env.HOST ?? '0.0.0.0';
const HTTPS_KEY = process.env.HTTPS_KEY;
const HTTPS_CERT = process.env.HTTPS_CERT;
const DATA_DIR = process.env.DATA_DIR ?? path.join(repoRoot, 'data');
const CLIENT_DIST = path.join(repoRoot, 'client', 'dist');

const store = new Store(DATA_DIR);
await store.init();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// Простое логирование запросов: удобно при первом запуске.
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) console.log(`${req.method} ${req.originalUrl}`);
  next();
});

const collections: CollectionName[] = ['vehicles', 'fuel', 'expenses', 'incomes', 'trips', 'parts', 'rules', 'checklist'];
for (const name of collections) {
  app.use(`/api/${name}`, createCollectionRouter(store, name));
}
app.use('/api', createStatsRouter(store));
app.use('/api', createIoRouter(store, { port: PORT, host: HOST }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Метод API не найден.' }));

// Раздача собранного интерфейса (если сборка есть).
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// Единый обработчик ошибок: пользователю всегда приходит понятный русский текст.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ValidationError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Некорректный JSON в запросе.' });
  }
  const status = (error as { status?: number; statusCode?: number; type?: string })?.status
    ?? (error as { statusCode?: number })?.statusCode;
  if (status === 413 || (error as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Файл или запрос слишком большой.' });
  }
  // Подробности пишем только в журнал сервера, наружу отдаём нейтральный текст:
  // внутренние сообщения не должны попадать в интерфейс.
  console.error('[server] Необработанная ошибка:', error instanceof Error ? error.stack ?? error.message : error);
  return res.status(500).json({ error: 'Внутренняя ошибка сервера. Подробности в журнале сервера.' });
});

async function closeDatabase(): Promise<void> {
  // Данные пишутся атомарно на каждую мутацию, поэтому при остановке достаточно
  // выждать завершение текущих операций записи.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const protocol: 'http' | 'https' = HTTPS_KEY && HTTPS_CERT ? 'https' : 'http';
const onListening = () => {
  const mode = fs.existsSync(CLIENT_DIST) ? 'интерфейс + API' : 'только API (интерфейс запускайте через npm run dev)';
  const info = buildServerInfo(PORT, HOST, protocol);
  console.log(`АвтоЖурнал: ${info.localUrl} (${mode})`);
  if (info.lanUrls.length) {
    console.log('Открыть с телефона в той же сети Wi-Fi:');
    for (const url of info.lanUrls) console.log(`   ${url}`);
  } else {
    console.log('Адрес в локальной сети не найден — возможно, компьютер не подключён к Wi-Fi.');
  }
  console.log(`Файл базы данных: ${store.filePath}`);
};

const server =
  protocol === 'https'
    ? https.createServer(
        { key: fs.readFileSync(HTTPS_KEY as string), cert: fs.readFileSync(HTTPS_CERT as string) },
        app,
      ).listen(PORT, HOST, onListening)
    : app.listen(PORT, HOST, onListening);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\nПолучен ${signal}, останавливаю сервер…`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  });
}
