import type { PricePoint } from '@/lib/types';

interface SparklineProps {
  points: PricePoint[];
  width?: number;
  height?: number;
}

/** Hand-rolled SVG rather than a charting library: one of these renders per
 *  watchlist row on every tick, so it has to stay allocation-cheap. */
export function Sparkline({ points, width = 72, height = 22 }: SparklineProps) {
  if (points.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Awaiting price history"
        data-testid="sparkline-empty"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          className="text-term-border"
        />
      </svg>
    );
  }

  const values = points.map((point) => point.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const pad = 2;
  const usable = height - pad * 2;

  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = pad + usable - ((value - min) / span) * usable;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const rising = values[values.length - 1] >= values[0];

  return (
    <svg width={width} height={height} role="img" aria-label="Price trend" data-testid="sparkline">
      <path
        d={path}
        fill="none"
        strokeWidth={1.25}
        stroke="currentColor"
        className={rising ? 'text-up' : 'text-down'}
      />
    </svg>
  );
}
