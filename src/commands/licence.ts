import path from 'node:path';
import { copyFile } from 'node:fs/promises';
import chalk from 'chalk';
import { pathExists, readText, ensureDir } from '../utils/fs.js';
import { loadLicence, validateLicence, getLicenceFilePath } from '../licence/licence.js';
import { getCtxhubHome } from '../workspaces/registry.js';

// ── licence status ────────────────────────────────────────────────────────────

export async function licenceStatusCommand(): Promise<void> {
  const licence = await loadLicence();

  if (!licence) {
    const filePath = getLicenceFilePath();
    console.log(chalk.yellow('No licence file found.'));
    console.log(chalk.dim(`  Checked: ${filePath}`));
    console.log(chalk.dim('  Not required for self-hosted; needed for air-gapped enterprise.'));
    console.log(chalk.dim('  Install with: ctxhub licence install --file <path>'));
    return;
  }

  const validation = validateLicence(licence);

  const statusColor = validation.status === 'valid'
    ? chalk.green
    : validation.status === 'expired'
      ? chalk.yellow
      : chalk.red;

  console.log(`Licence status: ${statusColor(validation.status.toUpperCase())}`);
  if (validation.reason) {
    console.log(`  ${chalk.dim(validation.reason)}`);
  }

  console.log('');
  console.log(`  Org name:   ${chalk.cyan(licence.orgName)}`);
  console.log(`  Licence ID: ${chalk.dim(licence.licenceId)}`);
  console.log(`  Seats:      ${licence.seats}`);
  console.log(`  Valid from: ${new Date(licence.validFrom).toLocaleDateString()}`);
  console.log(`  Valid until: ${new Date(licence.validUntil).toLocaleDateString()}`);
  console.log(`  Features:   ${licence.features.join(', ') || '(none)'}`);
}

// ── licence install ───────────────────────────────────────────────────────────

export async function licenceInstallCommand(opts: { file: string }): Promise<void> {
  const sourcePath = path.resolve(opts.file);

  if (!(await pathExists(sourcePath))) {
    console.error(chalk.red(`✗ File not found: ${sourcePath}`));
    process.exit(1);
  }

  // Parse the licence file
  let licenceData: unknown;
  try {
    const raw = await readText(sourcePath);
    licenceData = JSON.parse(raw);
  } catch {
    console.error(chalk.red(`✗ Failed to parse licence file as JSON: ${sourcePath}`));
    process.exit(1);
  }

  // Validate the licence before installing
  const { validateLicence: validate } = await import('../licence/licence.js');
  const validation = validate(licenceData as import('../licence/types.js').LicenceKey);

  if (validation.status === 'invalid') {
    console.error(chalk.red(`✗ Licence is invalid: ${validation.reason ?? 'unknown reason'}`));
    process.exit(1);
  }

  if (validation.status === 'expired') {
    console.error(chalk.yellow(`⚠ Licence is expired: ${validation.reason ?? ''}`));
    console.error(chalk.yellow('  Installing anyway, but it will not grant access until renewed.'));
  }

  // Copy to ~/.ctxhub/licence.json
  const home = getCtxhubHome();
  await ensureDir(home);
  const destPath = path.join(home, 'licence.json');
  await copyFile(sourcePath, destPath);

  const lic = validation.licence!;
  console.log(chalk.green(`✓ Licence installed to ${destPath}`));
  console.log(`  Org: ${chalk.cyan(lic.orgName)}`);
  console.log(`  Status: ${validation.status === 'valid' ? chalk.green('valid') : chalk.yellow(validation.status)}`);
  console.log(`  Valid until: ${new Date(lic.validUntil).toLocaleDateString()}`);
  console.log(`  Features: ${lic.features.join(', ')}`);
}
