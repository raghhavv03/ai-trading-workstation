import { expect, test } from '@playwright/test';
import {
  STARTING_CASH,
  cashBalance,
  positionRow,
  resetApp,
  sendChat,
  waitForPrice,
  waitForStreamingPrices,
  watchlistSymbols,
} from './helpers';

/** Runs against LLM_MOCK=true (PLAN.md §12), whose deterministic stand-in
 *  recognizes "buy 5 AAPL" and "add PYPL" phrasings. */
test.describe('AI chat (mocked LLM)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetApp(request);
    await page.goto('/');
    await waitForStreamingPrices(page);
  });

  test('answers a conversational message', async ({ page }) => {
    await sendChat(page, 'how is my portfolio doing');

    await expect(page.getByTestId('chat-message-user')).toHaveText(
      /how is my portfolio doing/,
    );
    await expect(page.getByTestId('chat-message-assistant')).toHaveText(
      /\[mock\] TradeAlly received: how is my portfolio doing/,
    );
    await expect(page.getByTestId('chat-actions')).toHaveCount(0);
  });

  test('shows a loading indicator while the turn is in flight', async ({ page }) => {
    // The mock replies instantly, so the pending state is only observable if the
    // response is held open deliberately.
    await page.route('**/api/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await sendChat(page, 'thinking test');

    await expect(page.getByTestId('chat-loading')).toBeVisible();
    await expect(page.getByLabel('Message TradeAlly')).toBeDisabled();
    await expect(page.getByTestId('chat-loading')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('chat-message-assistant')).toHaveCount(1);
  });

  test('auto-executes a trade and confirms it inline', async ({ page }) => {
    await waitForPrice(page, 'NVDA');

    await sendChat(page, 'buy 3 NVDA');

    await expect(page.getByTestId('chat-message-assistant')).toHaveText(
      /\[mock\] Executing 1 trade\(s\) as requested\./,
    );

    const actions = page.getByTestId('chat-actions');
    await expect(actions).toHaveCount(1);
    await expect(actions.locator('li')).toHaveText(/buy 3 NVDA @ [\d.]+/);

    // The executed trade must be visible in the portfolio, not just the transcript.
    await expect(positionRow(page, 'NVDA')).toHaveCount(1);
    await expect(positionRow(page, 'NVDA').locator('td').nth(1)).toHaveText('3');
    await expect
      .poll(async () => cashBalance(page), { message: 'chat-executed trade never debited cash' })
      .toBeLessThan(STARTING_CASH);
  });

  test('auto-applies a watchlist change and confirms it inline', async ({ page }) => {
    await sendChat(page, 'add PYPL');

    await expect(page.getByTestId('chat-message-assistant')).toHaveText(
      /\[mock\] Applying 1 watchlist change\(s\)\./,
    );

    const actions = page.getByTestId('chat-actions');
    await expect(actions.locator('li')).toHaveText(/watchlist add PYPL/);

    await expect
      .poll(async () => watchlistSymbols(page), {
        message: 'chat-applied watchlist change never reached the watchlist panel',
      })
      .toContain('PYPL');
  });

  test('surfaces a rejected trade rather than failing the turn', async ({ page }) => {
    await waitForPrice(page, 'AAPL');

    await sendChat(page, 'buy 99999 AAPL');

    const actions = page.getByTestId('chat-actions');
    await expect(actions.locator('li')).toHaveText(/AAPL rejected — Insufficient cash/);
    expect(await cashBalance(page)).toBe(STARTING_CASH);
  });

  test('restores conversation history after a reload', async ({ page }) => {
    await sendChat(page, 'remember this line');
    await expect(page.getByTestId('chat-message-assistant')).toHaveCount(1);

    await page.reload();

    await expect(page.getByTestId('chat-message-user')).toHaveText(/remember this line/);
    await expect(page.getByTestId('chat-message-assistant')).toHaveText(
      /\[mock\] TradeAlly received: remember this line/,
    );
  });
});
