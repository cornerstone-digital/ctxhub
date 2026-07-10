import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { chmod } from 'node:fs/promises';
import chalk from 'chalk';
import fg from 'fast-glob';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import type { CtxhubConfig, RepoConfig } from '../config/types.js';
import { getRepoName, isGitRepo } from '../git/git.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import { pathExists, writeText } from '../utils/fs.js';
import { runRepoDiscoverReview } from '../tui/RepoDiscoverApp.js';
import { shouldUseInteractive } from '../utils/interactive.js';

export type DiscoveredRepo = {
  name: string;
  path: string;
  state: 'new' | 'configured';
};

export type RepoGlobSuggestion = {
  include: string[];
  exclude: string[];
  rationale: string[];
};

export async function repoAddCommand(name: string, repoPath: string, opts: { suggestGlobs?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  if (config.repositories.some(r => r.name === name)) {
    throw new Error(`Repository already exists: ${name}`);
  }

  const absolutePath = path.resolve(process.cwd(), repoPath);
  if (!(await pathExists(absolutePath))) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  const git = await isGitRepo(absolutePath);
  const configPath = path.relative(workspaceRoot, absolutePath) || '.';
  const repo: RepoConfig = { name, path: configPath, git };
  config.repositories.push(repo);
  await saveConfig(config);
  console.log(chalk.green(`Added repo ${name} -> ${configPath}`));
  console.log(git ? chalk.gray('Git repository detected') : chalk.yellow('Path added, but it is not a Git repository'));

  if (opts.suggestGlobs) {
    await printRepoGlobSuggestion(repo, absolutePath, config);
  }
}

export async function repoListCommand() {
  const { config } = await loadWorkspaceConfig();
  if (!config.repositories.length) {
    console.log(chalk.yellow('No repositories configured.'));
    return;
  }

  for (const repo of config.repositories) {
    const gitLabel = repo.git === false ? chalk.yellow('non-git') : chalk.gray('git');
    console.log(`${chalk.green('✓')} ${repo.name} ${chalk.gray(repo.path)} ${gitLabel}`);
  }
}

export async function repoDiscoverCommand(root = '.', opts: { interactive?: boolean; plain?: boolean; suggestGlobs?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const discoveryRoot = path.resolve(process.cwd(), root);
  const discovered = await discoverRepositoriesFromRoot(discoveryRoot, config, workspaceRoot);
  const newRepos = discovered.filter(repo => repo.state === 'new');
  const skipped = discovered.length - newRepos.length;

  if (!discovered.length) {
    console.log(chalk.yellow(`No Git repositories found under ${root}.`));
    return;
  }

  const selected = shouldUseInteractive(opts) && newRepos.length
    ? await runRepoDiscoverReview(root, discovered)
    : newRepos;

  if (!selected) {
    console.log(chalk.yellow('Repository discovery cancelled.'));
    return;
  }

  for (const repo of selected) {
    config.repositories.push({ name: repo.name, path: repo.path, git: true });
    console.log(chalk.green(`Discovered ${repo.name} -> ${repo.path}`));
  }

  await saveConfig(config);
  if (!selected.length) {
    console.log(chalk.gray(`No new repositories added (${skipped} already configured).`));
    return;
  }

  console.log(chalk.green(`Added ${selected.length} repositor${selected.length === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} already configured` : ''}.`));
  console.log(chalk.gray('Next: run ctxhub index to add their knowledge to the workspace.'));

  if (opts.suggestGlobs) {
    for (const repo of selected) {
      await printRepoGlobSuggestion({ name: repo.name, path: repo.path, git: true }, path.resolve(workspaceRoot, repo.path), config);
    }
  }
}

export async function discoverRepositories(root: string, config: CtxhubConfig): Promise<DiscoveredRepo[]> {
  return discoverRepositoriesFromRoot(root, config, root);
}

async function discoverRepositoriesFromRoot(root: string, config: CtxhubConfig, workspaceRoot: string): Promise<DiscoveredRepo[]> {
  const gitDirs = await fg('**/.git', { cwd: root, onlyDirectories: true, ignore: ['**/node_modules/**', '**/dist/**'] });
  return gitDirs.map(gitDir => {
    const absoluteRepoPath = path.dirname(path.join(root, gitDir));
    const repoPath = path.relative(workspaceRoot, absoluteRepoPath) || '.';
    const name = getRepoName(absoluteRepoPath);
    return {
      name,
      path: repoPath,
      state: config.repositories.some(r => r.path === repoPath || r.name === name) ? 'configured' : 'new'
    };
  });
}

export function postCommitHookScript(workspaceRoot: string, cliEntryPath: string, repoName: string): string {
  return [
    '#!/bin/sh',
    `# Installed by ctxhub (\`ctxhub repo hook ${repoName}\`) — re-indexes this ctxhub workspace after each commit.`,
    `cd "${workspaceRoot}" || exit 0`,
    `node "${cliEntryPath}" index >/dev/null 2>&1 &`,
    'exit 0',
    ''
  ].join('\n');
}

export async function repoHookCommand(name: string, opts: { force?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const repo = config.repositories.find(r => r.name === name);
  if (!repo) {
    throw new Error(`Repository not found: ${name}`);
  }

  const repoAbsolutePath = path.resolve(workspaceRoot, repo.path);
  if (!(await isGitRepo(repoAbsolutePath))) {
    throw new Error(`${name} is not a Git repository: ${repo.path}`);
  }

  const hookPath = path.join(repoAbsolutePath, '.git', 'hooks', 'post-commit');
  if (!opts.force && (await pathExists(hookPath))) {
    throw new Error(`${hookPath} already exists. Use --force to overwrite.`);
  }

  const script = postCommitHookScript(workspaceRoot, process.argv[1], name);
  await writeText(hookPath, script);
  await chmod(hookPath, 0o755);

  console.log(chalk.green(`Installed post-commit hook for ${name}`));
  console.log(chalk.gray(hookPath));
}

export async function suggestRepoGlobs(
  repo: RepoConfig,
  repoAbsolutePath: string,
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<{ suggestion?: RepoGlobSuggestion; llmNotice?: string }> {
  if (!config.llm.enabled) {
    return { llmNotice: llmDisabledNotice('tailored repo globs') };
  }

  const summary = await summarizeRepoForGlobSuggestion(repoAbsolutePath);
  const result = await runAgentPromptFn(config, buildRepoGlobSuggestionPrompt(repo, summary));
  if (!result.ok) {
    return {
      llmNotice: `Tailored glob suggestions were unavailable (${result.reason}); keeping the default workspace globs for ${repo.name}.`
    };
  }

  const suggestion = parseRepoGlobSuggestion(result.text);
  if (!suggestion) {
    return {
      llmNotice: `Tailored glob suggestions returned an invalid response; keeping the default workspace globs for ${repo.name}.`
    };
  }

  return { suggestion };
}

export function renderRepoGlobSuggestionDiff(repo: RepoConfig, suggestion: RepoGlobSuggestion): string {
  const currentLines = renderRepoConfigLines(repo);
  const suggestedLines = renderRepoConfigLines({
    ...repo,
    include: suggestion.include.length ? suggestion.include : undefined,
    exclude: suggestion.exclude.length ? suggestion.exclude : undefined
  });

  const diffLines: string[] = [];
  const max = Math.max(currentLines.length, suggestedLines.length);
  for (let index = 0; index < max; index += 1) {
    const currentLine = currentLines[index];
    const suggestedLine = suggestedLines[index];
    if (currentLine === suggestedLine) {
      if (currentLine !== undefined) diffLines.push(` ${currentLine}`);
      continue;
    }

    if (currentLine !== undefined) diffLines.push(`-${currentLine}`);
    if (suggestedLine !== undefined) diffLines.push(`+${suggestedLine}`);
  }

  return diffLines.join('\n');
}

async function printRepoGlobSuggestion(repo: RepoConfig, repoAbsolutePath: string, config: CtxhubConfig): Promise<void> {
  const { suggestion, llmNotice } = await suggestRepoGlobs(repo, repoAbsolutePath, config);
  if (llmNotice) {
    console.log(chalk.dim(llmNotice));
    return;
  }

  if (!suggestion) return;

  console.log(chalk.bold(`Suggested ctxhub.yaml diff for ${repo.name}`));
  console.log(renderRepoGlobSuggestionDiff(repo, suggestion));
  if (suggestion.rationale.length) {
    console.log(chalk.gray(`Why: ${suggestion.rationale.join(' ')}`));
  }
}

async function summarizeRepoForGlobSuggestion(repoAbsolutePath: string): Promise<{
  topLevelEntries: string[];
  sampleFiles: string[];
  manifestFiles: string[];
}> {
  const topLevelEntries = (await readdir(repoAbsolutePath, { withFileTypes: true }))
    .filter(entry => entry.name !== '.git')
    .map(entry => `${entry.isDirectory() ? 'dir' : 'file'} ${entry.name}`)
    .sort()
    .slice(0, 25);

  const sampleFiles = (await fg(['**/*'], {
    cwd: repoAbsolutePath,
    onlyFiles: true,
    dot: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**']
  }))
    .slice(0, 60);

  const manifestFiles = sampleFiles.filter(file => /(^|\/)(package\.json|tsconfig(\..+)?\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|README(\..+)?|docs\/)/i.test(file)).slice(0, 20);

  return { topLevelEntries, sampleFiles, manifestFiles };
}

function buildRepoGlobSuggestionPrompt(
  repo: RepoConfig,
  summary: { topLevelEntries: string[]; sampleFiles: string[]; manifestFiles: string[] }
): string {
  return [
    `You are tailoring ctxhub per-repo include/exclude globs for repository ${repo.name}.`,
    `Current repo path: ${repo.path}`,
    '',
    'Top-level entries:',
    ...summary.topLevelEntries.map(entry => `- ${entry}`),
    '',
    'Representative files:',
    ...summary.sampleFiles.map(file => `- ${file}`),
    '',
    'Manifest/docs clues:',
    ...(summary.manifestFiles.length ? summary.manifestFiles.map(file => `- ${file}`) : ['- (none)']),
    '',
    'Return strict JSON only with this shape:',
    '{"include":["glob"],"exclude":["glob"],"rationale":["short reason"]}',
    'Guidelines:',
    '- Suggest only repo-relative globs suitable for ctxhub indexing.',
    '- Prefer a small, high-signal include list over broad catch-alls when the repo layout is specialized.',
    '- Exclude generated/build/vendor paths when obvious.',
    '- Do not suggest absolute paths.',
    '- If the workspace defaults are already appropriate, return empty arrays for include and exclude and explain why in rationale.'
  ].join('\n');
}

function parseRepoGlobSuggestion(raw: string): RepoGlobSuggestion | undefined {
  try {
    const normalized = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(normalized) as Partial<RepoGlobSuggestion>;
    const include = Array.isArray(parsed.include) ? parsed.include.filter(isNonEmptyString) : [];
    const exclude = Array.isArray(parsed.exclude) ? parsed.exclude.filter(isNonEmptyString) : [];
    const rationale = Array.isArray(parsed.rationale) ? parsed.rationale.filter(isNonEmptyString) : [];
    return { include, exclude, rationale };
  } catch {
    return undefined;
  }
}

function renderRepoConfigLines(repo: RepoConfig): string[] {
  const lines = ['  - name: ' + repo.name, '    path: ' + repo.path];
  if (repo.git !== undefined) lines.push(`    git: ${String(repo.git)}`);
  if (repo.include?.length) {
    lines.push('    include:');
    for (const pattern of repo.include) lines.push(`      - ${pattern}`);
  }
  if (repo.exclude?.length) {
    lines.push('    exclude:');
    for (const pattern of repo.exclude) lines.push(`      - ${pattern}`);
  }
  return lines;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
