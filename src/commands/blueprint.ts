import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { pathExists, readText, ensureDir } from '../utils/fs.js';
import { execa } from '../utils/execa-lite.js';
import {
  getBlueprintHome,
  loadBlueprintStore,
  saveBlueprintStore,
  findInstalled
} from '../blueprints/store.js';
import type { BlueprintManifest, InstalledBlueprint } from '../blueprints/types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

async function readManifest(dir: string): Promise<BlueprintManifest> {
  const yamlPath = path.join(dir, 'blueprint.yaml');
  const jsonPath = path.join(dir, 'blueprint.json');

  let raw: string;
  let manifest: unknown;

  if (await pathExists(yamlPath)) {
    raw = await readText(yamlPath);
    manifest = yaml.load(raw);
  } else if (await pathExists(jsonPath)) {
    raw = await readText(jsonPath);
    manifest = JSON.parse(raw);
  } else {
    throw new Error(`No blueprint.yaml or blueprint.json found in ${dir}`);
  }

  return manifest as BlueprintManifest;
}

function validateManifest(manifest: BlueprintManifest): string[] {
  const errors: string[] = [];
  if (!manifest.name?.trim()) errors.push('name is required');
  if (!manifest.version?.trim()) errors.push('version is required');
  if (!manifest.description?.trim()) errors.push('description is required');
  return errors;
}

// ── blueprintPackCommand ──────────────────────────────────────────────────────

export async function blueprintPackCommand(opts: { dir?: string; out?: string } = {}): Promise<void> {
  const sourceDir = path.resolve(opts.dir ?? '.');
  const manifest = await readManifest(sourceDir);
  const errors = validateManifest(manifest);

  if (errors.length > 0) {
    console.error(chalk.red(`✗ Invalid blueprint manifest:`));
    for (const e of errors) console.error(chalk.red(`  - ${e}`));
    process.exit(1);
  }

  const archiveName = `${manifest.name}-${manifest.version}.ctxblueprint`;
  const outPath = opts.out ? path.resolve(opts.out) : path.join(process.cwd(), archiveName);

  // Use tar to create a gzipped archive — no external npm deps needed
  try {
    await execa('tar', ['-czf', outPath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  } catch (err) {
    console.error(chalk.red(`✗ Failed to create archive: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Packed ${manifest.name}@${manifest.version} → ${outPath}`));
}

// ── blueprintInstallCommand ───────────────────────────────────────────────────

export async function blueprintInstallCommand(target: string): Promise<void> {
  const looksLikeLocalPath = target.endsWith('.ctxblueprint') || target.startsWith('./') || target.startsWith('../') || target.startsWith('/');

  if (!looksLikeLocalPath) {
    console.log(chalk.yellow(
      `Registry not yet available. Install from a local .ctxblueprint file:\n  ctxhub blueprint install ./my-blueprint-1.0.0.ctxblueprint`
    ));
    return;
  }

  const archivePath = path.resolve(target);
  if (!(await pathExists(archivePath))) {
    console.error(chalk.red(`✗ File not found: ${archivePath}`));
    process.exit(1);
  }

  // Extract to a temp dir to read the manifest, then move to final location
  const home = getBlueprintHome();
  await ensureDir(home);

  const tmpDir = path.join(home, `.tmp-install-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    await execa('tar', ['-xzf', archivePath, '-C', tmpDir]);

    // Find the extracted directory (tar preserves the source dir name)
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(tmpDir);
    const extractedDir = entries.length === 1 ? path.join(tmpDir, entries[0]!) : tmpDir;

    const manifest = await readManifest(extractedDir);
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      console.error(chalk.red(`✗ Invalid blueprint manifest in archive:`));
      for (const e of errors) console.error(chalk.red(`  - ${e}`));
      process.exit(1);
    }

    const installDir = path.join(home, manifest.name);

    // Remove any existing installation
    if (await pathExists(installDir)) {
      await rm(installDir, { recursive: true, force: true });
    }

    // Move extracted content to final location
    const { rename } = await import('node:fs/promises');
    await rename(extractedDir, installDir);

    const installed: InstalledBlueprint = {
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      path: installDir
    };

    const store = await loadBlueprintStore();
    store.installed = store.installed.filter(b => b.name !== manifest.name);
    store.installed.push(installed);
    await saveBlueprintStore(store);

    console.log(chalk.green(`✓ Installed ${manifest.name}@${manifest.version}`));
  } finally {
    // Clean up tmp dir (best-effort)
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── blueprintListCommand ──────────────────────────────────────────────────────

export async function blueprintListCommand(): Promise<void> {
  const store = await loadBlueprintStore();

  if (store.installed.length === 0) {
    console.log(chalk.yellow('No blueprints installed. Install one with: ctxhub blueprint install <path>'));
    return;
  }

  console.log(chalk.bold(`${store.installed.length} blueprint(s) installed:\n`));
  for (const bp of store.installed) {
    const at = new Date(bp.installedAt).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
    console.log(`  ${chalk.cyan(bp.name)}  ${chalk.gray(`v${bp.version}`)}  ${chalk.dim(`installed ${at}`)}`);
    console.log(`    ${chalk.dim(bp.path)}`);
  }
}

// ── blueprintRemoveCommand ────────────────────────────────────────────────────

export async function blueprintRemoveCommand(name: string): Promise<void> {
  const existing = await findInstalled(name);
  if (!existing) {
    console.error(chalk.red(`✗ Blueprint not installed: ${name}`));
    process.exit(1);
  }

  if (await pathExists(existing.path)) {
    await rm(existing.path, { recursive: true, force: true });
  }

  const store = await loadBlueprintStore();
  store.installed = store.installed.filter(b => b.name !== name);
  await saveBlueprintStore(store);

  console.log(chalk.green(`✓ Removed ${name}`));
}
