import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WatchlistPanel } from '../WatchlistPanel';
import type { WatchlistEntry } from '@/lib/types';

const ENTRIES: WatchlistEntry[] = [
  { ticker: 'AAPL', price: 190, previous_price: 189, direction: 'up' },
  { ticker: 'TSLA', price: 240, previous_price: 245, direction: 'down' },
];

function setup(overrides: Partial<Parameters<typeof WatchlistPanel>[0]> = {}) {
  const props = {
    entries: ENTRIES,
    prices: { AAPL: { price: 191.5 }, TSLA: { price: 238 } },
    history: { AAPL: [{ t: 1, p: 189 }, { t: 2, p: 191.5 }] },
    sessionOpen: { AAPL: 190, TSLA: 240 },
    selected: 'AAPL',
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<WatchlistPanel {...props} />);
  return props;
}

describe('WatchlistPanel', () => {
  it('renders a row per watched ticker', () => {
    setup();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('TSLA')).toBeInTheDocument();
  });

  it('prefers the live streamed price over the fetched snapshot', () => {
    setup();
    expect(screen.getAllByTestId('price-cell')[0]).toHaveTextContent('191.50');
  });

  it('computes change % against the session-open baseline', () => {
    setup();
    // AAPL: 190 -> 191.50 = +0.79%; TSLA: 240 -> 238 = -0.83%
    expect(screen.getByText('+0.79%')).toBeInTheDocument();
    expect(screen.getByText('-0.83%')).toBeInTheDocument();
  });

  it('adds a ticker, upper-casing the input', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(screen.getByLabelText('Add ticker'), 'nvda');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.onAdd).toHaveBeenCalledWith('NVDA');
  });

  it('clears the add field after submitting', async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByLabelText('Add ticker') as HTMLInputElement;

    await user.type(input, 'PYPL');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(input.value).toBe('');
  });

  it('ignores an empty add submission', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it('removes a ticker without also selecting its row', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole('button', { name: 'Remove TSLA' }));

    expect(props.onRemove).toHaveBeenCalledWith('TSLA');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('selects a ticker when its row is clicked', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByText('TSLA'));

    expect(props.onSelect).toHaveBeenCalledWith('TSLA');
  });

  it('renders a sparkline once two points have accumulated, and a placeholder before that', () => {
    setup();
    expect(screen.getAllByTestId('sparkline')).toHaveLength(1);
    expect(screen.getAllByTestId('sparkline-empty')).toHaveLength(1);
  });

  it('shows an empty state when nothing is watched', () => {
    setup({ entries: [] });
    expect(screen.getByText(/watchlist is empty/i)).toBeInTheDocument();
  });
});
