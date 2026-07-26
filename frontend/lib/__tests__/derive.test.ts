import { describe, expect, it } from 'vitest';
import { liveTotalValue, livePositions, totalUnrealizedPnl } from '../derive';
import type { Portfolio } from '../types';

const PORTFOLIO: Portfolio = {
  cash_balance: 5000,
  total_value: 7000,
  positions: [
    {
      ticker: 'AAPL',
      quantity: 10,
      avg_cost: 100,
      current_price: 110,
      market_value: 1100,
      unrealized_pnl: 100,
    },
    {
      ticker: 'TSLA',
      quantity: 5,
      avg_cost: 200,
      current_price: 180,
      market_value: 900,
      unrealized_pnl: -100,
    },
  ],
};

describe('livePositions', () => {
  it('returns an empty list before the portfolio loads', () => {
    expect(livePositions(null, {})).toEqual([]);
  });

  it('recomputes market value and P&L from the live stream price', () => {
    const [aapl] = livePositions(PORTFOLIO, { AAPL: { price: 120 } });

    expect(aapl.current_price).toBe(120);
    expect(aapl.market_value).toBe(1200);
    expect(aapl.unrealized_pnl).toBe(200);
    expect(aapl.pnl_percent).toBeCloseTo(20);
  });

  it('falls back to the fetched price for a ticker with no live tick', () => {
    const [, tsla] = livePositions(PORTFOLIO, { AAPL: { price: 120 } });

    expect(tsla.current_price).toBe(180);
    expect(tsla.market_value).toBe(900);
    expect(tsla.unrealized_pnl).toBe(-100);
    expect(tsla.pnl_percent).toBeCloseTo(-10);
  });

  it('weights positions by share of invested value, excluding cash', () => {
    const [aapl, tsla] = livePositions(PORTFOLIO, {});

    expect(aapl.weight).toBeCloseTo(1100 / 2000);
    expect(tsla.weight).toBeCloseTo(900 / 2000);
    expect(aapl.weight + tsla.weight).toBeCloseTo(1);
  });

  it('reports null P&L percent when cost basis is zero', () => {
    const zeroCost: Portfolio = {
      cash_balance: 0,
      total_value: 50,
      positions: [
        {
          ticker: 'FREE',
          quantity: 5,
          avg_cost: 0,
          current_price: 10,
          market_value: 50,
          unrealized_pnl: 50,
        },
      ],
    };

    expect(livePositions(zeroCost, {})[0].pnl_percent).toBeNull();
  });

  it('assigns zero weight when nothing is invested', () => {
    const empty: Portfolio = { cash_balance: 100, total_value: 100, positions: [] };
    expect(livePositions(empty, {})).toEqual([]);
  });
});

describe('liveTotalValue', () => {
  it('sums cash and live market values', () => {
    expect(liveTotalValue(PORTFOLIO, { AAPL: { price: 120 }, TSLA: { price: 200 } })).toBe(
      5000 + 1200 + 1000,
    );
  });

  it('equals cash alone with no positions', () => {
    const empty: Portfolio = { cash_balance: 10000, total_value: 10000, positions: [] };
    expect(liveTotalValue(empty, {})).toBe(10000);
  });

  it('returns zero before the portfolio loads', () => {
    expect(liveTotalValue(null, {})).toBe(0);
  });
});

describe('totalUnrealizedPnl', () => {
  it('nets gains against losses', () => {
    expect(totalUnrealizedPnl(livePositions(PORTFOLIO, {}))).toBe(0);
  });

  it('reflects live prices', () => {
    expect(totalUnrealizedPnl(livePositions(PORTFOLIO, { AAPL: { price: 130 } }))).toBe(200);
  });
});
