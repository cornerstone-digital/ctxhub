import { test, expect } from '@playwright/test';

test('Groups: empty state renders with create-group hint', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Groups', exact: true }).click();

  await expect(page.getByText('No corporate groups configured', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('ctxhub group create --name <name>')).toBeVisible();
});

test('Cloud: empty state renders with configure hint and a disabled Sync Now button', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Cloud', exact: true }).click();

  await expect(page.getByText('Cloud sync not configured', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Sync Now' })).toBeDisabled();
});
