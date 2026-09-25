import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: boots the real server (in-memory PGlite, fresh per run) and the Vite dev
 * client, then drives Chromium with fake camera/microphone devices so calls work headless.
 *
 * Ports are configurable so several runs can coexist:
 *   E2E_API_PORT (default 4400), E2E_WEB_PORT (default 5400).
 * Set E2E_REUSE=1 to reuse servers you started yourself on those ports.
 */
const apiPort = Number(process.env.E2E_API_PORT ?? 4400);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5400);
const reuse = process.env.E2E_REUSE === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    permissions: ['camera', 'microphone', 'notifications'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -w @enbox/server',
      url: `http://localhost:${apiPort}/api/health`,
      reuseExistingServer: reuse,
      timeout: 120_000,
      env: {
        PORT: String(apiPort),
        PGLITE_DIR: 'memory',
        DATA_DIR: `./data-e2e-${apiPort}`,
        RATE_LIMIT: 'off',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'development',
        PUBLIC_URL: `http://localhost:${webPort}`,
      },
    },
    {
      command: 'npm run dev -w @enbox/web',
      url: `http://localhost:${webPort}`,
      reuseExistingServer: reuse,
      timeout: 120_000,
      env: { WEB_PORT: String(webPort), ENBOX_API_URL: `http://localhost:${apiPort}` },
    },
  ],
});
