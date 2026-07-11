import { test, expect } from '@playwright/test';
import { E2E_WORKSPACE_NAME } from './global-setup.js';

test('Fleet loads, shows the fixture workspace, and opens its real doctor health detail on click', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  const node = page.getByRole('button', { name: new RegExp(`^${E2E_WORKSPACE_NAME}`) });
  await expect(node).toBeVisible({ timeout: 10_000 });
  await node.click();

  const panel = page.locator('h2, span', { hasText: E2E_WORKSPACE_NAME }).first();
  await expect(panel).toBeVisible();

  // Real doctor checks, not placeholder text -- Node/Git/config-schema lines always appear for a
  // healthy workspace regardless of what else is indexed.
  await expect(page.getByText('Node v', { exact: false })).toBeVisible();
  await expect(page.getByText('Config schema up to date', { exact: false })).toBeVisible();
});

test('Fleet node detail has an "Ask this workspace" affordance that opens Chat scoped to it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: new RegExp(`^${E2E_WORKSPACE_NAME}`) }).click();

  const askButton = page.getByRole('button', { name: 'Ask this workspace' });
  await expect(askButton).toBeVisible();
  await askButton.click();

  await expect(page.getByPlaceholder(new RegExp(`Ask ${E2E_WORKSPACE_NAME}`))).toBeVisible();
});
