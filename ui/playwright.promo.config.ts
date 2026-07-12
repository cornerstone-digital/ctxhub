import { defineConfig, devices } from '@playwright/test';
import { PROMO_PORT } from './e2e/promo-global-setup.js';

export default defineConfig({
  testDir: './promo',
  outputDir: './test-results/promo',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/promo-global-setup.ts',
  timeout: 240_000,
  use: {
    baseURL: `http://127.0.0.1:${PROMO_PORT}`,
    trace: 'off',
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },
  projects: [{
    name: 'promo-chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    },
  }],
});
