import { expect, test } from '@playwright/test';
import {
  DEFAULT_WATCHLIST,
  resetApp,
  toast,
  waitForPrice,
  waitForStreamingPrices,
  watchlist,
  watchlistSymbols,
} from './helpers';

test.describe('Watchlist', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetApp(request);
    await page.goto('/');
    await waitForStreamingPrices(page);
  });

  test('adds a ticker, which persists and starts streaming', async ({ page }) => {
    await watchlist(page).getByLabel('Add ticker').fill('PYPL');
    await watchlist(page).getByRole('button', { name: 'Add', exact: true }).click();

    await expect(toast(page)).toHaveText('PYPL added to watchlist');
    await expect(watchlist(page).locator('tbody tr')).toHaveCount(DEFAULT_WATCHLIST.length + 1);
    expect(await watchlistSymbols(page)).toContain('PYPL');

    // PLAN.md §6: an unseeded ticker gets synthesized defaults and must tick.
    await waitForPrice(page, 'PYPL');

    await page.reload();
    await expect(watchlist(page).locator('tbody tr')).toHaveCount(DEFAULT_WATCHLIST.length + 1);
    expect(await watchlistSymbols(page)).toContain('PYPL');
  });

  test('rejects an invalid ticker without changing the list', async ({ page }) => {
    // 6 characters — over the ^[A-Z0-9]{1,5}$ limit. The input caps length at 5,
    // so drive the API directly and confirm the UI never gained a row.
    const response = await page.request.post('/api/watchlist', { data: { ticker: 'TOOLONG' } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toHaveProperty('detail');

    await page.reload();
    await expect(watchlist(page).locator('tbody tr')).toHaveCount(DEFAULT_WATCHLIST.length);
  });

  test('removes a ticker, which stays removed after reload', async ({ page }) => {
    await watchlist(page).getByRole('button', { name: 'Remove TSLA' }).click();

    await expect(toast(page)).toHaveText('TSLA removed from watchlist');
    await expect(watchlist(page).locator('tbody tr')).toHaveCount(DEFAULT_WATCHLIST.length - 1);
    expect(await watchlistSymbols(page)).not.toContain('TSLA');

    await page.reload();
    await expect(watchlist(page).locator('tbody tr')).toHaveCount(DEFAULT_WATCHLIST.length - 1);
    expect(await watchlistSymbols(page)).not.toContain('TSLA');
  });

  test('selecting a ticker loads it into the chart and the order ticket', async ({ page }) => {
    await watchlist(page).locator('tbody tr').filter({ hasText: 'NVDA' }).first().click();

    await expect(watchlist(page).locator('tbody tr[aria-selected="true"]')).toHaveText(/NVDA/);
    await expect(page.getByLabel('Trade ticker')).toHaveValue('NVDA');
  });
});
