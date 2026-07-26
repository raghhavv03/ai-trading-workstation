'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from './Panel';
import { formatCurrency } from '@/lib/format';
import type { PortfolioSnapshot } from '@/lib/types';

const AXIS = { stroke: '#7d8da3', fontSize: 10 };

export function PnlChart({ snapshots }: { snapshots: PortfolioSnapshot[] }) {
  const data = snapshots.map((snapshot) => ({
    time: new Date(snapshot.recorded_at).toLocaleTimeString('en-US', { hour12: false }),
    value: snapshot.total_value,
  }));

  const first = data[0]?.value;
  const last = data[data.length - 1]?.value;
  const rising = first == null || last == null || last >= first;
  const stroke = rising ? '#2ea56f' : '#e0484d';

  return (
    <Panel
      title="Portfolio Value"
      bodyClassName="overflow-hidden"
      actions={
        last != null && (
          <span className="text-xs font-semibold tabular-nums">{formatCurrency(last)}</span>
        )
      }
    >
      {data.length < 2 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-term-muted">
          Snapshots are recorded every 60s — the curve appears shortly.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="pnl-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#2a3444" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={{ stroke: '#2a3444' }} minTickGap={40} />
            <YAxis
              domain={['auto', 'auto']}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: '#2a3444' }}
              width={62}
              tickFormatter={(value: number) => `$${Math.round(value).toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{
                background: '#141b26',
                border: '1px solid #2a3444',
                borderRadius: 4,
                fontSize: 11,
              }}
              labelStyle={{ color: '#7d8da3' }}
              formatter={(value: number) => [formatCurrency(value), 'Total']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={1.5}
              fill="url(#pnl-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
