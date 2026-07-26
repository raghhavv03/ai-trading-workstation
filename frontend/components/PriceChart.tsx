'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from './Panel';
import { formatPercent, formatPrice, percentChange, toneClass } from '@/lib/format';
import type { PricePoint } from '@/lib/types';

interface PriceChartProps {
  ticker: string | null;
  points: PricePoint[];
  sessionOpen: number | null;
}

const AXIS = { stroke: '#7d8da3', fontSize: 10 };

export function PriceChart({ ticker, points, sessionOpen }: PriceChartProps) {
  const last = points.length > 0 ? points[points.length - 1].p : null;
  const change = last != null && sessionOpen != null ? percentChange(last, sessionOpen) : null;
  const rising = change == null || change >= 0;
  const stroke = rising ? '#2ea56f' : '#e0484d';

  const data = points.map((point) => ({
    time: new Date(point.t).toLocaleTimeString('en-US', { hour12: false }),
    price: point.p,
  }));

  return (
    <Panel
      title={ticker ? `${ticker} — Session` : 'Chart'}
      bodyClassName="overflow-hidden"
      actions={
        last != null && (
          <span className="flex items-baseline gap-2 text-xs tabular-nums">
            <span className="font-semibold text-term-text">{formatPrice(last)}</span>
            <span className={toneClass(change)}>{formatPercent(change)}</span>
          </span>
        )
      }
    >
      {data.length < 2 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-term-muted">
          {ticker
            ? 'Accumulating live prices — the chart fills in as the stream ticks.'
            : 'Select a symbol from the watchlist.'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#2a3444" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={{ stroke: '#2a3444' }} minTickGap={48} />
            <YAxis
              domain={['auto', 'auto']}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: '#2a3444' }}
              width={56}
              tickFormatter={(value: number) => value.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                background: '#141b26',
                border: '1px solid #2a3444',
                borderRadius: 4,
                fontSize: 11,
              }}
              labelStyle={{ color: '#7d8da3' }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke={stroke}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
