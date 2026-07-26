import { expect, test } from '@playwright/test';
import {
  STARTING_CASH,
  cashBalance,
  fillPriceFromToast,
  positionRow,
  positionsPanel,
  resetApp,
  submitTrade,
  toast,
  totalValue,
  waitForPrice,
  waitForStreamingPrices,
} from './helpers';

/** Cash is debited at the unrounded cache price while the toast reports it
 *  rounded to 2dp, so expected cash can differ by half a cent per share. */
const CENT_TOLERANCE = 0.05;

test.describe('Trading', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetApp(request);
    await page.goto('/');
    await waitForStreamingPrices(page);
  });

  test('buying debits cash, opens a position, and updates the portfolio', async ({ page }) => {
    await waitForPrice(page, 'AAPL');
    expect(await cashBalance(page)).toBe(STARTING_CASH);

    await submitTrade(page, 'AAPL', 2, 'Buy');

    const fill = await fillPriceFromToast(page, /^BUY 2 AAPL @ \$[\d,]+\.\d{2}$/);

    const row = positionRow(page, 'AAPL');
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(1)).toHaveText('2');
    await expect(row.locator('td').nth(2)).toHaveText(fill.toFixed(2));
    await expect(positionsPanel(page).getByRole('heading')).toHaveText('Positions (1)');

    await expect
      .poll(async () => cashBalance(page), { message: 'cash was not debited by the trade' })
      .toBeLessThan(STARTING_CASH);
    expect(await cashBalance(page)).toBeCloseTo(STARTING_CASH - 2 * fill, 1);

    // Total value = cash + live market value, so it stays near the starting
    // $10k the instant after a fill (only the price drift since then differs).
    expect(await totalValue(page)).toBeGreaterThan(STARTING_CASH - 2 * fill);
  });

  test('selling part of a position credits cash and reduces quantity', async ({ page }) => {
    await waitForPrice(page, 'MSFT');
    await submitTrade(page, 'MSFT', 4, 'Buy');
    await fillPriceFromToast(page, /^BUY 4 MSFT @ \$[\d,]+\.\d{2}$/);

    const cashAfterBuy = await cashBalance(page);

    await submitTrade(page, 'MSFT', 1, 'Sell');
    const sellFill = await fillPriceFromToast(page, /^SELL 1 MSFT @ \$[\d,]+\.\d{2}$/);

    const row = positionRow(page, 'MSFT');
    await expect(row.locator('td').nth(1)).toHaveText('3');

    await expect
      .poll(async () => cashBalance(page), { message: 'sale proceeds were not credited' })
      .toBeGreaterThan(cashAfterBuy);
    expect(await cashBalance(page)).toBeCloseTo(cashAfterBuy + sellFill, 1);
  });

  test('selling the whole position removes it from the table', async ({ page }) => {
    await waitForPrice(page, 'JPM');
    await submitTrade(page, 'JPM', 3, 'Buy');
    await fillPriceFromToast(page, /^BUY 3 JPM @ \$[\d,]+\.\d{2}$/);
    await expect(positionRow(page, 'JPM')).toHaveCount(1);

    await submitTrade(page, 'JPM', 3, 'Sell');
    await fillPriceFromToast(page, /^SELL 3 JPM @ \$[\d,]+\.\d{2}$/);

    await expect(positionRow(page, 'JPM')).toHaveCount(0);
    await expect(positionsPanel(page).getByText('No open positions.')).toBeVisible();

    // Round-tripping at a drifting price cannot conjure or destroy much value.
    expect(await cashBalance(page)).toBeGreaterThan(STARTING_CASH * 0.9);
    expect(await cashBalance(page)).toBeLessThan(STARTING_CASH * 1.1);
  });

  test('supports fractional share quantities', async ({ page }) => {
    await waitForPrice(page, 'AMZN');
    await submitTrade(page, 'AMZN', 0.5, 'Buy');

    await fillPriceFromToast(page, /^BUY 0\.5 AMZN @ \$[\d,]+\.\d{2}$/);
    await expect(positionRow(page, 'AMZN').locator('td').nth(1)).toHaveText('0.5');
  });

  test('rejects a buy that exceeds available cash', async ({ page }) => {
    await waitForPrice(page, 'NVDA');
    await submitTrade(page, 'NVDA', 100000, 'Buy');

    await expect(toast(page)).toHaveText('Insufficient cash for this trade');
    await expect(positionRow(page, 'NVDA')).toHaveCount(0);
    expect(await cashBalance(page)).toBe(STARTING_CASH);
  });

  test('rejects selling more shares than are held', async ({ page }) => {
    await waitForPrice(page, 'META');
    await submitTrade(page, 'META', 1, 'Buy');
    await fillPriceFromToast(page, /^BUY 1 META @ \$[\d,]+\.\d{2}$/);

    await submitTrade(page, 'META', 5, 'Sell');

    await expect(toast(page)).toHaveText('Cannot sell more shares than you own');
    await expect(positionRow(page, 'META').locator('td').nth(1)).toHaveText('1');
  });

  test('a position keeps streaming after its ticker leaves the watchlist', async ({ page }) => {
    await waitForPrice(page, 'NFLX');
    await submitTrade(page, 'NFLX', 2, 'Buy');
    await fillPriceFromToast(page, /^BUY 2 NFLX @ \$[\d,]+\.\d{2}$/);

    // PLAN.md §6: the stream covers watchlist ∪ open positions.
    await page.getByRole('button', { name: 'Remove NFLX' }).click();
    await expect(toast(page)).toHaveText('NFLX removed from watchlist');

    const lastCell = positionRow(page, 'NFLX').locator('td').nth(3);
    const before = await lastCell.innerText();
    await expect
      .poll(async () => lastCell.innerText(), {
        message: 'position price froze once the ticker left the watchlist',
      })
      .not.toBe(before);
  });
});
