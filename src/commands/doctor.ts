import chalk from 'chalk';
import path from 'node:path';
import { loadConfig, saveConfig, findConfigPath, INDEX_DIR, CACHE_DIR, MEMORY_DIR } from '../config/config.js';
import { defaultConfig } from '../config/defaultConfig.js';
import { ensureDir, pathExists } from '../utils/fs.js';
import { detectDrift } from '../utils/drift.js';
import { skillsInstallCommand } from './skills.js';
import { CONFIG_WRITERS, SUPPORTED_AGENTS, type SupportedAgent } from './agent.js';
import { buildDoctorChecks, printCheckLine, runDoctorChecks } from './doctorChecks.js';
import { runDoctorChecklist } from '../tui/progress/DoctorChecklistApp.js';

export type DoctorFixOptions = {
  fix?: boolean;
  dryRun?: boolean;
  fixSkills?: boolean;
  fixAgent?: string;
};

type FixAction = { description: string; apply: () => Promise<void> };

export async function doctorCommand(opts: DoctorFixOptions = {}) {
  const configPath = await findConfigPath();
  if (!configPath) {
    console.log(`${chalk.red('✗')} No config found. Run: ctxhub init`);
    return;
  }

  const config = await loadConfig();
  const checks = buildDoctorChecks(config, configPath);

  if (process.stdout.isTTY) {
    const lines = await runDoctorChecklist(checks);
    for (const line of lines) printCheckLine(line);
  } else {
    await runDoctorChecks(checks, (_id, lines) => {
      for (const line of lines) printCheckLine(line);
    });
  }

  if (!opts.fix) return;

  const drift = await detectDrift(config);
  const actions: FixAction[] = [];

  for (const dir of [INDEX_DIR, CACHE_DIR, MEMORY_DIR]) {
    const fullPath = path.join(process.cwd(), dir);
    if (await pathExists(fullPath)) continue;
    actions.push({ description: `Create missing directory ${dir}`, apply: () => ensureDir(fullPath) });
  }

  if (!config.privacy.redactPatterns.length) {
    actions.push({
      description: 'Add default privacy.redactPatterns to config',
      apply: async () => {
        config.privacy.redactPatterns = [...defaultConfig.privacy.redactPatterns];
        await saveConfig(config);
      }
    });
  }

  if (opts.fixSkills) {
    const staleAgents = [...new Set(drift.staleSkills.map(key => key.split(':')[0]))];
    for (const agent of staleAgents) {
      actions.push({
        description: `Reinstall stale ${agent} skill file(s)`,
        apply: () => skillsInstallCommand([agent])
      });
    }
  } else if (drift.staleSkills.length) {
    console.log(chalk.gray(`  (${drift.staleSkills.length} stale skill file(s) found — re-run with --fix-skills to reinstall them)`));
  }

  if (opts.fixAgent) {
    if (!(SUPPORTED_AGENTS as readonly string[]).includes(opts.fixAgent)) {
      console.log(`${chalk.red('✗')} Unknown agent for --fix-agent: ${opts.fixAgent}. Supported: ${SUPPORTED_AGENTS.join(', ')}`);
    } else {
      const agent = opts.fixAgent as SupportedAgent;
      actions.push({ description: `Refresh ${agent} MCP config`, apply: async () => { await CONFIG_WRITERS[agent](); } });
    }
  }

  console.log(`\n${chalk.bold('Fix')}`);

  if (!actions.length) {
    console.log(`${chalk.green('✓')} Nothing to fix.`);
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.yellow('Dry run — no changes applied. Would:'));
    for (const action of actions) console.log(`  - ${action.description}`);
    return;
  }

  for (const action of actions) {
    await action.apply();
    console.log(`${chalk.green('✓')} ${action.description}`);
  }
}
