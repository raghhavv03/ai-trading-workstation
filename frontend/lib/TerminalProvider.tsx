'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import { liveTotalValue, livePositions, type LivePosition } from './derive';
import { usePriceStream, type PriceStreamState } from './usePriceStream';
import type { Health, Portfolio, PortfolioSnapshot, TradeSide, WatchlistEntry } from './types';

export interface TerminalState {
  stream: PriceStreamState;
  watchlist: WatchlistEntry[];
  portfolio: Portfolio | null;
  positions: LivePosition[];
  totalValue: number;
  snapshots: PortfolioSnapshot[];
  health: Health | null;
  selected: string | null;
  toast: string | null;
  select: (ticker: string) => void;
  addTicker: (ticker: string) => Promise<void>;
  removeTicker: (ticker: string) => Promise<void>;
  trade: (ticker: string, quantity: number, side: TradeSide) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}

const TerminalContext = createContext<TerminalState | null>(null);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong';
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const stream = usePriceStream();
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    const [list, folio, hist] = await Promise.allSettled([
      api.getWatchlist(),
      api.getPortfolio(),
      api.getPortfolioHistory(),
    ]);
    if (list.status === 'fulfilled') setWatchlist(list.value);
    if (folio.status === 'fulfilled') setPortfolio(folio.value);
    if (hist.status === 'fulfilled') setSnapshots(hist.value);

    const failure = [list, folio, hist].find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected') setToast(messageOf(failure.reason));
  }, []);

  useEffect(() => {
    void refresh();
    api.getHealth().then(setHealth, () => setHealth(null));
  }, [refresh]);

  // Snapshots are written server-side every 60s; poll at the same cadence so the
  // P&L chart keeps extending without a page reload.
  useEffect(() => {
    const timer = setInterval(() => {
      api.getPortfolioHistory().then(setSnapshots, () => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Default the main chart to the first streaming ticker, then leave it to the user.
  useEffect(() => {
    setSelected((current) => current ?? watchlist[0]?.ticker ?? null);
  }, [watchlist]);

  const addTicker = useCallback(
    async (raw: string) => {
      const ticker = raw.trim().toUpperCase();
      if (!ticker) return;
      try {
        await api.addTicker(ticker);
        setWatchlist(await api.getWatchlist());
        setToast(`${ticker} added to watchlist`);
      } catch (error) {
        setToast(messageOf(error));
      }
    },
    [],
  );

  const removeTicker = useCallback(async (ticker: string) => {
    try {
      await api.removeTicker(ticker);
      setWatchlist((prev) => prev.filter((entry) => entry.ticker !== ticker));
      setSelected((current) => (current === ticker ? null : current));
      setToast(`${ticker} removed from watchlist`);
    } catch (error) {
      setToast(messageOf(error));
    }
  }, []);

  const trade = useCallback(
    async (ticker: string, quantity: number, side: TradeSide) => {
      try {
        const result = await api.trade(ticker.trim().toUpperCase(), quantity, side);
        setToast(
          `${side.toUpperCase()} ${result.quantity} ${result.ticker} @ $${result.fill_price.toFixed(2)}`,
        );
        await refresh();
      } catch (error) {
        setToast(messageOf(error));
      }
    },
    [refresh],
  );

  const positions = useMemo(
    () => livePositions(portfolio, stream.prices),
    [portfolio, stream.prices],
  );
  const totalValue = useMemo(
    () => liveTotalValue(portfolio, stream.prices),
    [portfolio, stream.prices],
  );

  const value: TerminalState = {
    stream,
    watchlist,
    portfolio,
    positions,
    totalValue,
    snapshots,
    health,
    selected,
    toast,
    select: setSelected,
    addTicker,
    removeTicker,
    trade,
    refresh,
    notify,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useTerminal(): TerminalState {
  const context = useContext(TerminalContext);
  if (!context) throw new Error('useTerminal must be used within a TerminalProvider');
  return context;
}
