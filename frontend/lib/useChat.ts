'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { ChatMessage } from './types';

export interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
  send: (text: string) => Promise<void>;
}

/** `onActions` lets the terminal refetch the portfolio when the assistant's turn
 *  executed trades or edited the watchlist. */
export function useChat(onActions?: () => void): ChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.getChatHistory().then(setMessages, () => {});
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending) return;

      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: trimmed, actions: null, created_at: now },
      ]);
      setPending(true);

      try {
        const response = await api.sendChatMessage(trimmed);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: response.message,
            actions: response.actions ?? null,
            created_at: new Date().toISOString(),
          },
        ]);
        const changed =
          (response.actions?.trades?.length ?? 0) > 0 ||
          (response.actions?.watchlist_changes?.length ?? 0) > 0;
        if (changed) onActions?.();
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              error instanceof ApiError
                ? `Chat failed: ${error.message}`
                : 'Chat failed unexpectedly.',
            actions: null,
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        setPending(false);
      }
    },
    [pending, onActions],
  );

  return { messages, pending, send };
}
