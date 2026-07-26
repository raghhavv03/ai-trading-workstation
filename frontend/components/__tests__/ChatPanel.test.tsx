import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../ChatPanel';
import type { ChatMessage } from '@/lib/types';

const MESSAGES: ChatMessage[] = [
  { role: 'user', content: 'buy 5 NVDA', actions: null, created_at: '2026-07-25T10:00:00Z' },
  {
    role: 'assistant',
    content: 'Done — bought 5 shares of NVDA.',
    actions: {
      trades: [
        { ticker: 'NVDA', side: 'buy', quantity: 5, fill_price: 120.5, status: 'executed' },
      ],
      watchlist_changes: [{ ticker: 'PYPL', action: 'add', status: 'applied' }],
    },
    created_at: '2026-07-25T10:00:04Z',
  },
];

function setup(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const props = {
    messages: MESSAGES,
    pending: false,
    collapsed: false,
    onToggle: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
  render(<ChatPanel {...props} />);
  return props;
}

describe('ChatPanel', () => {
  it('renders user and assistant messages', () => {
    setup();
    expect(screen.getByText('buy 5 NVDA')).toBeInTheDocument();
    expect(screen.getByText('Done — bought 5 shares of NVDA.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-user')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-assistant')).toBeInTheDocument();
  });

  it('renders executed trades inline as confirmations', () => {
    setup();
    expect(screen.getByTestId('chat-actions')).toBeInTheDocument();
    expect(screen.getByText('buy 5 NVDA @ 120.50')).toBeInTheDocument();
    expect(screen.getByText('watchlist add PYPL')).toBeInTheDocument();
  });

  it('renders a rejected trade with the backend error', () => {
    setup({
      messages: [
        {
          role: 'assistant',
          content: 'That would overdraw your cash.',
          actions: {
            trades: [
              {
                ticker: 'AAPL',
                side: 'buy',
                quantity: 999,
                status: 'rejected',
                error: 'Insufficient cash for this trade',
              },
            ],
            watchlist_changes: [],
          },
          created_at: '2026-07-25T10:01:00Z',
        },
      ],
    });

    expect(
      screen.getByText('buy AAPL rejected — Insufficient cash for this trade'),
    ).toBeInTheDocument();
  });

  it('shows the loading indicator while a turn is in flight', () => {
    setup({ pending: true });
    expect(screen.getByTestId('chat-loading')).toBeInTheDocument();
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it('hides the loading indicator when idle', () => {
    setup();
    expect(screen.queryByTestId('chat-loading')).not.toBeInTheDocument();
  });

  it('disables the input and send button while pending', () => {
    setup({ pending: true, messages: [] });
    expect(screen.getByLabelText('Message FinAlly')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends the drafted message and clears the field', async () => {
    const user = userEvent.setup();
    const props = setup();
    const input = screen.getByLabelText('Message FinAlly') as HTMLInputElement;

    await user.type(input, 'how is my portfolio?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(props.onSend).toHaveBeenCalledWith('how is my portfolio?');
    expect(input.value).toBe('');
  });

  it('shows a prompt hint when the conversation is empty', () => {
    setup({ messages: [] });
    expect(screen.getByText(/ask finally about your portfolio/i)).toBeInTheDocument();
  });

  it('collapses to a rail that can be reopened', async () => {
    const user = userEvent.setup();
    const props = setup({ collapsed: true });

    expect(screen.queryByLabelText('Message FinAlly')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open AI assistant' }));

    expect(props.onToggle).toHaveBeenCalled();
  });
});
