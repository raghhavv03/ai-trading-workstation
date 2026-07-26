import { expect, test } from '@playwright/test';
import {
  DEFAULT_WATCHLIST,
  headerStat,
  positionsPanel,
  resetApp,
  waitForStreamingPrices,
  watchlist,
  watchlistPrices,
  watchlistSymbols,
} from './helpers';

test.describe('Fresh start', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetApp(request);
    await page.goto('/');
  });

  test('shows the ten seeded watchlist tickers', async ({ page }) => {
    await expect(watchlist(page).locator('tbody tr')).toHaveCount(DEFAULT_WATCHLIST.length);
    // Compared as a set: every seeded row is written with an identical
    // `added_at`, so the `ORDER BY added_at` in GET /api/watchlist is a tie and
    // SQLite may return the rows in any order.
    expect([...(await watchlistSymbols(page))].sort()).toEqual([...DEFAULT_WATCHLIST].sort());
  });

  test('shows the $10,000 seeded balance and no positions', async ({ page }) => {
    await expect(headerStat(page, 'Cash')).toHaveText('$10,000.00');
    await expect(headerStat(page, 'Total Value')).toHaveText('$10,000.00');
    await expect(headerStat(page, 'Unrealized P&L')).toHaveText('+$0.00');
    await expect(positionsPanel(page).getByText('No open positions.')).toBeVisible();
  });

  test('reports a connected price stream', async ({ page }) => {
    await expect(page.getByTestId('connection-dot')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('header').getByText('Live', { exact: true })).toBeVisible();
  });

  test('streams prices that actually move over time', async ({ page }) => {
    await waitForStreamingPrices(page);

    // Every row must eventually carry a price, not just the first one to arrive.
    await expect
      .poll(async () => (await watchlistPrices(page)).filter((p) => p.trim() !== '—').length, {
        message: 'not every watchlist ticker started streaming',
      })
      .toBe(DEFAULT_WATCHLIST.length);

    const before = await watchlistPrices(page);
    await expect
      .poll(
        async () => {
          const now = await watchlistPrices(page);
          return now.filter((price, index) => price !== before[index]).length;
        },
        { message: 'no watchlist price changed — the stream is static, not live' },
      )
      .toBeGreaterThan(0);
  });

  test('accumulates sparkline history from the stream', async ({ page }) => {
    await waitForStreamingPrices(page);
    // Sparklines are drawn client-side from ticks accumulated since page load;
    // each row swaps `sparkline-empty` for `sparkline` once it has 2+ points.
    await expect
      .poll(async () => watchlist(page).getByTestId('sparkline').count(), {
        message: 'no sparkline ever accumulated enough ticks to draw a path',
      })
      .toBe(DEFAULT_WATCHLIST.length);
  });
});
