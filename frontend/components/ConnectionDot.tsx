import type { ConnectionStatus } from '@/lib/types';

const APPEARANCE: Record<ConnectionStatus, { color: string; label: string; pulse: boolean }> = {
  connecting: { color: 'bg-accent', label: 'Connecting', pulse: true },
  connected: { color: 'bg-up', label: 'Live', pulse: false },
  reconnecting: { color: 'bg-accent', label: 'Reconnecting', pulse: true },
  disconnected: { color: 'bg-down', label: 'Disconnected', pulse: false },
};

export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const { color, label, pulse } = APPEARANCE[status];
  return (
    <span className="flex items-center gap-1.5" title={`Price stream: ${label}`}>
      <span
        data-testid="connection-dot"
        data-status={status}
        className={`h-2 w-2 rounded-full ${color} ${pulse ? 'pulse-dot' : ''}`}
      />
      <span className="text-[10px] uppercase tracking-wider text-term-muted">{label}</span>
    </span>
  );
}
