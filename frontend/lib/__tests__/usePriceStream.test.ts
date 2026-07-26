import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePriceStream } from '../usePriceStream';
import type { PriceTick } from '../types';

type Listener = (event: unknown) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  private listeners: Record<string, Listener[]> = {};

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, event: unknown = {}) {
    if (type === 'open') this.readyState = FakeEventSource.OPEN;
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  emitPrice(tick: PriceTick) {
    this.emit('price', { data: JSON.stringify(tick) });
  }
}

function tick(overrides: Partial<PriceTick> = {}): PriceTick {
  return {
    ticker: 'AAPL',
    price: 191.23,
    previous_price: 190.87,
    timestamp: '2026-07-23T14:02:31.500Z',
    direction: 'up',
    ...overrides,
  };
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];

/** Ticks are batched behind a 250ms timer before being committed to state. */
const flush = () => act(() => void vi.advanceTimersByTime(300));

describe('usePriceStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a stream against the SSE endpoint', () => {
    renderHook(() => usePriceStream());
    expect(latest().url).toBe('/api/stream/prices');
  });

  it('starts in the connecting state and reports connected on open', () => {
    const { result } = renderHook(() => usePriceStream());
    expect(result.current.status).toBe('connecting');

    act(() => latest().emit('open'));

    expect(result.current.status).toBe('connected');
  });

  it('records the latest price for each ticker', () => {
    const { result } = renderHook(() => usePriceStream());

    act(() => {
      latest().emitPrice(tick());
      latest().emitPrice(tick({ ticker: 'TSLA', price: 240 }));
    });
    flush();

    expect(result.current.prices.AAPL.price).toBe(191.23);
    expect(result.current.prices.TSLA.price).toBe(240);
  });

  it('accumulates price history client-side for sparklines', () => {
    const { result } = renderHook(() => usePriceStream());

    act(() => {
      latest().emitPrice(tick({ price: 100 }));
      latest().emitPrice(tick({ price: 101, timestamp: '2026-07-23T14:02:32.000Z' }));
    });
    flush();

    expect(result.current.history.AAPL.map((point) => point.p)).toEqual([100, 101]);
  });

  it('pins the session-open baseline to the first price seen', () => {
    const { result } = renderHook(() => usePriceStream());

    act(() => latest().emitPrice(tick({ price: 100 })));
    flush();
    act(() => latest().emitPrice(tick({ price: 150 })));
    flush();

    expect(result.current.sessionOpen.AAPL).toBe(100);
  });

  it('batches ticks rather than committing each one', () => {
    const { result } = renderHook(() => usePriceStream());

    act(() => latest().emitPrice(tick({ price: 100 })));
    expect(result.current.prices.AAPL).toBeUndefined();

    flush();
    expect(result.current.prices.AAPL.price).toBe(100);
  });

  it('ignores malformed event payloads', () => {
    const { result } = renderHook(() => usePriceStream());

    act(() => latest().emit('price', { data: 'not json' }));
    flush();

    expect(result.current.prices).toEqual({});
  });

  it('reports reconnecting while EventSource retries on its own', () => {
    const { result } = renderHook(() => usePriceStream());
    act(() => latest().emit('open'));

    act(() => {
      latest().readyState = FakeEventSource.CONNECTING;
      latest().emit('error');
    });

    expect(result.current.status).toBe('reconnecting');
  });

  it('reports disconnected and retries by hand when the stream is closed for good', () => {
    const { result } = renderHook(() => usePriceStream());

    act(() => {
      latest().readyState = FakeEventSource.CLOSED;
      latest().emit('error');
    });
    expect(result.current.status).toBe('disconnected');

    act(() => void vi.advanceTimersByTime(3100));
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => latest().emit('open'));
    expect(result.current.status).toBe('connected');
  });

  it('closes the stream on unmount', () => {
    const { unmount } = renderHook(() => usePriceStream());
    const source = latest();

    unmount();

    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = renderHook(() => usePriceStream());

    act(() => {
      latest().readyState = FakeEventSource.CLOSED;
      latest().emit('error');
    });
    unmount();
    act(() => void vi.advanceTimersByTime(5000));

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
