import path from 'node:path';
import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { runGit } from '../git/git.js';
import { createContextPack } from '../context/pack.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import type { CtxhubConfig } from '../config/types.js';

const MAX_DIFF_CHARS_PER_REPO = 4000;

export async function prContextCommand(opts: { base?: string; json?: boolean; limit?: string; llm?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const changed = new Map<string, string[]>();
  const diffs = new Map<string, string>();
  const base = opts.base ?? 'origin/main';

  for (const repo of config.repositories) {
    const repoPath = path.resolve(workspaceRoot, repo.path);
    try {
      const files = (await runGit(['diff', '--name-only', `${base}...HEAD`], repoPath)).split('\n').filter(Boolean);
      if (files.length) {
        changed.set(repo.name, files);
        const diff = await runGit(['diff', `${base}...HEAD`], repoPath);
        diffs.set(repo.name, diff.slice(0, MAX_DIFF_CHARS_PER_REPO));
      }
    } catch {
      // Repos without the requested base are simply skipped.
    }
  }

  const query = [...changed.entries()].flatMap(([repo, files]) => [repo, ...files]).join(' ') || 'current branch changes';
  const pack = await createContextPack(query, Number(opts.limit ?? 8));

  const effectiveConfig: CtxhubConfig = opts.llm === undefined ? config : { ...config, llm: { ...config.llm, enabled: opts.llm } };
  const { risks, llmNotice } = await reviewContractRisks(changed, diffs, pack.repos.map(repo => repo.name), effectiveConfig);

  const payload = { base, changed: Object.fromEntries(changed), contextPack: pack, ...(risks.length ? { risks } : {}), ...(llmNotice ? { llmNotice } : {}) };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.bold(`PR context vs ${base}`));
  for (const [repo, files] of changed) {
    console.log(`\n${chalk.green(repo)}`);
    for (const file of files) console.log(`- ${file}`);
  }
  console.log(`\n${chalk.bold('Suggested context')}`);
  for (const item of pack.suggestedReadingOrder) console.log(`${item.repo} ${item.path}${item.title ? ` - ${item.title}` : ''}`);

  if (risks.length) {
    console.log(`\n${chalk.bold.yellow('Possible cross-repo contract risk')}`);
    for (const risk of risks) console.log(`${chalk.yellow('!')} ${chalk.green(risk.repo)}: ${risk.risk}`);
  }
  if (llmNotice) console.log(chalk.dim(`\n${llmNotice}`));
}

export type ContractRisk = { repo: string; risk: string };

// Only ever names repos we actually pass in `knownRepos` (parsed matches outside that set are
// dropped) -- the model can describe a risk, but it cannot invent a consumer ctxhub doesn't know
// about.
export async function reviewContractRisks(
  changed: Map<string, string[]>,
  diffs: Map<string, string>,
  knownRepos: string[],
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<{ risks: ContractRisk[]; llmNotice?: string }> {
  if (!changed.size) return { risks: [] };

  if (!config.llm.enabled) {
    return { risks: [], llmNotice: llmDisabledNotice('cross-repo contract-risk review') };
  }

  const candidateConsumers = knownRepos.filter(repo => !changed.has(repo));
  const prompt = buildContractRiskPrompt(changed, diffs, candidateConsumers);
  const result = await runAgentPromptFn(config, prompt);

  if (!result.ok) {
    return {
      risks: [],
      llmNotice: `Cross-repo contract-risk review was unavailable (${result.reason}); showing changed files only.`
    };
  }

  const knownRepoSet = new Set(candidateConsumers);
  const risks: ContractRisk[] = [];
  for (const match of result.text.matchAll(/REPO:\s*(.+)\nRISK:\s*(.+)/g)) {
    const repo = match[1].trim();
    const risk = match[2].trim();
    if (knownRepoSet.has(repo)) risks.push({ repo, risk });
  }

  return { risks };
}

function buildContractRiskPrompt(changed: Map<string, string[]>, diffs: Map<string, string>, candidateConsumers: string[]): string {
  const changedBlock = [...changed.entries()].map(([repo, files]) => `${repo}: ${files.join(', ')}`).join('\n');
  const diffBlock = [...diffs.entries()].map(([repo, diff]) => `--- ${repo} diff ---\n${diff}`).join('\n\n');

  return [
    'You are reviewing a code change for cross-repo contract breaks in a multi-repo workspace.',
    '',
    `Changed files:\n${changedBlock}`,
    '',
    `Diff (may be truncated):\n${diffBlock || '(no diff content available)'}`,
    '',
    `Other repos in this workspace that might consume these changes:\n${candidateConsumers.join(', ') || '(none)'}`,
    '',
    'For each repo you believe is genuinely at risk of breaking because of this change (removed/renamed exports, ' +
      'changed function signatures, removed endpoints, etc.), output one block exactly in this format:',
    'REPO: <repo-name>',
    'RISK: <one-sentence description of the specific risk>',
    '',
    'Only name repos from the list above -- never a repo not listed. If you see no real risk, output nothing.'
  ].join('\n');
}
