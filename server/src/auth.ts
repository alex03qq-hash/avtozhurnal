/**
 * Код доступа к журналу.
 *
 * Пока компьютер и телефон в одной сети Wi-Fi, журнал по умолчанию открыт любому,
 * кто к этой сети подключён. Если задать переменную окружения ACCESS_TOKEN, сервер
 * начнёт требовать код: без него API отвечает 401, а в приложении появляется экран входа.
 *
 * Код хранится только в окружении компьютера и в памяти браузера телефона —
 * в файл базы и в репозиторий он не попадает.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Методы, доступные без кода: экрану входа нужно понять, что связь есть. */
const PUBLIC_PATHS = new Set(['/health', '/network']);

/** Ограничение попыток: пять промахов — и адрес отключается на 15 минут. */
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();

function checkRateLimit(key: string): number {
  const record = failedAttempts.get(key);
  if (!record) return 0;
  if (record.blockedUntil > Date.now()) return Math.ceil((record.blockedUntil - Date.now()) / 1000);
  if (record.blockedUntil && record.blockedUntil <= Date.now()) failedAttempts.delete(key);
  return 0;
}

function registerFailure(key: string): void {
  const record = failedAttempts.get(key) ?? { count: 0, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = Date.now() + BLOCK_MS;
    record.count = 0;
  }
  failedAttempts.set(key, record);
}

/** Сброс счётчика попыток — вызывается и в тестах. */
export function resetRateLimit(): void {
  failedAttempts.clear();
}

export function readAccessToken(): string | null {
  const token = process.env.ACCESS_TOKEN?.trim();
  return token ? token : null;
}

/**
 * Код передаётся в HTTP-заголовке, а заголовки допускают только символы ASCII.
 * Кириллический или пробельный код приведёт к тому, что вход молча не сработает,
 * поэтому такой код отклоняем сразу и с понятным объяснением.
 */
export function describeTokenProblem(token: string | null): string | null {
  if (!token) return null;
  if (!/^[\x21-\x7e]+$/.test(token)) {
    return 'ACCESS_TOKEN может содержать только латинские буквы, цифры и знаки без пробелов (например, garage-4821).';
  }
  if (token.length < 6) {
    return 'ACCESS_TOKEN слишком короткий: используйте не меньше 6 символов, иначе код легко подобрать.';
  }
  return null;
}

/** Сравнение за постоянное время, чтобы код нельзя было подобрать по скорости ответа. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const custom = req.headers['x-access-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  if (typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

export function createAuthMiddleware(token: string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!token) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();

    const key = req.ip ?? 'unknown';

    // Сначала проверяем сам код: верный пропускаем всегда, чтобы владелец не запирал себя сам.
    const provided = extractToken(req);
    if (provided && tokensMatch(provided, token)) {
      failedAttempts.delete(key);
      return next();
    }

    // Неверный код: если попыток слишком много — временная блокировка адреса.
    const blockedFor = checkRateLimit(key);
    if (blockedFor > 0) {
      res.status(429).json({
        error: `Слишком много неверных попыток. Попробуйте снова через ${Math.ceil(blockedFor / 60)} мин.`,
        code: 'too_many_attempts',
        retryAfter: blockedFor,
      });
      return undefined;
    }

    registerFailure(key);
    res.status(401).json({
      error: 'Нужен код доступа к журналу. Он задан в настройках приложения на компьютере.',
      code: 'auth_required',
    });
    return undefined;
  };
}
