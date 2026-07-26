import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '../Header';

function setup(overrides: Partial<Parameters<typeof Header>[0]> = {}) {
  const props = {
    totalValue: 10432.5,
    cashBalance: 8000,
    unrealizedPnl: 432.5,
    status: 'connected' as const,
    ollamaOffline: false,
    onReset: vi.fn(),
    ...overrides,
  };
  render(<Header {...props} />);
  return props;
}

describe('Header', () => {
  it('renders the live total value, cash and unrealized P&L', () => {
    setup();

    expect(screen.getByText('$10,432.50')).toBeInTheDocument();
    expect(screen.getByText('$8,000.00')).toBeInTheDocument();
    expect(screen.getByText('+$432.50')).toBeInTheDocument();
  });

  it('tones a losing P&L down and a winning one up', () => {
    const { rerender } = render(
      <Header
        totalValue={9000}
        cashBalance={8000}
        unrealizedPnl={-1000}
        status="connected"
        ollamaOffline={false}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText('-$1,000.00')).toHaveClass('text-down');

    rerender(
      <Header
        totalValue={11000}
        cashBalance={8000}
        unrealizedPnl={1000}
        status="connected"
        ollamaOffline={false}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText('+$1,000.00')).toHaveClass('text-up');
  });

  it('dashes the cash stat before the portfolio has loaded', () => {
    setup({ cashBalance: null });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('surfaces the connection status indicator', () => {
    setup({ status: 'disconnected' });
    expect(screen.getByTestId('connection-dot')).toHaveAttribute('data-status', 'disconnected');
  });

  it('shows the AI offline badge only when Ollama is unreachable', () => {
    const { rerender } = render(
      <Header
        totalValue={10000}
        cashBalance={10000}
        unrealizedPnl={0}
        status="connected"
        ollamaOffline={false}
        onReset={vi.fn()}
      />,
    );
    expect(screen.queryByText('AI offline')).not.toBeInTheDocument();

    rerender(
      <Header
        totalValue={10000}
        cashBalance={10000}
        unrealizedPnl={0}
        status="connected"
        ollamaOffline
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText('AI offline')).toBeInTheDocument();
  });

  it('triggers a portfolio reset', async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(props.onReset).toHaveBeenCalled();
  });
});
