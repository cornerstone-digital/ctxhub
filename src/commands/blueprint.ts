import path from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
import { resolveDependencies } from '../blueprints/resolver.js';
import { getSyncConfig } from '../cloud/sync.js';
import { publishBlueprint, listRegistryBlueprints, downloadRegistryBlueprint } from '../blueprints/registryClient.js';

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

// ── blueprintPublishCommand ───────────────────────────────────────────────────

export async function blueprintPublishCommand(target: string, opts: { public?: boolean } = {}): Promise<void> {
  const syncConfig = await getSyncConfig();
  if (!syncConfig) {
    console.error(chalk.red('Error: Cloud sync is not configured.'));
    console.error(chalk.gray('Run: ctxhub cloud configure --endpoint <url> --api-key <key>'));
    process.exit(1);
  }

  const isArchive = target.endsWith('.ctxblueprint');
  let archivePath = path.resolve(target);
  let manifest: BlueprintManifest;

  if (isArchive) {
    if (!(await pathExists(archivePath))) {
      console.error(chalk.red(`✗ File not found: ${archivePath}`));
      process.exit(1);
    }
    const tmpDir = path.join(os.tmpdir(), `ctxhub-publish-read-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      await execa('tar', ['-xzf', archivePath, '-C', tmpDir]);
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(tmpDir);
      manifest = await readManifest(entries.length === 1 ? path.join(tmpDir, entries[0]!) : tmpDir);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } else {
    // A source directory -- pack it to a temp archive first.
    const sourceDir = path.resolve(target);
    manifest = await readManifest(sourceDir);
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      console.error(chalk.red(`✗ Invalid blueprint manifest:`));
      for (const e of errors) console.error(chalk.red(`  - ${e}`));
      process.exit(1);
    }
    archivePath = path.join(os.tmpdir(), `${manifest.name}-${manifest.version}-${Date.now()}.ctxblueprint`);
    await execa('tar', ['-czf', archivePath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  }

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    console.error(chalk.red(`✗ Invalid blueprint manifest:`));
    for (const e of errors) console.error(chalk.red(`  - ${e}`));
    process.exit(1);
  }

  const archive = await readFile(archivePath);
  console.log(chalk.gray(`Publishing ${manifest.name}@${manifest.version} (${archive.length} bytes, ${opts.public ? 'public' : 'org-private'})...`));

  try {
    const record = await publishBlueprint(syncConfig, archive, {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      tags: manifest.tags,
      serviceTypes: manifest.serviceTypes,
      public: opts.public ?? false,
    });
    console.log(chalk.green(`✓ Published ${record.name}@${record.version} → ${syncConfig.endpoint}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  } finally {
    if (!isArchive) await rm(archivePath, { force: true }).catch(() => undefined);
  }
}

// ── installBlueprintArchive (shared core, used by both the CLI and the HTTP handler) ───────
// Throws Error on any failure rather than console.error + process.exit -- an HTTP request
// handler calling process.exit() would kill the whole ctxhub service, not just the request.

export async function installBlueprintArchive(
  archivePath: string,
  opts: { ignoreDeps?: boolean } = {}
): Promise<{ installed: InstalledBlueprint; depOrder?: string[] }> {
  const home = getBlueprintHome();
  await ensureDir(home);

  const tmpDir = path.join(home, `.tmp-install-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    await execa('tar', ['-xzf', archivePath, '-C', tmpDir]);

    const { readdir, rename } = await import('node:fs/promises');
    const entries = await readdir(tmpDir);
    const extractedDir = entries.length === 1 ? path.join(tmpDir, entries[0]!) : tmpDir;

    const manifest = await readManifest(extractedDir);
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      throw new Error(`Invalid blueprint manifest in archive: ${errors.join('; ')}`);
    }

    let depOrder: string[] | undefined;
    if (!opts.ignoreDeps && (manifest.dependencies?.length ?? 0) > 0) {
      const store = await loadBlueprintStore();
      const resolution = await resolveDependencies(manifest, store);
      if (resolution.missing.length > 0) {
        const reasons = resolution.missing.map(m => `${m.name}: ${m.reason}`).join('; ');
        throw new Error(`Missing dependencies (${reasons}). Install them first, or pass --ignore-deps to skip this check.`);
      }
      if (resolution.order.length > 1) {
        depOrder = resolution.order.filter(n => n !== manifest.name);
      }
    }

    const installDir = path.join(home, manifest.name);
    if (await pathExists(installDir)) {
      await rm(installDir, { recursive: true, force: true });
    }
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

    return { installed, depOrder };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── resolveInstallTarget (shared core) ──────────────────────────────────────────────────
// Resolves a CLI target (local path or registry name[@version]) to a local archive file,
// downloading from the registry if needed. Throws Error on failure. Caller must invoke the
// returned cleanup() when done -- it's a no-op for a target that was already a local file.

export async function resolveInstallTarget(target: string): Promise<{ archivePath: string; cleanup: () => Promise<void> }> {
  const looksLikeLocalPath = target.endsWith('.ctxblueprint') || target.startsWith('./') || target.startsWith('../') || target.startsWith('/');

  if (looksLikeLocalPath) {
    const archivePath = path.resolve(target);
    if (!(await pathExists(archivePath))) {
      throw new Error(`File not found: ${archivePath}`);
    }
    return { archivePath, cleanup: async () => undefined };
  }

  const syncConfig = await getSyncConfig();
  if (!syncConfig) {
    throw new Error(
      'Cloud sync is not configured, and this doesn\'t look like a local path. ' +
      'Configure a registry with `ctxhub cloud configure`, or install from a local .ctxblueprint file.'
    );
  }

  const [name, requestedVersion] = target.split('@');
  if (!name) throw new Error('Invalid blueprint name');

  let version = requestedVersion;
  if (!version) {
    // No semver comparison library in this project -- "latest" is approximated as the most
    // recently published version, not the highest semver. Documented simplification; could
    // be wrong for out-of-order publishes.
    const matches = (await listRegistryBlueprints(syncConfig, name)).filter(b => b.name === name);
    if (matches.length === 0) throw new Error(`No blueprint named "${name}" found in the registry.`);
    version = matches.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]!.version;
  }

  const archive = await downloadRegistryBlueprint(syncConfig, name, version);
  const archivePath = path.join(os.tmpdir(), `${name}-${version}-${Date.now()}.ctxblueprint`);
  await writeFile(archivePath, archive);
  return { archivePath, cleanup: async () => { try { await rm(archivePath, { force: true }); } catch { /* best-effort */ } } };
}

// ── blueprintInstallCommand ───────────────────────────────────────────────────

export async function blueprintInstallCommand(target: string, opts: { ignoreDeps?: boolean } = {}): Promise<void> {
  let resolved: Awaited<ReturnType<typeof resolveInstallTarget>>;
  try {
    resolved = await resolveInstallTarget(target);
  } catch (err) {
    console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  try {
    const { installed, depOrder } = await installBlueprintArchive(resolved.archivePath, opts);
    if (depOrder) console.log(chalk.dim(`Dependencies resolved (install order: ${depOrder.join(' → ')} → ${installed.name})`));
    console.log(chalk.green(`✓ Installed ${installed.name}@${installed.version}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  } finally {
    await resolved.cleanup();
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
