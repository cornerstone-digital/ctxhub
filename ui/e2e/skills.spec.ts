import { test, expect } from '@playwright/test';

// Safe: writes land in the fixture copy's own .claude/skills, .ctxhub/agents, etc. -- never the
// git-tracked examples/reference-workspace.
test('Skills & Personas: installing a skill and scaffolding a persona both really happen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Skills & Personas' }).click();

  const installButton = page.getByRole('button', { name: /^(Install|Reinstall)$/ }).first();
  await installButton.click();
  await expect(page.getByRole('button', { name: 'Reinstall' }).first()).toBeVisible({ timeout: 10_000 });

  const scaffoldButton = page.getByRole('button', { name: 'Scaffold agents/ with a starter persona' });
  if (await scaffoldButton.isVisible().catch(() => false)) {
    await scaffoldButton.click();
    await page.waitForTimeout(1500);
  }

  // Real personas.md-driven state -- a compiled persona file should show up once scaffolded.
  await expect(page.getByText('architect', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});
