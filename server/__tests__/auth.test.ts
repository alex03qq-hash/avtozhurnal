/** Тесты кода доступа: пригодность кода и поведение проверки запросов. */

import { describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware, describeTokenProblem, resetRateLimit } from '../src/auth.ts';

function fakeRequest(overrides: Record<string, unknown> = {}) {
  return {
    path: '/vehicles',
    query: {},
    headers: {},
    ...overrides,
  } as unknown as Parameters<ReturnType<typeof createAuthMiddleware>>[0];
}

function fakeResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return response as unknown as Parameters<ReturnType<typeof createAuthMiddleware>>[1] & {
    statusCode: number;
    body: unknown;
  };
}

describe('пригодность кода доступа', () => {
  it('принимает латинский код достаточной длины', () => {
    expect(describeTokenProblem('garage-4821')).toBeNull();
    expect(describeTokenProblem(null)).toBeNull();
  });

  it('отклоняет кириллицу — заголовки HTTP её не допускают', () => {
    expect(describeTokenProblem('гараж-4821')).toMatch(/латинские/i);
  });

  it('отклоняет пробелы внутри кода', () => {
    expect(describeTokenProblem('garage 4821')).toMatch(/латинские/i);
  });

  it('отклоняет слишком короткий код', () => {
    expect(describeTokenProblem('123')).toMatch(/коротк/i);
  });
});

describe('ограничение попыток ввода кода', () => {
  it('блокирует адрес после пяти неверных попыток, но пропускает верный код', () => {
    resetRateLimit();
    const middleware = createAuthMiddleware('garage-4821');
    const request = () => fakeRequest({ headers: { 'x-access-token': 'wrong-code' }, ip: '10.0.0.9' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = fakeResponse();
      middleware(request(), response, vi.fn());
      expect(response.statusCode).toBe(401);
    }

    const blocked = fakeResponse();
    middleware(request(), blocked, vi.fn());
    expect(blocked.statusCode).toBe(429);
    expect((blocked.body as { code?: string }).code).toBe('too_many_attempts');

    // Владелец не должен запирать себя сам: верный код проходит даже во время блокировки
    const allowed = fakeResponse();
    const next = vi.fn();
    middleware(fakeRequest({ headers: { 'x-access-token': 'garage-4821' }, ip: '10.0.0.9' }), allowed, next);
    expect(next).toHaveBeenCalled();
  });

  it('успешный вход сбрасывает счётчик неудач', () => {
    resetRateLimit();
    const middleware = createAuthMiddleware('garage-4821');
    const bad = fakeRequest({ headers: { 'x-access-token': 'wrong' }, ip: '10.0.0.8' });
    for (let attempt = 0; attempt < 4; attempt += 1) middleware(bad, fakeResponse(), vi.fn());
    middleware(fakeRequest({ headers: { 'x-access-token': 'garage-4821' }, ip: '10.0.0.8' }), fakeResponse(), vi.fn());

    const response = fakeResponse();
    middleware(bad, response, vi.fn());
    expect(response.statusCode).toBe(401); // счётчик снова с нуля, блокировки нет
  });
});

describe('проверка запросов', () => {
  it('без заданного кода пропускает всё', () => {
    const next = vi.fn();
    createAuthMiddleware(null)(fakeRequest(), fakeResponse(), next);
    expect(next).toHaveBeenCalled();
  });

  it('без кода в запросе отвечает 401', () => {
    const response = fakeResponse();
    const next = vi.fn();
    createAuthMiddleware('garage-4821')(fakeRequest(), response, next);
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect((response.body as { code?: string }).code).toBe('auth_required');
  });

  it('принимает код в заголовке Authorization', () => {
    const next = vi.fn();
    createAuthMiddleware('garage-4821')(
      fakeRequest({ headers: { authorization: 'Bearer garage-4821' } }),
      fakeResponse(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('принимает код в заголовке X-Access-Token', () => {
    const next = vi.fn();
    createAuthMiddleware('garage-4821')(fakeRequest({ headers: { 'x-access-token': 'garage-4821' } }), fakeResponse(), next);
    expect(next).toHaveBeenCalled();
  });

  it('пропускает служебные адреса без кода', () => {
    const next = vi.fn();
    createAuthMiddleware('garage-4821')(fakeRequest({ path: '/health' }), fakeResponse(), next);
    expect(next).toHaveBeenCalled();
  });

  it('отклоняет неверный код', () => {
    const response = fakeResponse();
    const next = vi.fn();
    createAuthMiddleware('garage-4821')(fakeRequest({ headers: { authorization: 'Bearer garage-0000' } }), response, next);
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
  });
});
