'use client';

import { useState, type FormEvent } from 'react';
import { Panel } from './Panel';
import { PriceCell } from './PriceCell';
import { Sparkline } from './Sparkline';
import { formatPercent, percentChange, toneClass } from '@/lib/format';
import type { PricePoint, WatchlistEntry } from '@/lib/types';

interface WatchlistPanelProps {
  entries: WatchlistEntry[];
  prices: Record<string, { price: number }>;
  history: Record<string, PricePoint[]>;
  sessionOpen: Record<string, number>;
  selected: string | null;
  onSelect: (ticker: string) => void;
  onAdd: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

export function WatchlistPanel({
  entries,
  prices,
  history,
  sessionOpen,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: WatchlistPanelProps) {
  const [draft, setDraft] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (!ticker) return;
    onAdd(ticker);
    setDraft('');
  };

  return (
    <Panel
      title="Watchlist"
      className="w-[300px] shrink-0"
      actions={
        <form onSubmit={submit} className="flex items-center gap-1">
          <input
            aria-label="Add ticker"
            placeholder="SYMBOL"
            value={draft}
            maxLength={5}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            className="w-20 rounded border border-term-border bg-term-bg px-1.5 py-0.5 text-[11px] uppercase text-term-text outline-none placeholder:text-term-muted/50 focus:border-primary"
          />
          <button
            type="submit"
            className="rounded bg-secondary px-2 py-0.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-85"
          >
            Add
          </button>
        </form>
      }
    >
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-term-panel">
          <tr className="text-[9px] uppercase tracking-wider text-term-muted">
            <th className="px-2 py-1 text-left font-medium">Symbol</th>
            <th className="px-2 py-1 text-right font-medium">Last</th>
            <th className="px-2 py-1 text-right font-medium">Chg%</th>
            <th className="px-2 py-1 text-center font-medium">Trend</th>
            <th className="w-6 px-1 py-1" />
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-6 text-center text-term-muted">
                Watchlist is empty — add a symbol above.
              </td>
            </tr>
          )}
          {entries.map((entry) => {
            const price = prices[entry.ticker]?.price ?? entry.price;
            const base = sessionOpen[entry.ticker];
            const change = price != null && base != null ? percentChange(price, base) : null;
            const isSelected = selected === entry.ticker;

            return (
              <tr
                key={entry.ticker}
                onClick={() => onSelect(entry.ticker)}
                aria-selected={isSelected}
                className={`cursor-pointer border-t border-term-border/50 transition-colors hover:bg-term-row ${
                  isSelected ? 'bg-term-row' : ''
                }`}
              >
                <td className="px-2 py-1 font-semibold text-term-text">
                  <span className={isSelected ? 'text-primary' : ''}>{entry.ticker}</span>
                </td>
                <td className="px-2 py-1 text-right">
                  <PriceCell price={price} />
                </td>
                <td className={`px-2 py-1 text-right ${toneClass(change)}`}>
                  {formatPercent(change)}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-center">
                    <Sparkline points={history[entry.ticker] ?? []} />
                  </div>
                </td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    aria-label={`Remove ${entry.ticker}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(entry.ticker);
                    }}
                    className="text-term-muted transition-colors hover:text-down"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
