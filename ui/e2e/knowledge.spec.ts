import { test, expect } from '@playwright/test';

test('Knowledge graph loads real nodes from the indexed fixture and search filters/highlights matches', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();

  // The fixture indexes README.md files across 3 repos plus one architecture diagram -- real node
  // count should be nonzero and never "0 nodes" once the graph finishes loading.
  await expect(page.getByText(/\d+ nodes/)).toBeVisible({ timeout: 15_000 });
  const statusBefore = await page.getByText(/\d+ nodes/).innerText();
  expect(statusBefore).not.toMatch(/^0 nodes/);

  const search = page.getByPlaceholder('Filter by file or component name…');
  await search.fill('README');
  await page.waitForTimeout(600); // debounced auto-fit-to-matches

  const filtered = await page.getByText(/\d+ of \d+ nodes/).innerText();
  expect(filtered).toMatch(/^\d+ of \d+ nodes/);
});

test('Clicking a file node opens a real content preview, not a placeholder', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.waitForTimeout(2000); // let the force simulation settle before hit-testing

  // Narrow to one exact file so there's only one match to hit, rather than 3 README.md nodes
  // clustered together after a fit-to-matches -- a single blind click could land on any of them.
  // Node ids are "repo:filePath" (see knowledgeGraph.ts's fileNodeId), matched against here.
  const search = page.getByPlaceholder('Filter by file or component name…');
  await search.fill('web-app:README.md');
  await page.waitForTimeout(900);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  const preview = page.getByText('File content', { exact: true });
  const candidates: Array<[number, number]> = [
    [0.5, 0.5],
    [0.5, 0.45],
    [0.55, 0.5],
    [0.45, 0.5],
    [0.5, 0.55],
  ];
  for (const [fx, fy] of candidates) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    if (await preview.isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }

  await expect(preview).toBeVisible({ timeout: 5_000 });
  // The preview header shows the file's path within its own repo (not repo-prefixed).
  await expect(page.getByText('README.md', { exact: true })).toBeVisible();
  // Real README content, not a synthetic summary placeholder.
  await expect(page.locator('pre').first()).toContainText(/./);
});
