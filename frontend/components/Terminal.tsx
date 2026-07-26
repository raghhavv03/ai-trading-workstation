'use client';

import { useCallback, useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { Header } from './Header';
import { PnlChart } from './PnlChart';
import { PortfolioHeatmap } from './PortfolioHeatmap';
import { PositionsTable } from './PositionsTable';
import { PriceChart } from './PriceChart';
import { TradeBar } from './TradeBar';
import { WatchlistPanel } from './WatchlistPanel';
import { api } from '@/lib/api';
import { totalUnrealizedPnl } from '@/lib/derive';
import { useTerminal } from '@/lib/TerminalProvider';
import { useChat } from '@/lib/useChat';

export function Terminal() {
  const terminal = useTerminal();
  const { stream, positions, portfolio, watchlist, selected, snapshots, toast } = terminal;
  const [chatCollapsed, setChatCollapsed] = useState(false);

  const chat = useChat(terminal.refresh);

  const priceOf = useCallback(
    (ticker: string) => stream.prices[ticker]?.price ?? null,
    [stream.prices],
  );

  const reset = useCallback(async () => {
    if (!window.confirm('Reset the portfolio to $10,000 and clear all history?')) return;
    try {
      await api.reset();
      terminal.notify('Portfolio reset to seeded state');
      await terminal.refresh();
    } catch {
      terminal.notify('Reset failed');
    }
  }, [terminal]);

  return (
    <div className="flex h-full flex-col bg-term-bg text-term-text">
      <Header
        totalValue={terminal.totalValue}
        cashBalance={portfolio?.cash_balance ?? null}
        unrealizedPnl={totalUnrealizedPnl(positions)}
        status={stream.status}
        ollamaOffline={terminal.health?.ollama === 'unreachable'}
        onReset={reset}
      />

      <main className="flex min-h-0 flex-1 gap-2 p-2">
        <WatchlistPanel
          entries={watchlist}
          prices={stream.prices}
          history={stream.history}
          sessionOpen={stream.sessionOpen}
          selected={selected}
          onSelect={terminal.select}
          onAdd={terminal.addTicker}
          onRemove={terminal.removeTicker}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="min-h-[200px] flex-[3]">
            <PriceChart
              ticker={selected}
              points={selected ? (stream.history[selected] ?? []) : []}
              sessionOpen={selected ? (stream.sessionOpen[selected] ?? null) : null}
            />
          </div>

          <div className="flex min-h-[170px] flex-[2] gap-2">
            <div className="min-w-0 flex-1">
              <PortfolioHeatmap positions={positions} />
            </div>
            <div className="min-w-0 flex-1">
              <PnlChart snapshots={snapshots} />
            </div>
          </div>

          <div className="min-h-[150px] flex-[2]">
            <PositionsTable positions={positions} onSelect={terminal.select} />
          </div>

          <TradeBar
            selected={selected}
            priceOf={priceOf}
            cashBalance={portfolio?.cash_balance ?? null}
            onTrade={terminal.trade}
          />
        </div>

        <ChatPanel
          messages={chat.messages}
          pending={chat.pending}
          collapsed={chatCollapsed}
          onToggle={() => setChatCollapsed((value) => !value)}
          onSend={chat.send}
        />
      </main>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded border border-term-border bg-term-elev px-4 py-2 text-xs shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
