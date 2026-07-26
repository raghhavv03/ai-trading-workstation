'use client';

import { Terminal } from '@/components/Terminal';
import { TerminalProvider } from '@/lib/TerminalProvider';

export default function Page() {
  return (
    <TerminalProvider>
      <Terminal />
    </TerminalProvider>
  );
}
