import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import { DEFAULT_SERVICE_PORT } from '../service/server.js';

export async function webhookShowCommand(): Promise<void> {
  const { config } = await loadWorkspaceConfig();
  if (!config.webhooks?.token) {
    console.log(chalk.yellow('No webhook token set. Run: ctxhub webhook generate-token'));
    return;
  }
  const token = config.webhooks.token;
  const base = `http://localhost:${DEFAULT_SERVICE_PORT}`;
  console.log(chalk.bold('Webhook token:'), chalk.cyan(token));
  console.log();
  console.log(chalk.bold('Trigger URL pattern:'));
  console.log(chalk.gray(`  POST ${base}/webhooks/${token}/trigger/<name>`));
  console.log();
  console.log(chalk.bold('Examples:'));
  console.log(chalk.gray(`  # Fire a captain task:`));
  console.log(`  curl -X POST ${base}/webhooks/${token}/trigger/nightly-audit`);
  console.log(chalk.gray(`  # Fire a job:`));
  console.log(`  curl -X POST ${base}/webhooks/${token}/trigger/security-review-pipeline`);
  console.log();
  console.log(chalk.dim('Add to GitHub Actions, CI scripts, or any HTTP client.'));
}

export async function webhookGenerateTokenCommand(): Promise<void> {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const token = randomBytes(24).toString('hex');
  const updated = { ...config, webhooks: { token } };
  await saveConfig(updated, workspaceRoot);
  console.log(chalk.green('Webhook token saved.'));
  console.log(chalk.bold('Token:'), chalk.cyan(token));
  console.log(chalk.dim('Run: ctxhub webhook show   to see the full trigger URL.'));
}

export async function webhookSetTokenCommand(token: string): Promise<void> {
  if (!token || token.length < 8) {
    console.error(chalk.red('Token must be at least 8 characters.'));
    process.exitCode = 1;
    return;
  }
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const updated = { ...config, webhooks: { ...config.webhooks, token } };
  await saveConfig(updated, workspaceRoot);
  console.log(chalk.green(`Webhook token set.`));
  console.log(chalk.dim('Run: ctxhub webhook show   to see the full trigger URL.'));
}

export async function webhookSetSecretCommand(secret: string): Promise<void> {
  if (!secret || secret.length < 8) {
    console.error(chalk.red('Secret must be at least 8 characters.'));
    process.exitCode = 1;
    return;
  }
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  if (!config.webhooks?.token) {
    console.error(chalk.red('No webhook token set. Run: ctxhub webhook generate-token first.'));
    process.exitCode = 1;
    return;
  }
  const updated = { ...config, webhooks: { ...config.webhooks, webhookSecret: secret } };
  await saveConfig(updated, workspaceRoot);
  console.log(chalk.green('Webhook signing secret saved.'));
  console.log(chalk.dim('Callers must include X-Hub-Signature-256: sha256=<hmac> on every request.'));
}
