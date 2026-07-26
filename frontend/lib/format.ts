const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return currency.format(value);
}

export function formatSignedCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  // Rounded before signing so a value like -0.001 reads "+$0.00", not "-$0.00".
  const rounded = Number(value.toFixed(2));
  return `${rounded >= 0 ? '+' : '-'}${currency.format(Math.abs(rounded))}`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  return `${rounded >= 0 ? '+' : '-'}${Math.abs(rounded).toFixed(2)}%`;
}

/** Shares are fractional but rarely so — trailing zeros are noise in a dense table. */
export function formatQuantity(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export function percentChange(current: number, base: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return ((current - base) / base) * 100;
}

export function toneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return 'text-term-muted';
  return value > 0 ? 'text-up' : 'text-down';
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour12: false });
}
