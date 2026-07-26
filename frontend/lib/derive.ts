import type { Portfolio, Position, PriceTick } from './types';

export interface LivePosition extends Position {
  /** Unrealized P&L as a percentage of cost basis. */
  pnl_percent: number | null;
  /** Share of total invested market value, 0..1 — drives treemap rectangle size. */
  weight: number;
}

type PriceMap = Record<string, Pick<PriceTick, 'price'>>;

/** The REST payload's prices are as of the last fetch; the SSE cache is newer.
 *  Recomputing here keeps P&L ticking without refetching the portfolio. */
export function livePositions(
  portfolio: Portfolio | null,
  prices: PriceMap,
): LivePosition[] {
  if (!portfolio) return [];

  const priced = portfolio.positions.map((position) => {
    const current_price = prices[position.ticker]?.price ?? position.current_price;
    const market_value = position.quantity * current_price;
    const cost_basis = position.quantity * position.avg_cost;
    return {
      ...position,
      current_price,
      market_value,
      unrealized_pnl: market_value - cost_basis,
      pnl_percent: cost_basis === 0 ? null : ((market_value - cost_basis) / cost_basis) * 100,
    };
  });

  const invested = priced.reduce((sum, p) => sum + p.market_value, 0);
  return priced.map((p) => ({ ...p, weight: invested === 0 ? 0 : p.market_value / invested }));
}

export function liveTotalValue(portfolio: Portfolio | null, prices: PriceMap): number {
  if (!portfolio) return 0;
  return livePositions(portfolio, prices).reduce(
    (sum, p) => sum + p.market_value,
    portfolio.cash_balance,
  );
}

export function totalUnrealizedPnl(positions: LivePosition[]): number {
  return positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
}
