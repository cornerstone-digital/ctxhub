import chalk from 'chalk';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import type { LandRegistryEvidenceSourceConfig } from '../config/types.js';

// ADR-020: evidence sources are a distinct top-level command family from `repo` -- git keeps
// its own dedicated commands (add/discover/hook all assume a local git checkout, which no
// other EvidenceSource kind has), and non-git sources land here. Whether these merge later
// is an open UX question the architecture doc explicitly leaves unresolved.

export async function sourceAddLandRegistryCommand(name: string, opts: { area?: string; since?: string } = {}) {
  const { config } = await loadWorkspaceConfig();

  if (config.repositories.some(r => r.name === name) || (config.evidenceSources ?? []).some(s => s.name === name)) {
    throw new Error(`Evidence source already exists: ${name}`);
  }

  if (!opts.area) {
    throw new Error('--area <postcode-outcode> is required, e.g. --area SW1A');
  }

  const source: LandRegistryEvidenceSourceConfig = {
    kind: 'land-registry',
    name,
    postcodeArea: opts.area.trim().toUpperCase(),
    sinceDate: opts.since
  };

  config.evidenceSources = [...(config.evidenceSources ?? []), source];
  await saveConfig(config);

  console.log(chalk.green(`Added Land Registry evidence source ${name} -> postcode area ${source.postcodeArea}`));
  console.log(chalk.gray('Next: run ctxhub index to pull comparable sales into the workspace.'));
}

export async function sourceListCommand() {
  const { config } = await loadWorkspaceConfig();
  const evidenceSources = config.evidenceSources ?? [];

  if (!config.repositories.length && !evidenceSources.length) {
    console.log(chalk.yellow('No evidence sources configured.'));
    return;
  }

  for (const repo of config.repositories) {
    console.log(`${chalk.green('✓')} ${repo.name} ${chalk.gray(`git · ${repo.path}`)}`);
  }
  for (const source of evidenceSources) {
    console.log(`${chalk.green('✓')} ${source.name} ${chalk.gray(`land-registry · ${source.postcodeArea}`)}`);
  }
}
