import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TradeBar } from '../TradeBar';

function setup(overrides: Partial<Parameters<typeof TradeBar>[0]> = {}) {
  const props = {
    selected: 'AAPL',
    priceOf: (ticker: string) => (ticker === 'AAPL' ? 200 : null),
    cashBalance: 10000,
    onTrade: vi.fn(),
    ...overrides,
  };
  render(<TradeBar {...props} />);
  return props;
}

describe('TradeBar', () => {
  it('prefills the ticker from the chart selection', () => {
    setup();
    expect(screen.getByLabelText('Trade ticker')).toHaveValue('AAPL');
  });

  it('shows the live price and an order estimate for the typed symbol', async () => {
    const user = userEvent.setup();
    setup();

    await user.clear(screen.getByLabelText('Trade quantity'));
    await user.type(screen.getByLabelText('Trade quantity'), '3');

    expect(screen.getByText('200.00')).toBeInTheDocument();
    expect(screen.getByText('$600.00')).toBeInTheDocument();
  });

  it('submits a buy at the entered quantity', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.clear(screen.getByLabelText('Trade quantity'));
    await user.type(screen.getByLabelText('Trade quantity'), '2.5');
    await user.click(screen.getByRole('button', { name: 'Buy' }));

    expect(props.onTrade).toHaveBeenCalledWith('AAPL', 2.5, 'buy');
  });

  it('submits a sell', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole('button', { name: 'Sell' }));

    expect(props.onTrade).toHaveBeenCalledWith('AAPL', 1, 'sell');
  });

  it('upper-cases a manually typed symbol', async () => {
    const user = userEvent.setup();
    const props = setup({ selected: null });

    await user.type(screen.getByLabelText('Trade ticker'), 'nvda');
    await user.click(screen.getByRole('button', { name: 'Buy' }));

    expect(props.onTrade).toHaveBeenCalledWith('NVDA', 1, 'buy');
  });

  it('disables both sides for a non-positive quantity', async () => {
    const user = userEvent.setup();
    setup();

    await user.clear(screen.getByLabelText('Trade quantity'));
    await user.type(screen.getByLabelText('Trade quantity'), '0');

    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sell' })).toBeDisabled();
  });

  it('disables both sides with no symbol entered', () => {
    setup({ selected: null });
    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
  });

  it('displays the cash balance', () => {
    setup();
    expect(screen.getByText('$10,000.00')).toBeInTheDocument();
  });
});
