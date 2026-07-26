'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatPrice, formatQuantity } from '@/lib/format';
import type { ChatActions, ChatMessage } from '@/lib/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  pending: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSend: (text: string) => void;
}

function ActionBadges({ actions }: { actions: ChatActions }) {
  const trades = actions.trades ?? [];
  const changes = actions.watchlist_changes ?? [];
  if (trades.length === 0 && changes.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1" data-testid="chat-actions">
      {trades.map((trade, index) => {
        const ok = trade.status === 'executed';
        return (
          <li
            key={`trade-${index}`}
            className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${
              ok ? 'border-up/40 bg-up/10 text-up' : 'border-down/40 bg-down/10 text-down'
            }`}
          >
            {ok
              ? `${trade.side} ${formatQuantity(trade.quantity)} ${trade.ticker} @ ${formatPrice(trade.fill_price ?? null)}`
              : `${trade.side} ${trade.ticker} rejected — ${trade.error ?? 'validation failed'}`}
          </li>
        );
      })}
      {changes.map((change, index) => {
        const ok = change.status === 'applied';
        return (
          <li
            key={`watch-${index}`}
            className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${
              ok ? 'border-primary/40 bg-primary/10 text-primary' : 'border-down/40 bg-down/10 text-down'
            }`}
          >
            {ok
              ? `watchlist ${change.action} ${change.ticker}`
              : `watchlist ${change.action} ${change.ticker} rejected — ${change.error ?? 'failed'}`}
          </li>
        );
      })}
    </ul>
  );
}

export function ChatPanel({ messages, pending, collapsed, onToggle, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, pending]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Open AI assistant"
        className="flex w-9 shrink-0 flex-col items-center gap-2 rounded border border-term-border bg-term-panel py-3 text-[10px] uppercase tracking-[0.2em] text-term-muted transition-colors hover:text-accent"
      >
        <span className="[writing-mode:vertical-rl]">AI Assistant</span>
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <section className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded border border-term-border bg-term-panel">
      <header className="flex shrink-0 items-center justify-between border-b border-term-border bg-term-elev/60 px-3 py-1.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-term-muted">
          AI Assistant
        </h2>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse AI assistant"
          className="text-term-muted transition-colors hover:text-accent"
        >
          »
        </button>
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {messages.length === 0 && !pending && (
          <p className="text-xs leading-relaxed text-term-muted">
            Ask TradeAlly about your portfolio, request analysis, or tell it to trade — e.g.{' '}
            <span className="text-accent">&ldquo;buy 5 shares of NVDA&rdquo;</span>.
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.created_at}-${index}`}
            data-testid={`chat-message-${message.role}`}
            className={message.role === 'user' ? 'self-end text-right' : ''}
          >
            <span className="text-[9px] uppercase tracking-[0.18em] text-term-muted">
              {message.role === 'user' ? 'You' : 'TradeAlly'}
            </span>
            <div
              className={`mt-0.5 whitespace-pre-wrap rounded px-2.5 py-1.5 text-xs leading-relaxed ${
                message.role === 'user'
                  ? 'bg-secondary/25 text-term-text'
                  : 'bg-term-row text-term-text'
              }`}
            >
              {message.content}
            </div>
            {message.actions && <ActionBadges actions={message.actions} />}
          </div>
        ))}

        {pending && (
          <div data-testid="chat-loading" className="flex items-center gap-2 text-xs text-term-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
            TradeAlly is thinking…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex shrink-0 gap-2 border-t border-term-border p-2">
        <input
          aria-label="Message TradeAlly"
          placeholder="Ask or instruct…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={pending}
          className="min-w-0 flex-1 rounded border border-term-border bg-term-bg px-2 py-1.5 text-xs outline-none placeholder:text-term-muted/60 focus:border-primary disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded bg-secondary px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}
