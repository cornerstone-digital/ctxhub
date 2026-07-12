import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

// Default pacing gives each part of the product story room to land. CI can set
// PROMO_PACE=0.02 to smoke-test the complete journey in seconds.
const pace = Math.max(0.01, Number(process.env.PROMO_PACE ?? '0.82'));
const hold = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000 * pace));

async function openView(page: Page, name: string, heading: string | RegExp) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByText(heading, { exact: typeof heading === 'string' }).first()).toBeVisible({ timeout: 10_000 });
}

test('record the seeded Mission Control product story', async ({ browser }) => {
  const rawVideoDir = path.resolve(process.cwd(), 'test-results/promo/raw-video');
  await mkdir(rawVideoDir, { recursive: true });
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
    recordVideo: { dir: rawVideoDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  const video = page.video();
  // Mission Control keeps an SSE activity stream open, so networkidle is intentionally never
  // reached. The product title is the readiness signal for this recorded route.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mission Control', { exact: true })).toBeVisible();

  // Establish the product, navigate its live Fleet graph, and select the healthy workspace.
  await hold(4);
  // Selecting from the Fleet sidebar focuses the same graph node without relying on the
  // force-layout's animation-dependent coordinates.
  await page.getByRole('button', { name: /ctxhub-demo/ }).click();
  await expect(page.getByRole('button', { name: 'Ask this workspace' })).toBeVisible();
  await expect(page.getByText('ctxhub-demo', { exact: true }).first()).toBeVisible();
  await hold(4);

  // Ask a real engineering question and receive a live Codex-synthesised, cited answer.
  await page.getByRole('button', { name: 'Ask this workspace' }).click();
  const chat = page.getByPlaceholder(/Ask ctxhub-demo/);
  await chat.fill('How do we deploy safely, and what happens when the canary fails?');
  const chatResponse = page.waitForResponse(response => response.url().includes('/chat') && response.request().method() === 'POST', { timeout: 200_000 });
  await chat.press('Enter');
  const response = await chatResponse;
  const answer = await response.json() as { llmNotice?: string; answer?: string[]; llmRoute?: string; llmAttempts?: unknown };
  expect(response.ok(), `Chat request failed with HTTP ${response.status()}`).toBe(true);
  if (process.env.PROMO_ALLOW_LLM_FALLBACK !== '1') {
    expect(answer.llmNotice, `Promo Chat exhausted its configured LLM routes: ${answer.llmNotice}\n${JSON.stringify(answer.llmAttempts, null, 2)}`).toBeUndefined();
    expect(answer.answer?.join(' ').trim().length).toBeGreaterThan(40);
    expect(answer.llmRoute).toBeTruthy();
  }
  await expect(page.getByText(/canary|rollout/i).last()).toBeVisible({ timeout: 15_000 });
  await hold(14);
  const citation = page.locator('button[title^="Open "]').first();
  await expect(citation).toBeVisible();
  await citation.click();

  // The citation opens the living graph; navigate and inspect its evidence node.
  await expect(page.getByText(/\d+ nodes/)).toBeVisible({ timeout: 15_000 });
  await hold(6);
  const filter = page.getByPlaceholder('Filter by file or component name…');
  await filter.fill('deploy');
  await hold(6);
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.52);
  await hold(6);

  // Show Captain-to-Captain delegation with evidence and human promotion controls.
  await openView(page, 'Captains', 'Captains');
  await expect(page.getByText('security-review', { exact: true })).toBeVisible();
  await page.getByText('security-review', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').locator('button').first().click();
  await expect(page.getByText(/from "architecture-review"/i)).toBeVisible({ timeout: 10_000 });
  await hold(10);
  await page.getByText(/from "architecture-review"/i).click();
  await expect(page.getByRole('listitem').filter({ hasText: /token-revocation exercise/i })).toBeVisible();
  await hold(10);

  // The same agents compose into an observable, durable workflow.
  await openView(page, 'Jobs', 'Jobs');
  await expect(page.getByText('release-readiness', { exact: true })).toBeVisible();
  await page.getByText('release-readiness', { exact: true }).click();
  await expect(page.getByText('architecture', { exact: true })).toBeVisible();
  await hold(14);

  // Enterprise boundaries and knowledge-sharing controls are explicit.
  await openView(page, 'Groups', 'Corporate Groups');
  await expect(page.getByText('Acme Engineering Group', { exact: true })).toBeVisible();
  await hold(10);

  // Show the measurable context-efficiency outcome.
  await openView(page, 'Usage', 'Usage');
  await expect(page.getByText('Tokens Saved', { exact: true })).toBeVisible();
  await hold(14);

  // Replay the engineering timeline before moving into quality and platform operations.
  await openView(page, 'Timeline', 'Timeline');
  await expect(page.getByText(/release-readiness/i).first()).toBeVisible();
  await hold(10);

  // Run a real persona-grounded review over the seeded working-tree change.
  await openView(page, 'Review', 'Review');
  const reviewTopic = page.getByPlaceholder(/What are you reviewing/);
  await reviewTopic.fill('Review the new dependency ownership requirement before merge');
  await page.getByRole('button', { name: 'Run review' }).click();
  await expect(page.getByText('Changed files', { exact: true })).toBeVisible({ timeout: 200_000 });
  await hold(14);

  // Show retrieval quality as a measured, inspectable product surface—not a vibe.
  await openView(page, 'Eval', 'Eval Results');
  await expect(page.getByText('3/4', { exact: true })).toBeVisible();
  await page.getByText('Who owns rollback approval?', { exact: true }).click();
  await expect(page.getByText(/Missing \(1\)/)).toBeVisible();
  await hold(14);

  // Portable skills and personas compile the operating model into each agent harness.
  await openView(page, 'Skills & Personas', 'Skills & Personas');
  await expect(page.getByText('architect', { exact: true })).toBeVisible();
  await expect(page.getByText('Sync codex', { exact: true })).toBeVisible();
  await hold(14);

  // Execution profiles, repositories, access roles, privacy, and model routing are configurable.
  await openView(page, 'Config', 'Config');
  await expect(page.getByText('Execution Profiles', { exact: true })).toBeVisible();
  await expect(page.locator('span').filter({ hasText: /^promo-claude$/ })).toBeVisible();
  await hold(14);

  // The same local system synchronizes promoted evidence and Captain history to Cloud.
  await openView(page, 'Cloud', 'Cloud');
  await expect(page.getByText(/architecture-review · ctxhub-demo/)).toBeVisible();
  await expect(page.getByText(/Production canary rollout policy · ctxhub-demo/)).toBeVisible();
  await hold(14);

  // Discover reusable, topology-aware engineering operating models in the Blueprint Hub.
  await openView(page, 'Blueprints', 'Blueprints');
  await expect(page.getByText('secure-service-launch', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search name, description, tags...').fill('incident');
  await expect(page.getByText('incident-response', { exact: true })).toBeVisible();
  await hold(14);

  // Close on promoted, organisation-wide knowledge with provenance and graph relationships.
  await openView(page, 'Org Knowledge', 'Org Knowledge');
  await expect(page.getByText('PostgreSQL is the platform default', { exact: true })).toBeVisible();
  await page.getByText('PostgreSQL is the platform default', { exact: true }).click();
  await expect(page.getByText(/promoted by: principal-engineer/)).toBeVisible();
  await hold(16);

  // We own this context, so closing it finalises the WebM before saveAs (fixture-managed
  // contexts only close after the test returns, which creates a saveAs lifecycle deadlock).
  await context.close();
  if (video) {
    const outputDir = path.resolve(process.cwd(), '../docs/videos');
    await mkdir(outputDir, { recursive: true });
    const filename = process.env.PROMO_ALLOW_LLM_FALLBACK === '1'
      ? 'mission-control-promo-smoke.webm'
      : 'mission-control-promo.webm';
    await video.saveAs(path.join(outputDir, filename));
  }
});
