'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

interface PriceCellProps {
  price: number | null;
  className?: string;
}

/** Applies a one-shot green/red flash class whenever the price changes, then
 *  clears it so the next tick can re-trigger the CSS animation from the start. */
export function PriceCell({ price, className = '' }: PriceCellProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const previous = useRef<number | null>(price);

  useEffect(() => {
    const before = previous.current;
    previous.current = price;
    if (price == null || before == null || price === before) return;

    setFlash(price > before ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), 500);
    return () => clearTimeout(timer);
  }, [price]);

  const flashClass = flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : '';

  return (
    <span
      data-testid="price-cell"
      data-flash={flash ?? 'none'}
      className={`inline-block rounded px-1 tabular-nums ${flashClass} ${className}`}
    >
      {formatPrice(price)}
    </span>
  );
}
