import { render, screen } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PriceChart } from '../PriceChart';
import type { PricePoint } from '@/lib/types';

type ChartElement = ReactElement<{ width?: number; height?: number }>;

// jsdom reports a zero-size container, so recharts would render an empty chart.
// Pinning explicit dimensions lets the real chart draw.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ChartElement }) =>
      cloneElement(children, { width: 600, height: 300 }),
  };
});

const points = (...values: number[]): PricePoint[] =>
  values.map((p, index) => ({ t: Date.UTC(2026, 6, 25, 12, index), p }));

const lineStroke = (container: HTMLElement) =>
  container.querySelector('.recharts-line-curve')!.getAttribute('stroke');

describe('PriceChart', () => {
  it('asks for a selection when no ticker is chosen', () => {
    render(<PriceChart ticker={null} points={[]} sessionOpen={null} />);

    expect(screen.getByText('Chart')).toBeInTheDocument();
    expect(screen.getByText(/select a symbol from the watchlist/i)).toBeInTheDocument();
  });

  it('explains that the series is still filling in for a fresh selection', () => {
    render(<PriceChart ticker="AAPL" points={points(190)} sessionOpen={190} />);

    expect(screen.getByText('AAPL — Session')).toBeInTheDocument();
    expect(screen.getByText(/accumulating live prices/i)).toBeInTheDocument();
  });

  it('plots the price series once two points have streamed in', () => {
    const { container } = render(
      <PriceChart ticker="AAPL" points={points(190, 191, 192)} sessionOpen={190} />,
    );

    expect(container.querySelector('.recharts-line-curve')).toBeInTheDocument();
    expect(screen.queryByText(/accumulating live prices/i)).not.toBeInTheDocument();
  });

  it('headlines the latest price and the move against the session open', () => {
    render(<PriceChart ticker="AAPL" points={points(190, 195.5)} sessionOpen={190} />);

    expect(screen.getByText('195.50')).toBeInTheDocument();
    const change = screen.getByText('+2.89%');
    expect(change).toHaveClass('text-up');
  });

  it('draws the line red and tones the change down when below the session open', () => {
    const { container } = render(
      <PriceChart ticker="AAPL" points={points(190, 180.5)} sessionOpen={190} />,
    );

    expect(lineStroke(container)).toBe('#e0484d');
    expect(screen.getByText('-5.00%')).toHaveClass('text-down');
  });

  it('draws the line green when above the session open', () => {
    const { container } = render(
      <PriceChart ticker="AAPL" points={points(190, 199)} sessionOpen={190} />,
    );

    expect(lineStroke(container)).toBe('#2ea56f');
  });
});
