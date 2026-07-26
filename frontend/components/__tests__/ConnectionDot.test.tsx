import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionDot } from '../ConnectionDot';
import type { ConnectionStatus } from '@/lib/types';

const CASES: [ConnectionStatus, string, string][] = [
  ['connecting', 'Connecting', 'bg-accent'],
  ['connected', 'Live', 'bg-up'],
  ['reconnecting', 'Reconnecting', 'bg-accent'],
  ['disconnected', 'Disconnected', 'bg-down'],
];

describe('ConnectionDot', () => {
  it.each(CASES)('renders %s with its label and colour', (status, label, colorClass) => {
    render(<ConnectionDot status={status} />);

    const dot = screen.getByTestId('connection-dot');
    expect(dot).toHaveAttribute('data-status', status);
    expect(dot).toHaveClass(colorClass);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('pulses only while the stream is not settled', () => {
    const { rerender } = render(<ConnectionDot status="connecting" />);
    expect(screen.getByTestId('connection-dot')).toHaveClass('pulse-dot');

    rerender(<ConnectionDot status="connected" />);
    expect(screen.getByTestId('connection-dot')).not.toHaveClass('pulse-dot');
  });
});
