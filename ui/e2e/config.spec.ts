import { test, expect } from '@playwright/test';

// Safe to mutate here too -- writes go to the fixture copy's own ctxhub.yaml, not the git-tracked
// examples/reference-workspace.
test('Config: adding an execution profile persists it against the real workspace config', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Config', exact: true }).click();

  await page.getByPlaceholder('Profile name').fill('e2e-profile');
  await page.getByPlaceholder('Model (optional)').fill('test-model');
  // Two "Add" buttons exist on this page (repos section, execution profiles section) -- click the
  // one in the same row as the profile-name input just filled.
  await page.getByPlaceholder('Profile name').locator('xpath=following::button[text()="Add"][1]').click();

  await expect(page.getByText('e2e-profile', { exact: true })).toBeVisible({ timeout: 5_000 });

  // Reload and confirm it's actually persisted server-side, not just local component state.
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await expect(page.getByText('e2e-profile', { exact: true })).toBeVisible({ timeout: 5_000 });
});
