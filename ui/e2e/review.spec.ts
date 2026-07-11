import { test, expect } from '@playwright/test';

test('Review: running the built-in docs persona completes against real architecture data', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Review', exact: true }).click();

  const personaSelect = page.locator('select').filter({ has: page.locator('option[value="docs"]') });
  await expect(personaSelect.locator('option')).not.toHaveCount(0, { timeout: 10_000 });
  await personaSelect.selectOption('docs');

  await page.getByPlaceholder(/What are you reviewing/).fill('architecture drift in the reference workspace');
  await page.getByRole('button', { name: 'Run review' }).click();

  await expect(page.getByText('Changed files', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Findings', { exact: true })).toBeVisible();
});
