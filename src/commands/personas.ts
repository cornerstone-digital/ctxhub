import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { initAgentsDirectory } from '../personas/persona.js';

export async function personasInitCommand() {
  const { workspaceRoot } = await loadWorkspaceConfig();
  const { created } = await initAgentsDirectory(workspaceRoot);

  if (!created.length) {
    console.log(chalk.yellow('agents/ already exists -- nothing to scaffold.'));
    return;
  }

  console.log(chalk.green('Scaffolded:'));
  for (const file of created) console.log(`  ${file}`);
  console.log(chalk.gray('Edit these to match your team, then use --as <persona> on explain/ask/handoff/review.'));
  console.log(chalk.gray('See docs/personas.md for how this works.'));
}
