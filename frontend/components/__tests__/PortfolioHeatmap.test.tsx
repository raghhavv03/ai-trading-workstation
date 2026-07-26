import { render, screen } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioHeatmap } from '../PortfolioHeatmap';
import type { LivePosition } from '@/lib/derive';

type ChartElement = ReactElement<{ width?: number; height?: number }>;

// jsdom reports a zero-size container, so recharts would lay out zero-area
// tiles. Pinning explicit dimensions lets the real treemap draw.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ChartElement }) =>
      cloneElement(children, { width: 600, height: 300 }),
  };
});

function position(overrides: Partial<LivePosition> & { ticker: string }): LivePosition {
  return {
    quantity: 10,
    avg_cost: 100,
    current_price: 110,
    market_value: 1100,
    unrealized_pnl: 100,
    pnl_percent: 10,
    weight: 1,
    ...overrides,
  };
}

const tileFor = (container: HTMLElement, ticker: string) =>
  [...container.querySelectorAll('g')]
    .find((group) => group.querySelector('text')?.textContent === ticker)!
    .querySelector('rect')!;

describe('PortfolioHeatmap', () => {
  it('prompts the user to trade when there are no positions', () => {
    render(<PortfolioHeatmap positions={[]} />);
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument();
  });

  it('renders a labelled tile per position', () => {
    render(
      <PortfolioHeatmap
        positions={[
          position({ ticker: 'AAPL', market_value: 3000 }),
          position({ ticker: 'TSLA', market_value: 1000 }),
        ]}
      />,
    );

    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('TSLA')).toBeInTheDocument();
  });

  it('sizes tiles by market value, not by share count', () => {
    const { container } = render(
      <PortfolioHeatmap
        positions={[
          position({ ticker: 'AAPL', quantity: 1, market_value: 4500 }),
          position({ ticker: 'TSLA', quantity: 500, market_value: 500 }),
        ]}
      />,
    );

    const area = (ticker: string) => {
      const rect = tileFor(container, ticker);
      return Number(rect.getAttribute('width')) * Number(rect.getAttribute('height'));
    };

    expect(area('AAPL')).toBeGreaterThan(area('TSLA'));
  });

  it('colours gains green and losses red', () => {
    const { container } = render(
      <PortfolioHeatmap
        positions={[
          position({ ticker: 'AAPL', market_value: 2000, pnl_percent: 8 }),
          position({ ticker: 'TSLA', market_value: 2000, pnl_percent: -8 }),
        ]}
      />,
    );

    expect(tileFor(container, 'AAPL').getAttribute('fill')).toContain('rgba(46, 165, 111');
    expect(tileFor(container, 'TSLA').getAttribute('fill')).toContain('rgba(224, 72, 77');
  });

  it('saturates the tile in proportion to the size of the move', () => {
    const alphaOf = (fill: string) => Number(fill.match(/([\d.]+)\)$/)![1]);
    const { container } = render(
      <PortfolioHeatmap
        positions={[
          position({ ticker: 'AAPL', market_value: 2000, pnl_percent: 1 }),
          position({ ticker: 'TSLA', market_value: 2000, pnl_percent: 4 }),
        ]}
      />,
    );

    expect(alphaOf(tileFor(container, 'TSLA').getAttribute('fill')!)).toBeGreaterThan(
      alphaOf(tileFor(container, 'AAPL').getAttribute('fill')!),
    );
  });

  it('renders a flat tile for a position with no P&L percent', () => {
    const { container } = render(
      <PortfolioHeatmap
        positions={[position({ ticker: 'FREE', market_value: 2000, pnl_percent: null })]}
      />,
    );

    expect(tileFor(container, 'FREE').getAttribute('fill')).toBe('#243040');
  });

  it('drops positions with no market value rather than drawing a zero-area tile', () => {
    render(
      <PortfolioHeatmap
        positions={[
          position({ ticker: 'AAPL', market_value: 2000 }),
          position({ ticker: 'GONE', market_value: 0, quantity: 0 }),
        ]}
      />,
    );

    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.queryByText('GONE')).not.toBeInTheDocument();
  });
});
