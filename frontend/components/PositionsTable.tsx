'use client';

import { Panel } from './Panel';
import { PriceCell } from './PriceCell';
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatSignedCurrency,
  toneClass,
} from '@/lib/format';
import type { LivePosition } from '@/lib/derive';

interface PositionsTableProps {
  positions: LivePosition[];
  onSelect: (ticker: string) => void;
}

const HEADERS = ['Symbol', 'Qty', 'Avg Cost', 'Last', 'Mkt Value', 'P&L', '%'];

export function PositionsTable({ positions, onSelect }: PositionsTableProps) {
  return (
    <Panel title={`Positions (${positions.length})`}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-term-panel">
          <tr className="text-[9px] uppercase tracking-wider text-term-muted">
            {HEADERS.map((header, index) => (
              <th
                key={header}
                className={`px-2 py-1 font-medium ${index === 0 ? 'text-left' : 'text-right'}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 && (
            <tr>
              <td colSpan={HEADERS.length} className="px-2 py-6 text-center text-term-muted">
                No open positions.
              </td>
            </tr>
          )}
          {positions.map((position) => (
            <tr
              key={position.ticker}
              onClick={() => onSelect(position.ticker)}
              className="cursor-pointer border-t border-term-border/50 transition-colors hover:bg-term-row"
            >
              <td className="px-2 py-1 text-left font-semibold">{position.ticker}</td>
              <td className="px-2 py-1 text-right">{formatQuantity(position.quantity)}</td>
              <td className="px-2 py-1 text-right">{formatPrice(position.avg_cost)}</td>
              <td className="px-2 py-1 text-right">
                <PriceCell price={position.current_price} />
              </td>
              <td className="px-2 py-1 text-right">{formatCurrency(position.market_value)}</td>
              <td className={`px-2 py-1 text-right ${toneClass(position.unrealized_pnl)}`}>
                {formatSignedCurrency(position.unrealized_pnl)}
              </td>
              <td className={`px-2 py-1 text-right ${toneClass(position.pnl_percent)}`}>
                {formatPercent(position.pnl_percent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
