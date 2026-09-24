/**
 * Тонкий клиент REST API. Никаких секретов: приложение полностью локальное.
 */

import type {
  ChecklistItem,
  ConsumptionSegment,
  Database,
  Expense,
  FuelEntry,
  Income,
  OverviewStats,
  Part,
  ServiceRule,
  Settings,
  Trip,
  Vehicle,
  WearStatus,
} from '../../shared/types.ts';

const TOKEN_KEY = 'avtozhurnal.accessToken';

/** Код доступа хранится только в этом браузере и никогда не уходит в файл базы. */
export function getAccessToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAccessToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим браузера — код просто не сохранится */
  }
}

/** Сервер ответил 401: нужен код доступа. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Нужен код доступа к журналу.');
    this.name = 'AuthRequiredError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Access-Token': token } : {}),
    },
    ...init,
  });

  if (response.status === 401) throw new AuthRequiredError();

  if (!response.ok) {
    let message = `Ошибка запроса (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      /* тело ответа может быть пустым — оставляем исходное сообщение */
    }
    throw new Error(message);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  health: () => request<{ ok: boolean; dataFile: string; vehicles: number }>('/health'),

  settings: () => request<Settings>('/settings'),
  network: () =>
    request<{
      port: number;
      host: string;
      protocol: 'http' | 'https';
      localUrl: string;
      lanUrls: string[];
      installable: boolean;
      authEnabled: boolean;
    }>('/network'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  list: <T>(collection: string, params: Record<string, string | undefined> = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][]);
    const suffix = query.toString() ? `?${query}` : '';
    return request<T[]>(`/${collection}${suffix}`);
  },
  create: <T>(collection: string, body: Record<string, unknown>) =>
    request<T>(`/${collection}`, { method: 'POST', body: JSON.stringify(body) }),
  update: <T>(collection: string, id: string, body: Record<string, unknown>) =>
    request<T>(`/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (collection: string, id: string) =>
    request<{ ok: boolean; removed?: Record<string, number> }>(`/${collection}/${id}`, { method: 'DELETE' }),

  completeRule: (id: string, body: Record<string, unknown> = {}) =>
    request<ServiceRule>(`/rules/${id}/complete`, { method: 'POST', body: JSON.stringify(body) }),

  overview: (vehicleId?: string) => request<OverviewStats>(`/stats/overview${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
  consumption: (vehicleId?: string) =>
    request<{
      unit: string;
      average: number | null;
      method: string;
      averagePrice: number | null;
      segments: ConsumptionSegment[];
      points: Array<{ date: string; odometer: number; volume: number; totalCost: number; isFullTank: boolean; station: string }>;
    }>(`/stats/consumption${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
  monthly: (vehicleId?: string, months = 12) =>
    request<Array<{ key: string; fuel: number; other: number; total: number }>>(
      `/stats/monthly?months=${months}${vehicleId ? `&vehicleId=${vehicleId}` : ''}`,
    ),
  categories: (vehicleId?: string) =>
    request<Array<{ category: string; label: string; amount: number; share: number }>>(
      `/stats/categories${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
    ),
  reminders: (vehicleId?: string) =>
    request<{ odometer: number; items: Array<WearStatus & { rule: ServiceRule | null }> }>(
      `/reminders${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
    ),
  trips: (vehicleId?: string) =>
    request<{
      averageConsumption: number | null;
      averagePrice: number | null;
      trips: Array<Trip & { estimatedCost: number | null; estimatedProfit: number | null }>;
    }>(`/stats/trips${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
  insights: (vehicleId?: string) =>
    request<{
      kmPerMonth: number;
      currentOdometer: number;
      style: {
        actual: number | null;
        reference: number;
        deviationPercent: number | null;
        wearFactor: number;
        label: string;
        explanation: string;
      };
      forecast: Array<{
        ruleId: string;
        name: string;
        adjustedRemainingKm: number | null;
        monthsLeft: number | null;
        predictedDate: string | null;
        adjustedPercent: number | null;
        status: 'ok' | 'soon' | 'overdue';
      }>;
      ownership: {
        monthlyAverage: number;
        costPerKmNow: number | null;
        costPerKmBefore: number | null;
        costTrendPercent: number | null;
        verdict: string;
        explanation: string;
      };
    }>(`/stats/insights${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),

  dossier: (vehicleId: string) => request<Dossier>(`/reports/dossier?vehicleId=${vehicleId}`),

  uploadPhoto: (dataUrl: string) =>
    request<{ id: string; bytes: number; url: string; message: string }>('/photos', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    }),
  removePhoto: (id: string) => request<{ ok: boolean }>(`/photos/${id}`, { method: 'DELETE' }),

  loadDemo: () => request<{ ok: boolean; message: string; summary: Record<string, number> }>('/demo', { method: 'POST' }),
  clearAll: () => request<{ ok: boolean; message: string }>('/demo', { method: 'DELETE' }),
  importJson: (mode: 'replace' | 'merge', data: Partial<Database>) =>
    request<{ ok: boolean; mode: string; added: Record<string, number>; message: string }>('/import/json', {
      method: 'POST',
      body: JSON.stringify({ mode, data }),
    }),
};

/**
 * Ссылки на скачивание открываются браузером напрямую (без заголовков),
 * поэтому код доступа передаётся в адресе. Для домашней сети это допустимо.
 */
function withToken(url: string): string {
  const token = getAccessToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export const csvUrl = (vehicleId?: string, type: 'fuel' | 'expenses' | 'incomes' | 'all' = 'all') =>
  withToken(`/api/export/csv?type=${type}${vehicleId ? `&vehicleId=${vehicleId}` : ''}`);

export const jsonUrl = (vehicleId?: string) => withToken(`/api/export/json${vehicleId ? `?vehicleId=${vehicleId}` : ''}`);

/** Файл календаря с ближайшими сроками ТО — открывается в календаре телефона. */
export const calendarUrl = (vehicleId?: string) =>
  withToken(`/api/reminders/calendar.ics${vehicleId ? `?vehicleId=${vehicleId}` : ''}`);

/** Фото чека открывается как картинка — код доступа передаём в адресе. */
export const photoUrl = (photoId: string) => withToken(`/api/photos/${photoId}`);

/** QR-код открывается как картинка, поэтому код доступа тоже передаём в адресе. */
export const qrUrl = (url: string) => withToken(`/api/network/qr.svg?url=${encodeURIComponent(url)}`);

export interface Dossier {
  generatedAt: string;
  vehicle: Vehicle & { fuelTypeLabel: string; unit: string };
  ownership: {
    since: string;
    sinceLabel: string;
    months: number;
    monthsLabel: string;
    currentOdometer: number;
    distanceUnderOwnership: number;
    distancePerMonth: number;
  };
  economics: {
    totalSpend: number;
    fuelSpend: number;
    otherSpend: number;
    income: number;
    profit: number;
    costPerKm: number | null;
    fuelCostPerKm: number | null;
    costPerMonth: number;
    liters: number;
    l100km: number | null;
    consumptionMethod: string;
    averagePrice: number | null;
  };
  categories: Array<{ category: string; label: string; amount: number; share: number }>;
  monthly: Array<{ key: string; fuel: number; other: number; total: number }>;
  maintenance: Array<{
    date: string;
    dateLabel: string;
    category: string;
    amount: number;
    odometer: number | null;
    description: string;
    vendor: string;
  }>;
  parts: Part[];
  wear: WearStatus[];
  fuelHistory: Array<FuelEntry & { unit: string }>;
  monthKey: string;
}

export type { ChecklistItem, Expense, FuelEntry, Income, Part, ServiceRule, Trip, Vehicle };
