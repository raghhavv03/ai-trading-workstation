import { defineConfig, devices } from '@playwright/test';

/** Points at the app container under docker-compose.test.yml, or a locally
 *  running uvicorn when driving the suite by hand. */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8000';

export default defineConfig({
  testDir: './e2e',

  // One app process and one SQLite file back every spec, and `/api/system/reset`
  // wipes global state, so parallel workers would race on cash and positions.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,

  // Prices arrive on a 500ms server tick batched into a 250ms client flush;
  // assertions that wait on a *change* need materially longer than one tick.
  expect: { timeout: 20_000 },

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Desktop-first, data-dense layout — a narrow viewport collapses heatmap
    // tiles below their label thresholds and hides header stats.
    viewport: { width: 1680, height: 1050 },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
