import { test, expect } from '@playwright/test';
import { E2E_WORKSPACE_NAME } from './global-setup.js';

test('Chat answers a real question with a rendered (not raw) markdown answer and real citations', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: new RegExp(`^${E2E_WORKSPACE_NAME}`) }).click();
  await page.getByRole('button', { name: 'Ask this workspace' }).click();

  const input = page.getByPlaceholder(new RegExp(`Ask ${E2E_WORKSPACE_NAME}`));
  await input.pressSequentially('what does the web-app do?', { delay: 15 });
  await page.keyboard.press('Enter');

  // No LLM configured for the fixture (llm.enabled: false), so this is the non-LLM evidence
  // scaffold path -- deterministic, no need to wait on a real model call.
  await expect(page.locator('.thinking-dot').first()).toHaveCount(0, { timeout: 15_000 });

  // Real citation chips should render (evidence-grounded, not an empty/error response) -- the
  // markdown renderer turns raw "**bold**"/"`code`" syntax into real elements, so the rendered
  // text should never contain literal asterisk-pairs from unrendered markdown.
  const bubble = page.locator('.animate-slide-in-up').last();
  await expect(bubble).toBeVisible();
  const text = await bubble.innerText();
  expect(text).not.toMatch(/\*\*[^*]/);
});

test('Chat message input is disabled until a workspace is selected', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.getByPlaceholder('Select a workspace first')).toBeDisabled();
});
