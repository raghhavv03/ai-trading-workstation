import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '../Sparkline';
import type { PricePoint } from '@/lib/types';

const points = (...values: number[]): PricePoint[] =>
  values.map((p, index) => ({ t: index, p }));

describe('Sparkline', () => {
  it('renders a flat placeholder until two points have accumulated', () => {
    render(<Sparkline points={points(190)} />);

    expect(screen.getByTestId('sparkline-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument();
  });

  it('plots one segment per point across the full width', () => {
    render(<Sparkline points={points(100, 105, 102)} width={60} height={20} />);

    const path = screen.getByTestId('sparkline').querySelector('path')!;
    const commands = path.getAttribute('d')!.split(' ');
    expect(commands).toHaveLength(3);
    expect(commands[0]).toMatch(/^M0\.0,/);
    expect(commands[2]).toMatch(/^L60\.0,/);
  });

  it('inverts the y axis so the highest price sits nearest the top', () => {
    render(<Sparkline points={points(100, 200)} height={22} />);

    const [, low, , high] = screen
      .getByTestId('sparkline')
      .querySelector('path')!
      .getAttribute('d')!
      .split(/[ ,]/)
      .map((token) => Number.parseFloat(token.replace(/^[ML]/, '')));

    expect(high).toBeLessThan(low);
  });

  it('tones the trend by its net direction over the window', () => {
    const { rerender } = render(<Sparkline points={points(100, 90, 120)} />);
    expect(screen.getByTestId('sparkline').querySelector('path')).toHaveClass('text-up');

    rerender(<Sparkline points={points(100, 120, 90)} />);
    expect(screen.getByTestId('sparkline').querySelector('path')).toHaveClass('text-down');
  });

  it('renders a finite path for an unchanged price series', () => {
    render(<Sparkline points={points(100, 100, 100)} />);

    const d = screen.getByTestId('sparkline').querySelector('path')!.getAttribute('d')!;
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
