import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const DEFAULT_WATCHLIST = [
  'AAPL',
  'GOOGL',
  'MSFT',
  'AMZN',
  'TSLA',
  'NVDA',
  'META',
  'JPM',
  'V',
  'NFLX',
];

export const STARTING_CASH = 10_000;

/** PLAN.md §8 — the supported way to get back to seeded state between scenarios. */
export async function resetApp(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/system/reset');
  expect(
    response.ok(),
    `POST /api/system/reset failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
}

/** Every panel is a <section> whose <h2> carries the title. */
export function panel(page: Page, title: string | RegExp): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title }) });
}

/** Header stats render as a label <span> followed by a value <span>. */
export function headerStat(page: Page, label: string): Locator {
  return page
    .locator('header')
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::span[1]');
}

export function watchlist(page: Page): Locator {
  return panel(page, 'Watchlist');
}

export function positionsPanel(page: Page): Locator {
  return panel(page, /^Positions/);
}

export function positionRow(page: Page, ticker: string): Locator {
  return positionsPanel(page)
    .locator('tbody tr')
    .filter({ has: page.locator('td').first().getByText(ticker, { exact: true }) });
}

export function toast(page: Page): Locator {
  return page.getByRole('status');
}

/** Parses "$10,000.00", "+$12.34", "-$5.00" and bare "190.23" alike. */
export function parseMoney(text: string): number {
  const trimmed = text.trim();
  const digits = trimmed.replace(/[^0-9.]/g, '');
  const value = Number(digits);
  if (!Number.isFinite(value)) throw new Error(`Not a money value: ${JSON.stringify(text)}`);
  return trimmed.startsWith('-') ? -value : value;
}

export async function cashBalance(page: Page): Promise<number> {
  return parseMoney(await headerStat(page, 'Cash').innerText());
}

export async function totalValue(page: Page): Promise<number> {
  return parseMoney(await headerStat(page, 'Total Value').innerText());
}

/** The "Last" column of every watchlist row, in display order. */
export async function watchlistPrices(page: Page): Promise<string[]> {
  return watchlist(page).locator('tbody tr td:nth-child(2)').allInnerTexts();
}

export async function watchlistSymbols(page: Page): Promise<string[]> {
  const cells = await watchlist(page).locator('tbody tr td:nth-child(1)').allInnerTexts();
  return cells.map((cell) => cell.trim());
}

/** Waits until the SSE stream is up and at least one real price has landed. */
export async function waitForStreamingPrices(page: Page): Promise<void> {
  await expect(page.getByTestId('connection-dot')).toHaveAttribute('data-status', 'connected');
  await expect
    .poll(async () => (await watchlistPrices(page)).filter((price) => price.trim() !== '—').length, {
      message: 'no watchlist row ever received a price from /api/stream/prices',
    })
    .toBeGreaterThan(0);
}

/** Waits until a specific ticker has a price, which is a precondition for
 *  trading it — POST /api/portfolio/trade 400s without one. */
export async function waitForPrice(page: Page, ticker: string): Promise<number> {
  const cell = watchlist(page)
    .locator('tbody tr')
    .filter({ hasText: ticker })
    .locator('td:nth-child(2)');
  await expect
    .poll(async () => (await cell.first().innerText()).trim(), {
      message: `no price ever streamed for ${ticker}`,
    })
    .not.toBe('—');
  return parseMoney(await cell.first().innerText());
}

export async function submitTrade(
  page: Page,
  ticker: string,
  quantity: number,
  side: 'Buy' | 'Sell',
): Promise<void> {
  await page.getByLabel('Trade ticker').fill(ticker);
  await page.getByLabel('Trade quantity').fill(String(quantity));
  await page.getByRole('button', { name: side, exact: true }).click();
}

/** Reads the fill price back out of the confirmation toast, e.g.
 *  "BUY 2 AAPL @ $190.23" -> 190.23. */
export async function fillPriceFromToast(page: Page, pattern: RegExp): Promise<number> {
  await expect(toast(page)).toHaveText(pattern);
  const text = await toast(page).innerText();
  const match = text.match(/@\s*\$([\d,]+\.\d{2})/);
  if (!match) throw new Error(`No fill price in toast: ${text}`);
  return parseMoney(match[1]);
}

export async function sendChat(page: Page, message: string): Promise<void> {
  await page.getByLabel('Message FinAlly').fill(message);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
