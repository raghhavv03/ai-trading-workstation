import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatSignedCurrency,
  percentChange,
  toneClass,
} from '../format';

describe('formatCurrency', () => {
  it('formats with a thousands separator and two decimals', () => {
    expect(formatCurrency(10000)).toBe('$10,000.00');
  });

  it('renders a dash for missing values', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(Number.NaN)).toBe('—');
  });
});

describe('formatSignedCurrency', () => {
  it('prefixes the sign outside the currency symbol', () => {
    expect(formatSignedCurrency(125.5)).toBe('+$125.50');
    expect(formatSignedCurrency(-125.5)).toBe('-$125.50');
  });
});

describe('formatPrice', () => {
  it('always shows two decimals', () => {
    expect(formatPrice(191.2)).toBe('191.20');
  });
});

describe('formatPercent', () => {
  it('signs gains and losses', () => {
    expect(formatPercent(5.267)).toBe('+5.27%');
    expect(formatPercent(-5.267)).toBe('-5.27%');
  });

  it('never renders a negative zero', () => {
    expect(formatPercent(-0.001)).toBe('+0.00%');
    expect(formatSignedCurrency(-0.001)).toBe('+$0.00');
  });
});

describe('formatQuantity', () => {
  it('keeps up to four decimals and drops trailing zeros', () => {
    expect(formatQuantity(10)).toBe('10');
    expect(formatQuantity(2.5)).toBe('2.5');
    expect(formatQuantity(0.123456)).toBe('0.1235');
  });
});

describe('percentChange', () => {
  it('computes the move relative to the baseline', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
  });

  it('guards against a zero baseline', () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe('toneClass', () => {
  it('maps sign to the up/down/muted palette', () => {
    expect(toneClass(1)).toBe('text-up');
    expect(toneClass(-1)).toBe('text-down');
    expect(toneClass(0)).toBe('text-term-muted');
    expect(toneClass(null)).toBe('text-term-muted');
  });
});
