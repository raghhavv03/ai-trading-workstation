import { ConnectionDot } from './ConnectionDot';
import { formatCurrency, formatSignedCurrency, toneClass } from '@/lib/format';
import type { ConnectionStatus } from '@/lib/types';

interface HeaderProps {
  totalValue: number;
  cashBalance: number | null;
  unrealizedPnl: number;
  status: ConnectionStatus;
  ollamaOffline: boolean;
  onReset: () => void;
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-[0.18em] text-term-muted">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

export function Header({
  totalValue,
  cashBalance,
  unrealizedPnl,
  status,
  ollamaOffline,
  onReset,
}: HeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-6 border-b border-term-border bg-term-elev px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-tight text-accent">FinAlly</span>
        <span className="hidden text-[10px] uppercase tracking-[0.2em] text-term-muted lg:inline">
          AI Trading Workstation
        </span>
      </div>

      <div className="flex items-center gap-5">
        <Stat label="Total Value" value={formatCurrency(totalValue)} />
        <Stat label="Cash" value={formatCurrency(cashBalance)} />
        <Stat
          label="Unrealized P&L"
          value={formatSignedCurrency(unrealizedPnl)}
          tone={toneClass(unrealizedPnl)}
        />
        {ollamaOffline && (
          <span
            className="hidden rounded border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent xl:inline"
            title="Ollama is unreachable — the AI chat will return fallback responses."
          >
            AI offline
          </span>
        )}
        <ConnectionDot status={status} />
        <button
          type="button"
          onClick={onReset}
          title="Reset portfolio to the seeded $10,000 state"
          className="rounded border border-term-border px-2 py-1 text-[10px] uppercase tracking-wider text-term-muted transition-colors hover:border-down/60 hover:text-down"
        >
          Reset
        </button>
      </div>
    </header>
  );
}
