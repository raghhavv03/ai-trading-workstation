'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPrice } from '@/lib/format';
import type { TradeSide } from '@/lib/types';

interface TradeBarProps {
  selected: string | null;
  /** Resolved against the typed symbol, which may differ from the chart selection. */
  priceOf: (ticker: string) => number | null;
  cashBalance: number | null;
  onTrade: (ticker: string, quantity: number, side: TradeSide) => void;
}

export function TradeBar({ selected, priceOf, cashBalance, onTrade }: TradeBarProps) {
  const [ticker, setTicker] = useState(selected ?? '');
  const [quantity, setQuantity] = useState('1');

  // Clicking a watchlist row is the fastest way to load the ticket; typing in the
  // field afterwards still wins until the selection changes again.
  useEffect(() => {
    if (selected) setTicker(selected);
  }, [selected]);

  const symbol = ticker.trim().toUpperCase();
  const price = symbol ? priceOf(symbol) : null;
  const parsedQuantity = Number(quantity);
  const valid = symbol.length > 0 && Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const estimate = valid && price != null ? parsedQuantity * price : null;

  const submit = (side: TradeSide) => {
    if (!valid) return;
    onTrade(symbol, parsedQuantity, side);
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded border border-term-border bg-term-panel px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-term-muted">
        Order
      </span>

      <input
        aria-label="Trade ticker"
        placeholder="SYMBOL"
        value={ticker}
        maxLength={5}
        onChange={(event) => setTicker(event.target.value.toUpperCase())}
        className="w-24 rounded border border-term-border bg-term-bg px-2 py-1 text-xs uppercase outline-none placeholder:text-term-muted/50 focus:border-primary"
      />

      <input
        aria-label="Trade quantity"
        type="number"
        min="0"
        step="any"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        className="w-24 rounded border border-term-border bg-term-bg px-2 py-1 text-xs outline-none focus:border-primary"
      />

      <button
        type="button"
        disabled={!valid}
        onClick={() => submit('buy')}
        className="rounded bg-secondary px-4 py-1 text-xs font-semibold uppercase tracking-wide text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Buy
      </button>
      <button
        type="button"
        disabled={!valid}
        onClick={() => submit('sell')}
        className="rounded border border-down/70 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-down transition-colors hover:bg-down/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Sell
      </button>

      <div className="ml-auto flex items-center gap-4 text-[11px] text-term-muted">
        {price != null && (
          <span>
            Last <span className="text-term-text tabular-nums">{formatPrice(price)}</span>
          </span>
        )}
        {estimate != null && (
          <span>
            Est. <span className="text-term-text tabular-nums">{formatCurrency(estimate)}</span>
          </span>
        )}
        <span>
          Cash <span className="text-term-text tabular-nums">{formatCurrency(cashBalance)}</span>
        </span>
      </div>
    </div>
  );
}
