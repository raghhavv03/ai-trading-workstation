import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PriceCell } from '../PriceCell';

describe('PriceCell', () => {
  it('renders the price to two decimals', () => {
    render(<PriceCell price={191.2} />);
    expect(screen.getByTestId('price-cell')).toHaveTextContent('191.20');
  });

  it('renders a placeholder when no price has streamed yet', () => {
    render(<PriceCell price={null} />);
    expect(screen.getByTestId('price-cell')).toHaveTextContent('—');
  });

  it('does not flash on first render', () => {
    render(<PriceCell price={100} />);
    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveAttribute('data-flash', 'none');
    expect(cell).not.toHaveClass('flash-up');
  });

  it('flashes green on an uptick', () => {
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={101.5} />);

    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveClass('flash-up');
    expect(cell).toHaveAttribute('data-flash', 'up');
  });

  it('flashes red on a downtick', () => {
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={98.25} />);

    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveClass('flash-down');
    expect(cell).toHaveAttribute('data-flash', 'down');
  });

  it('does not flash when the price is unchanged', () => {
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={100} />);
    expect(screen.getByTestId('price-cell')).toHaveAttribute('data-flash', 'none');
  });

  it('clears the flash class after the ~500ms animation window', () => {
    vi.useFakeTimers();
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={101} />);
    expect(screen.getByTestId('price-cell')).toHaveClass('flash-up');

    act(() => {
      vi.advanceTimersByTime(600);
    });

    const cell = screen.getByTestId('price-cell');
    expect(cell).not.toHaveClass('flash-up');
    expect(cell).toHaveAttribute('data-flash', 'none');
  });

  it('re-triggers the flash on a subsequent tick', () => {
    vi.useFakeTimers();
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={101} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    rerender(<PriceCell price={99} />);

    expect(screen.getByTestId('price-cell')).toHaveClass('flash-down');
  });
});
