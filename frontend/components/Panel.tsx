import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, children, actions, className = '', bodyClassName = '' }: PanelProps) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded border border-term-border bg-term-panel ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-term-border bg-term-elev/60 px-3 py-1.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-term-muted">
          {title}
        </h2>
        {actions}
      </header>
      <div className={`min-h-0 flex-1 overflow-auto ${bodyClassName}`}>{children}</div>
    </section>
  );
}
