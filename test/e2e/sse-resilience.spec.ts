import { expect, test, type Page } from '@playwright/test';
import { resetApp, waitForStreamingPrices, watchlistPrices } from './helpers';

const dot = (page: Page) => page.getByTestId('connection-dot');

/** Samples the indicator continuously: a native EventSource retry re-opens in
 *  ~3s, and polling per assertion can step straight over the middle state. */
async function recordStatusTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __statuses: string[] }).__statuses = [];
    setInterval(() => {
      const status = document
        .querySelector('[data-testid="connection-dot"]')
        ?.getAttribute('data-status');
      const seen = (window as unknown as { __statuses: string[] }).__statuses;
      if (status && seen[seen.length - 1] !== status) seen.push(status);
    }, 100);
  });
}

const statuses = (page: Page) =>
  page.evaluate(() => (window as unknown as { __statuses: string[] }).__statuses ?? []);

function ssePayload(ticker: string, price: number): string {
  return `event: price\ndata: ${JSON.stringify({
    ticker,
    price,
    previous_price: price - 0.5,
    timestamp: new Date().toISOString(),
    direction: 'up',
  })}\n\n`;
}

test.describe('SSE resilience', () => {
  test.beforeEach(async ({ request }) => {
    await resetApp(request);
  });

  test('streams from the real endpoint on a healthy connection', async ({ page }) => {
    await page.goto('/');
    await waitForStreamingPrices(page);
    await expect(dot(page)).toHaveAttribute('data-status', 'connected');
  });

  test('auto-reconnects when the server closes a live stream', async ({ page }) => {
    await recordStatusTransitions(page);

    // Owning the response is the only reliable way to end an *established*
    // stream: Chromium's offline emulation leaves open streaming responses
    // running, so the client never sees the disconnect.
    let connections = 0;
    await page.route('**/api/stream/prices', async (route) => {
      connections += 1;
      if (connections > 1) return route.continue();
      // First connection only: a normal open, a few ticks, then EOF — exactly
      // what a server restart looks like from the browser's side. Retries fall
      // through to the real endpoint so the stream can genuinely recover.
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: ssePayload('AAPL', 190.5) + ssePayload('GOOGL', 175.5) + ssePayload('MSFT', 420.5),
      });
    });

    await page.goto('/');

    // EventSource's built-in retry must re-establish the stream unaided.
    await expect
      .poll(() => connections, {
        message: 'EventSource never retried after the stream was closed',
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);

    // The indicator must have shown the break rather than silently claiming Live.
    await expect
      .poll(async () => (await statuses(page)).join(' -> '), {
        message: 'indicator never reported a non-connected state after the stream closed',
        timeout: 30_000,
      })
      .toMatch(/reconnecting|disconnected/);

    // And it must settle back on connected rather than sticking on the error state.
    await expect(dot(page)).toHaveAttribute('data-status', 'connected', { timeout: 30_000 });

    expect(await statuses(page)).toContain('connected');

    // Live ticks resume on the recovered connection.
    await waitForStreamingPrices(page);
    const before = await watchlistPrices(page);
    await expect
      .poll(
        async () => {
          const now = await watchlistPrices(page);
          return now.filter((price, index) => price !== before[index]).length;
        },
        { message: 'prices never resumed after the stream reconnected', timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  });

  test('recovers when the stream endpoint is refused, then heals', async ({ page }) => {
    await recordStatusTransitions(page);

    // Only the SSE endpoint fails; REST stays up. This is the failed-initial-
    // connect path, which native EventSource does not retry on its own.
    let failing = true;
    await page.route('**/api/stream/prices', async (route) => {
      if (failing) return route.abort('connectionrefused');
      return route.continue();
    });

    await page.goto('/');

    await expect
      .poll(async () => dot(page).getAttribute('data-status'), {
        message: 'a refused SSE connection never showed as non-connected',
        timeout: 30_000,
      })
      .not.toBe('connected');

    // The rest of the terminal must stay usable while the stream is down.
    await expect(page.locator('header').getByText('Cash', { exact: true })).toBeVisible();

    failing = false;

    await expect(dot(page)).toHaveAttribute('data-status', 'connected', { timeout: 45_000 });
    await waitForStreamingPrices(page);

    expect(await statuses(page)).toContain('connected');
  });
});
