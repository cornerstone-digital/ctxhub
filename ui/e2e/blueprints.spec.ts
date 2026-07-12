import { test, expect } from '@playwright/test';

test('Blueprints: not-configured empty state renders with the cloud configure hint', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Blueprints', exact: true }).click();

  await expect(page.getByText('Cloud sync not configured', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('ctxhub cloud configure --endpoint <url> --api-key <key>')).toBeVisible();
});
