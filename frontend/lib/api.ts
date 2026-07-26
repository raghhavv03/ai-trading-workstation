import type {
  ChatMessage,
  ChatResponse,
  Health,
  Portfolio,
  PortfolioSnapshot,
  TradeResult,
  TradeSide,
  WatchlistEntry,
} from './types';

/** Surfaces FastAPI's `{detail: "..."}` body as the error message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(0, 'Network error — is the backend running?');
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Non-JSON error body; the status-based default stands.
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  getPortfolio: () => request<Portfolio>('/api/portfolio'),

  getPortfolioHistory: () => request<PortfolioSnapshot[]>('/api/portfolio/history'),

  trade: (ticker: string, quantity: number, side: TradeSide) =>
    request<TradeResult>('/api/portfolio/trade', {
      method: 'POST',
      body: JSON.stringify({ ticker, quantity, side }),
    }),

  getWatchlist: () => request<WatchlistEntry[]>('/api/watchlist'),

  addTicker: (ticker: string) =>
    request<{ ticker: string }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ ticker }),
    }),

  removeTicker: (ticker: string) =>
    request<{ ticker: string }>(`/api/watchlist/${encodeURIComponent(ticker)}`, {
      method: 'DELETE',
    }),

  getChatHistory: () => request<ChatMessage[]>('/api/chat'),

  sendChatMessage: (message: string) =>
    request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  getHealth: () => request<Health>('/api/health'),

  reset: () => request<unknown>('/api/system/reset', { method: 'POST' }),
};
