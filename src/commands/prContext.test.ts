import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewContractRisks } from './prContext.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';
import type { RunAgentResult } from '../llm/runAgent.js';

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

test('reviewContractRisks returns no risks and never calls the LLM when nothing changed', async () => {
  let called = false;
  const result = await reviewContractRisks(new Map(), new Map(), ['api', 'web'], config({ enabled: true }), async () => {
    called = true;
    return { ok: true, text: 'REPO: web\nRISK: should not be used' };
  });
  assert.deepEqual(result.risks, []);
  assert.equal(called, false);
});

test('reviewContractRisks reports the disabled notice and empty risks when llm.enabled is false', async () => {
  const changed = new Map([['api', ['src/index.ts']]]);
  const result = await reviewContractRisks(changed, new Map(), ['web'], config({ enabled: false }));
  assert.deepEqual(result.risks, []);
  assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
});

test('reviewContractRisks parses REPO/RISK blocks and only keeps known candidate repos', async () => {
  const changed = new Map([['api', ['src/routes.ts']]]);
  const diffs = new Map([['api', '-export function oldName()\n+export function newName()']]);
  const fake = async (): Promise<RunAgentResult> => ({
    ok: true,
    text: [
      'REPO: web',
      'RISK: web imports oldName from api and will break.',
      '',
      'REPO: totally-invented-repo',
      'RISK: this repo was never mentioned and must be dropped.'
    ].join('\n')
  });

  const result = await reviewContractRisks(changed, diffs, ['web', 'mobile'], config({ enabled: true }), fake);

  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].repo, 'web');
  assert.match(result.risks[0].risk, /oldName/);
  assert.ok(!result.risks.some(risk => risk.repo === 'totally-invented-repo'), 'must never surface an unlisted repo');
});

test('reviewContractRisks excludes the changed repo itself from the candidate consumer list', async () => {
  const changed = new Map([['api', ['src/routes.ts']]]);
  let seenPrompt = '';
  const fake = async (_config: CtxhubConfig, prompt: string): Promise<RunAgentResult> => {
    seenPrompt = prompt;
    return { ok: true, text: '' };
  };

  await reviewContractRisks(changed, new Map(), ['api', 'web'], config({ enabled: true }), fake);
  assert.ok(!seenPrompt.includes('might consume these changes:\napi') , 'the changed repo itself should not be listed as a candidate consumer');
  assert.match(seenPrompt, /web/);
});

test('reviewContractRisks falls back to empty risks with a clear notice when the LLM call fails', async () => {
  const changed = new Map([['api', ['src/routes.ts']]]);
  const result = await reviewContractRisks(changed, new Map(), ['web'], config({ enabled: true }), async () => ({
    ok: false,
    reason: 'timeout'
  }));
  assert.deepEqual(result.risks, []);
  assert.match(result.llmNotice ?? '', /unavailable \(timeout\)/);
});
