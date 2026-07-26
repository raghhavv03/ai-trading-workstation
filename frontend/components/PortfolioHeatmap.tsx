'use client';

import { ResponsiveContainer, Treemap } from 'recharts';
import { Panel } from './Panel';
import { formatPercent } from '@/lib/format';
import type { LivePosition } from '@/lib/derive';

/** Saturation ramps with the magnitude of the move, capped at ±5% so a single
 *  outlier does not wash every other tile out to the same flat colour. */
function pnlColor(percent: number | null): string {
  if (percent == null || percent === 0) return '#243040';
  const intensity = Math.min(Math.abs(percent) / 5, 1);
  const alpha = 0.2 + intensity * 0.65;
  return percent > 0 ? `rgba(46, 165, 111, ${alpha})` : `rgba(224, 72, 77, ${alpha})`;
}

interface TileProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ticker?: string;
  pnlPercent?: number | null;
}

function Tile({ x = 0, y = 0, width = 0, height = 0, ticker, pnlPercent }: TileProps) {
  if (!ticker || width <= 0 || height <= 0) return null;
  const showLabel = width > 42 && height > 26;
  const showPercent = width > 52 && height > 40;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={pnlColor(pnlPercent ?? null)}
        stroke="#0d1117"
        strokeWidth={2}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showPercent ? 6 : 0)}
          textAnchor="middle"
          fill="#d5dee9"
          fontSize={11}
          fontWeight={600}
        >
          {ticker}
        </text>
      )}
      {showPercent && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          fill="#d5dee9"
          fontSize={10}
          opacity={0.85}
        >
          {formatPercent(pnlPercent ?? null)}
        </text>
      )}
    </g>
  );
}

export function PortfolioHeatmap({ positions }: { positions: LivePosition[] }) {
  const data = positions
    .filter((position) => position.market_value > 0)
    .map((position) => ({
      ticker: position.ticker,
      size: position.market_value,
      pnlPercent: position.pnl_percent,
    }));

  return (
    <Panel title="Allocation / P&L" bodyClassName="overflow-hidden">
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-term-muted">
          No open positions — buy something to populate the heatmap.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="size"
            nameKey="ticker"
            isAnimationActive={false}
            content={<Tile />}
          />
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
