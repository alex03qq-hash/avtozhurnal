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

    const provided = extractToken(req);
    if (provided && tokensMatch(provided, token)) return next();

    res.status(401).json({
      error: 'Нужен код доступа к журналу. Он задан в настройках приложения на компьютере.',
      code: 'auth_required',
    });
    return undefined;
  };
}
