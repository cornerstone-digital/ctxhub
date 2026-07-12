import { test, expect } from '@playwright/test';

test('Config: granting and revoking a workspace member role persists against the real config', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Config', exact: true }).click();

  await page.getByPlaceholder('Entra sub (or user identifier)').fill('user-e2e-test');
  // Two "Grant"/"Add" buttons exist elsewhere on this page -- scope to the row with the sub input.
  await page.getByPlaceholder('Entra sub (or user identifier)').locator('xpath=following::button[text()="Grant"][1]').click();

  await expect(page.getByText('user-e2e-test', { exact: true })).toBeVisible({ timeout: 5_000 });

  // Reload and confirm it's actually persisted server-side, not just local component state.
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await expect(page.getByText('user-e2e-test', { exact: true })).toBeVisible({ timeout: 5_000 });

  // Revoke it and confirm it's gone, including after reload.
  await page
    .getByText('user-e2e-test', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
    .getByRole('button')
    .click();
  await expect(page.getByText('user-e2e-test', { exact: true })).not.toBeVisible({ timeout: 5_000 });

  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await expect(page.getByText('user-e2e-test', { exact: true })).not.toBeVisible({ timeout: 5_000 });
});

test('GET /roles is reflected in the role dropdown', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Config', exact: true }).click();

  await page.getByPlaceholder('Entra sub (or user identifier)').waitFor();
  const roleSelect = page.getByPlaceholder('Entra sub (or user identifier)').locator('xpath=following::select[1]');
  const options = await roleSelect.locator('option').allTextContents();
  for (const builtIn of ['owner', 'admin', 'member', 'reader', 'machine']) {
    expect(options).toContain(builtIn);
  }
});
