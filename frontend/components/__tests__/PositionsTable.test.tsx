import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PositionsTable } from '../PositionsTable';
import type { LivePosition } from '@/lib/derive';

const POSITIONS: LivePosition[] = [
  {
    ticker: 'AAPL',
    quantity: 10,
    avg_cost: 190,
    current_price: 200,
    market_value: 2000,
    unrealized_pnl: 100,
    pnl_percent: 5.263157894736842,
    weight: 0.8,
  },
  {
    ticker: 'TSLA',
    quantity: 2.5,
    avg_cost: 240,
    current_price: 200,
    market_value: 500,
    unrealized_pnl: -100,
    pnl_percent: -16.666666666666664,
    weight: 0.2,
  },
];

describe('PositionsTable', () => {
  it('shows the open position count in the panel title', () => {
    render(<PositionsTable positions={POSITIONS} onSelect={vi.fn()} />);
    expect(screen.getByText('Positions (2)')).toBeInTheDocument();
  });

  it('renders quantity, avg cost, market value, P&L and % for each row', () => {
    render(<PositionsTable positions={POSITIONS} onSelect={vi.fn()} />);

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('190.00')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('+$100.00')).toBeInTheDocument();
    expect(screen.getByText('+5.26%')).toBeInTheDocument();
  });

  it('renders losses with a negative sign and the down tone', () => {
    render(<PositionsTable positions={POSITIONS} onSelect={vi.fn()} />);

    const loss = screen.getByText('-$100.00');
    expect(loss).toBeInTheDocument();
    expect(loss).toHaveClass('text-down');
    expect(screen.getByText('-16.67%')).toBeInTheDocument();
  });

  it('trims trailing zeros from fractional share quantities', () => {
    render(<PositionsTable positions={POSITIONS} onSelect={vi.fn()} />);
    expect(screen.getByText('2.5')).toBeInTheDocument();
  });

  it('selects the ticker when a row is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PositionsTable positions={POSITIONS} onSelect={onSelect} />);

    await user.click(screen.getByText('TSLA'));

    expect(onSelect).toHaveBeenCalledWith('TSLA');
  });

  it('shows an empty state with no positions', () => {
    render(<PositionsTable positions={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('No open positions.')).toBeInTheDocument();
  });
});
