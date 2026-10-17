import { defineConfig, devices } from '@playwright/test'

/**
 * `npm run e2e` (or `npx playwright test`) builds the app first. `npm run e2e:dist` serves the dist
 * that is already there: `npm run verify` has just built and checked it, so it is not built twice.
 * npm names the running script in npm_lifecycle_event, which works the same in every shell.
 */
const build = process.env.npm_lifecycle_event === 'e2e:dist' ? '' : 'npm run build && '

/**
 * @playwright/test is pinned to an exact version, and each version drives one Chromium build: after
 * installing or upgrading it, run `npx playwright install chromium` to fetch the matching browser.
 * Tests run against the production build served by `vite preview`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `${build}npm run preview -- --port 4173 --strictPort`,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
