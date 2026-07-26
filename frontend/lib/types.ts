export type Direction = 'up' | 'down' | 'flat';

export interface PriceTick {
  ticker: string;
  price: number;
  previous_price: number;
  timestamp: string;
  direction: Direction;
}

/** A ticker with no cached price yet streams nothing, so every field is nullable. */
export interface WatchlistEntry {
  ticker: string;
  price: number | null;
  previous_price: number | null;
  direction: Direction | null;
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
}

export interface Portfolio {
  cash_balance: number;
  positions: Position[];
  total_value: number;
}

export interface PortfolioSnapshot {
  total_value: number;
  recorded_at: string;
}

export type TradeSide = 'buy' | 'sell';

export interface TradeResult {
  ticker: string;
  side: TradeSide;
  quantity: number;
  fill_price: number;
  cash_balance: number;
}

export interface ChatTradeAction {
  ticker: string;
  side: TradeSide;
  quantity: number;
  fill_price?: number;
  status: 'executed' | 'rejected';
  error?: string;
}

export interface ChatWatchlistAction {
  ticker: string;
  action: 'add' | 'remove';
  status: 'applied' | 'rejected';
  error?: string;
}

export interface ChatActions {
  trades: ChatTradeAction[];
  watchlist_changes: ChatWatchlistAction[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions: ChatActions | null;
  created_at: string;
}

export interface ChatResponse {
  message: string;
  actions: ChatActions;
}

export interface Health {
  status: string;
  ollama: 'reachable' | 'unreachable';
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** A single point in the client-accumulated price series for one ticker. */
export interface PricePoint {
  t: number;
  p: number;
}
