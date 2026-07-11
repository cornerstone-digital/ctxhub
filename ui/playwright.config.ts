import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT } from './e2e/global-setup.js';

// Requires the root project's dist/ to be built (npm run build at the repo root) -- global-setup
// imports the same compiled registry/indexer/service functions the real `ctxhub` CLI uses,
// rather than reinventing setup logic or shelling out to the CLI as a subprocess.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 860 } },
    },
  ],
});
