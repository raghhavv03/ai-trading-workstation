import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TradeAlly — AI Trading Workstation',
  description: 'Live market data, simulated portfolio, and an AI trading copilot.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
