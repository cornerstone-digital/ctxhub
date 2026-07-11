import { test, expect } from '@playwright/test';
import { E2E_WORKSPACE_NAME } from './global-setup.js';

// Safe to mutate real state here: the fixture workspace is a throwaway copy (see global-setup.ts),
// so creating a task, running it, and promoting a run into a real note file never touches the
// actual git-tracked examples/reference-workspace or the real user's ~/.ctxhub/.
test('Captains: create a task, run it, and promote the run into a real git-tracked note', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Captains', exact: true }).click();

  await page.getByRole('button', { name: '+ New task' }).click();
  await page.getByPlaceholder('Task name').fill('e2e-task');
  await page.locator('select').first().selectOption(E2E_WORKSPACE_NAME);
  await page
    .getByPlaceholder('Query to run against the workspace, evidence-grounded via explain')
    .fill('what does the web-app repo do');
  await page.getByRole('button', { name: 'Create task' }).click();

  await expect(page.getByText('e2e-task', { exact: true })).toBeVisible({ timeout: 5_000 });

  // Expand the new task card and run it.
  const taskRow = page.locator('div').filter({ hasText: /^e2e-task/ }).first();
  await taskRow.getByRole('button', { name: 'Run now' }).click();
  await expect(page.locator('svg.animate-spin')).toHaveCount(0, { timeout: 15_000 });

  // Expand run history.
  await page.getByText('e2e-task', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').locator('button').first().click();
  const promoteToggle = page.getByText('Promote…').first();
  await expect(promoteToggle).toBeVisible({ timeout: 5_000 });
  await promoteToggle.click();

  // Several <select> elements exist on this page (workspace pickers, the Chat panel's own
  // selector) -- target the one that actually offers "web-app" as an option, not DOM position.
  const repoSelect = page.locator('select').filter({ has: page.locator('option[value="web-app"]') });
  await repoSelect.selectOption('web-app');
  await page.getByRole('button', { name: 'Promote', exact: true }).click();

  // A real note path string appears once the promotion round-trips through the real backend.
  await expect(page.getByText(/agent-notes.*\.md/)).toBeVisible({ timeout: 5_000 });
});
