'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, PricePoint, PriceTick } from './types';

/** ~5 minutes of 500ms ticks. Bounds memory on a page left open all day. */
const MAX_POINTS = 600;

/** The stream emits ~2 events/sec/ticker; committing each one would re-render the
 *  whole terminal 20+ times a second. Ticks are batched into this window instead. */
const FLUSH_INTERVAL_MS = 250;

/** Native EventSource only retries when the server closes a live stream. A failed
 *  initial connect leaves it CLOSED for good, so that case is retried by hand. */
const RECONNECT_DELAY_MS = 3000;

export interface PriceStreamState {
  prices: Record<string, PriceTick>;
  history: Record<string, PricePoint[]>;
  /** First price observed per ticker this session — the baseline for change %. */
  sessionOpen: Record<string, number>;
  status: ConnectionStatus;
}

const EMPTY: PriceStreamState = { prices: {}, history: {}, sessionOpen: {}, status: 'connecting' };

function applyTicks(state: PriceStreamState, ticks: PriceTick[]): PriceStreamState {
  const prices = { ...state.prices };
  const history = { ...state.history };
  const sessionOpen = { ...state.sessionOpen };

  for (const tick of ticks) {
    prices[tick.ticker] = tick;
    sessionOpen[tick.ticker] ??= tick.price;

    const parsed = Date.parse(tick.timestamp);
    const point: PricePoint = { t: Number.isNaN(parsed) ? Date.now() : parsed, p: tick.price };
    const series = history[tick.ticker] ?? [];
    history[tick.ticker] =
      series.length >= MAX_POINTS
        ? [...series.slice(series.length - MAX_POINTS + 1), point]
        : [...series, point];
  }

  return { ...state, prices, history, sessionOpen };
}

export function usePriceStream(url = '/api/stream/prices'): PriceStreamState {
  const [state, setState] = useState<PriceStreamState>(EMPTY);
  const buffer = useRef<PriceTick[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const ticks = buffer.current;
    if (ticks.length === 0) return;
    buffer.current = [];
    setState((prev) => applyTicks(prev, ticks));
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setState((prev) => ({ ...prev, status: 'disconnected' }));
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource(url);

      source.addEventListener('open', () => {
        setState((prev) => ({ ...prev, status: 'connected' }));
      });

      source.addEventListener('price', (event) => {
        try {
          buffer.current.push(JSON.parse((event as MessageEvent).data) as PriceTick);
        } catch {
          return;
        }
        if (flushTimer.current === null) {
          flushTimer.current = setTimeout(flush, FLUSH_INTERVAL_MS);
        }
      });

      source.addEventListener('error', () => {
        if (closed) return;
        if (source?.readyState === EventSource.CLOSED) {
          setState((prev) => ({ ...prev, status: 'disconnected' }));
          source?.close();
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        } else {
          setState((prev) => ({ ...prev, status: 'reconnecting' }));
        }
      });
    };

    connect();

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      buffer.current = [];
    };
  }, [url, flush]);

  return state;
}
