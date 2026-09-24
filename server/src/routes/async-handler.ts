/**
 * Обёртка для асинхронных обработчиков Express 4.
 *
 * Express 4 сам перехватывает только синхронные исключения: если асинхронный
 * обработчик «упадёт» (например, валидация бросит ValidationError), отклонённый
 * промис никто не поймает, и процесс завершится. Обёртка передаёт ошибку
 * в next(), после чего её обрабатывает общий обработчик ошибок в index.ts.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function ah(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
