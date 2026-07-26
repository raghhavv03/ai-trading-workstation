import { render, screen } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PnlChart } from '../PnlChart';
import type { PortfolioSnapshot } from '@/lib/types';

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

const snapshot = (total_value: number, minute: number): PortfolioSnapshot => ({
  total_value,
  recorded_at: `2026-07-25T12:0${minute}:00Z`,
});

const areaStroke = (container: HTMLElement) =>
  container.querySelector('.recharts-area-curve')!.getAttribute('stroke');

describe('PnlChart', () => {
  it('explains the empty chart before two snapshots exist', () => {
    render(<PnlChart snapshots={[snapshot(10000, 0)]} />);

    expect(screen.getByText(/snapshots are recorded every 60s/i)).toBeInTheDocument();
    expect(document.querySelector('.recharts-area-curve')).toBeNull();
  });

  it('plots the value series once there is a curve to draw', () => {
    const { container } = render(
      <PnlChart snapshots={[snapshot(10000, 0), snapshot(10250, 1), snapshot(10500, 2)]} />,
    );

    expect(container.querySelector('.recharts-area-curve')).toBeInTheDocument();
    expect(screen.queryByText(/snapshots are recorded every 60s/i)).not.toBeInTheDocument();
  });

  it('shows the most recent portfolio value in the panel header', () => {
    render(<PnlChart snapshots={[snapshot(10000, 0), snapshot(10432.5, 1)]} />);
    expect(screen.getByText('$10,432.50')).toBeInTheDocument();
  });

  it('draws the curve green when the portfolio is up on the session', () => {
    const { container } = render(
      <PnlChart snapshots={[snapshot(10000, 0), snapshot(10500, 1)]} />,
    );
    expect(areaStroke(container)).toBe('#2ea56f');
  });

  it('draws the curve red when the portfolio is down on the session', () => {
    const { container } = render(<PnlChart snapshots={[snapshot(10000, 0), snapshot(9400, 1)]} />);
    expect(areaStroke(container)).toBe('#e0484d');
  });
});
