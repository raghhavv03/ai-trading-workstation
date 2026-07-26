import { expect, test } from '@playwright/test';
import {
  fillPriceFromToast,
  panel,
  resetApp,
  submitTrade,
  waitForPrice,
  waitForStreamingPrices,
} from './helpers';

/** PortfolioHeatmap tints tiles rgba(46,165,111,a) for profit and
 *  rgba(224,72,77,a) for loss, with #243040 for a flat/unknown position. */
function toneOf(fill: string): 'up' | 'down' | 'flat' {
  if (fill.startsWith('rgba(46, 165, 111') || fill.startsWith('rgba(46,165,111')) return 'up';
  if (fill.startsWith('rgba(224, 72, 77') || fill.startsWith('rgba(224,72,77')) return 'down';
  return 'flat';
}

test.describe('Portfolio visualization', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetApp(request);
    await page.goto('/');
    await waitForStreamingPrices(page);

    for (const ticker of ['AAPL', 'GOOGL', 'TSLA']) {
      await waitForPrice(page, ticker);
      await submitTrade(page, ticker, 3, 'Buy');
      await fillPriceFromToast(page, new RegExp(`^BUY 3 ${ticker} @ \\$[\\d,]+\\.\\d{2}$`));
    }
  });

  test('heatmap renders one tile per position, sized by weight', async ({ page }) => {
    const heatmap = panel(page, 'Allocation / P&L');
    await expect(heatmap.getByText('No open positions')).toHaveCount(0);

    const tiles = heatmap.locator('svg g rect');
    await expect(tiles).toHaveCount(3);

    for (const ticker of ['AAPL', 'GOOGL', 'TSLA']) {
      await expect(heatmap.locator('svg').getByText(ticker, { exact: true })).toBeVisible();
    }

    const areas = await tiles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node as unknown as SVGRectElement;
        return Number(rect.getAttribute('width')) * Number(rect.getAttribute('height'));
      }),
    );
    expect(areas.every((area) => area > 0)).toBeTruthy();
  });

  test('heatmap tile colors match the sign of each position P&L', async ({ page }) => {
    const heatmap = panel(page, 'Allocation / P&L');
    await expect(heatmap.locator('svg g rect')).toHaveCount(3);

    // Both readings come from one synchronous DOM pass: prices tick twice a
    // second, so two separate Playwright reads could straddle a sign flip.
    const readTiles = () =>
      page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('section'));
        const find = (title: RegExp) =>
          sections.find((section) => title.test(section.querySelector('h2')?.textContent ?? ''));

        const heatmapSection = find(/Allocation/);
        const positionsSection = find(/^Positions/);
        if (!heatmapSection || !positionsSection) return null;

        const tiles: Record<string, string> = {};
        for (const group of Array.from(heatmapSection.querySelectorAll('svg g'))) {
          const label = group.querySelector('text')?.textContent?.trim();
          const fill = group.querySelector('rect')?.getAttribute('fill');
          if (label && fill) tiles[label] = fill;
        }

        const pnl: Record<string, number> = {};
        for (const row of Array.from(positionsSection.querySelectorAll('tbody tr'))) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 7) continue;
          const ticker = cells[0].textContent?.trim();
          const percent = Number(cells[6].textContent?.replace(/[^0-9.-]/g, ''));
          if (ticker) pnl[ticker] = percent;
        }
        return { tiles, pnl };
      });

    let latest = await readTiles();
    await expect
      .poll(
        async () => {
          latest = await readTiles();
          if (!latest) return 'no heatmap/positions sections found';
          const tickers = Object.keys(latest.pnl);
          if (tickers.length !== 3) return `expected 3 positions, saw ${tickers.length}`;
          const mismatches = tickers.filter((ticker) => {
            const fill = latest!.tiles[ticker];
            if (!fill) return true;
            const percent = latest!.pnl[ticker];
            const expected = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
            return toneOf(fill) !== expected;
          });
          return mismatches.length === 0 ? 'ok' : `mismatched tiles: ${mismatches.join(', ')}`;
        },
        { message: `heatmap tile colors never agreed with the positions table P&L` },
      )
      .toBe('ok');
  });

  test('P&L chart plots the snapshots written by each trade', async ({ page }) => {
    const chart = panel(page, 'Portfolio Value');

    // Each fill writes a portfolio_snapshots row immediately (PLAN.md §7), so
    // three buys are enough to clear the two-point minimum the chart needs.
    await expect(chart.getByText('Snapshots are recorded every 60s')).toHaveCount(0);

    const area = chart.locator('.recharts-area-area');
    await expect(area).toHaveCount(1);
    await expect(area).toHaveAttribute('d', /^M/);

    await expect(chart.locator('.recharts-cartesian-axis-tick')).not.toHaveCount(0);

    const history = await page.request.get('/api/portfolio/history');
    expect(history.ok()).toBeTruthy();
    const snapshots = await history.json();
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(snapshots[0]).toHaveProperty('total_value');
    expect(snapshots[0]).toHaveProperty('recorded_at');
  });

  test('main price chart renders for the selected ticker', async ({ page }) => {
    await page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Watchlist' }) })
      .locator('tbody tr')
      .filter({ hasText: 'GOOGL' })
      .first()
      .click();

    const chart = panel(page, /GOOGL/);
    await expect(chart).toHaveCount(1);
    await expect
      .poll(async () => chart.locator('svg path, svg polyline').count(), {
        message: 'the selected-ticker chart never drew a series',
      })
      .toBeGreaterThan(0);
  });
});
