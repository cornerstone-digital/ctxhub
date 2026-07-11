import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import chalk from 'chalk';
import { listWorkspaces, registerWorkspace, removeWorkspace } from '../workspaces/registry.js';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

export async function workspaceRegisterCommand(targetPath = '.', opts: { name?: string } = {}) {
  const absolutePath = path.resolve(process.cwd(), targetPath);
  const entry = await registerWorkspace(absolutePath, opts.name);
  console.log(chalk.green(`Registered workspace "${entry.name}": ${entry.path}`));
}

export async function workspaceListCommand() {
  const workspaces = await listWorkspaces();
  if (!workspaces.length) {
    console.log(chalk.yellow('No workspaces registered. Run: ctxhub workspace register [path]'));
    return;
  }

  console.log(chalk.bold('Registered workspaces') + chalk.gray(' (~/.ctxhub/registry.json)'));
  console.log('');

  for (const workspace of workspaces) {
    const marker = workspace.exists ? chalk.green('✓') : chalk.red('✗');
    const segments = workspace.path.split(path.sep);
    const shortPath = segments.slice(-3).join(path.sep);
    console.log(`${marker} ${workspace.name} ${chalk.gray(shortPath)}`);
    if (!workspace.exists) {
      console.log(`    ${chalk.red('(path missing)')} ${chalk.gray(workspace.path)}`);
    }
  }
}

export async function workspaceRemoveCommand(name: string) {
  const removed = await removeWorkspace(name);
  if (!removed) {
    console.log(chalk.yellow(`No registered workspace named "${name}".`));
    return;
  }

  console.log(chalk.green(`Removed workspace "${name}" from the registry.`));
}

// ── Export format ────────────────────────────────────────────────────────────

type WorkspaceExportFileEntry = { path: string; content: string };

type WorkspaceExport = {
  version: 1;
  exportedAt: string;
  workspace: {
    name: string;
    config: unknown;
  };
  notes: WorkspaceExportFileEntry[];
  diagrams: WorkspaceExportFileEntry[];
};

async function collectFiles(dir: string, rootDir: string): Promise<WorkspaceExportFileEntry[]> {
  const entries: WorkspaceExportFileEntry[] = [];
  if (!(await pathExists(dir))) return entries;
  const items = await fsPromises.readdir(dir, { withFileTypes: true, recursive: true });
  for (const item of items) {
    if (item.isFile()) {
      // Node 20+: Dirent.parentPath; older Node 18: Dirent.path
      const parentDir = (item as unknown as { parentPath?: string; path?: string }).parentPath
        ?? (item as unknown as { path?: string }).path
        ?? dir;
      const fullPath = path.join(parentDir, item.name);
      try {
        const content = await fsPromises.readFile(fullPath, 'utf-8');
        entries.push({ path: path.relative(rootDir, fullPath), content });
      } catch { /* skip unreadable files */ }
    }
  }
  return entries;
}

export async function workspaceExportCommand(opts: { name: string; out: string }): Promise<void> {
  if (!opts.name?.trim()) { console.error('Error: --name is required'); process.exit(1); }
  if (!opts.out?.trim()) { console.error('Error: --out is required'); process.exit(1); }

  const workspaces = await listWorkspaces();
  const wsEntry = workspaces.find(w => w.name === opts.name.trim());
  if (!wsEntry) { console.error(`Error: No registered workspace named "${opts.name}"`); process.exit(1); }
  if (!wsEntry.exists) { console.error(`Error: Workspace path no longer exists: ${wsEntry.path}`); process.exit(1); }

  const { config, workspaceRoot } = await loadWorkspaceConfig(wsEntry.path);

  const notesDir = path.join(workspaceRoot, 'agent-notes');
  const diagramsDir = path.join(workspaceRoot, 'docs', 'architecture');

  const notes = await collectFiles(notesDir, workspaceRoot);
  const diagrams = await collectFiles(diagramsDir, workspaceRoot);

  const exported: WorkspaceExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { name: wsEntry.name, config },
    notes,
    diagrams,
  };

  const outPath = path.resolve(process.cwd(), opts.out);
  await writeText(outPath, `${JSON.stringify(exported, null, 2)}\n`);

  console.log(chalk.green(`Exported workspace "${wsEntry.name}" to ${outPath}`));
  console.log(chalk.gray(`  Notes:    ${notes.length}`));
  console.log(chalk.gray(`  Diagrams: ${diagrams.length}`));
  console.log(chalk.dim('Run: ctxhub index   to rebuild the search index after import.'));
}

export async function workspaceImportCommand(opts: { from: string; name?: string }): Promise<void> {
  if (!opts.from?.trim()) { console.error('Error: --from is required'); process.exit(1); }

  const fromPath = path.resolve(process.cwd(), opts.from);
  if (!(await pathExists(fromPath))) {
    console.error(`Error: File not found: ${fromPath}`);
    process.exit(1);
  }

  let exported: WorkspaceExport;
  try {
    exported = JSON.parse(await readText(fromPath)) as WorkspaceExport;
  } catch {
    console.error('Error: Could not parse export file as JSON.');
    process.exit(1);
    return;
  }

  if (exported.version !== 1) {
    console.error(`Error: Unsupported export version: ${exported.version}`);
    process.exit(1);
    return;
  }

  const wsName = opts.name?.trim() ?? exported.workspace.name;
  const workspaces = await listWorkspaces();
  const existing = workspaces.find(w => w.name === wsName);

  let workspaceRoot: string;
  if (existing?.exists) {
    workspaceRoot = existing.path;
  } else {
    workspaceRoot = path.join(process.cwd(), wsName);
    await fsPromises.mkdir(workspaceRoot, { recursive: true });
  }

  // Restore config
  const { saveConfig: save } = await import('../config/config.js');
  await save(exported.workspace.config as Parameters<typeof save>[0], workspaceRoot);

  // Restore notes
  let restoredNotes = 0;
  for (const file of exported.notes) {
    const dest = path.join(workspaceRoot, file.path);
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    await fsPromises.writeFile(dest, file.content, 'utf-8');
    restoredNotes++;
  }

  // Restore diagrams
  let restoredDiagrams = 0;
  for (const file of exported.diagrams) {
    const dest = path.join(workspaceRoot, file.path);
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    await fsPromises.writeFile(dest, file.content, 'utf-8');
    restoredDiagrams++;
  }

  console.log(chalk.green(`Imported workspace "${wsName}" to ${workspaceRoot}`));
  console.log(chalk.gray(`  Notes:    ${restoredNotes}`));
  console.log(chalk.gray(`  Diagrams: ${restoredDiagrams}`));
  console.log(chalk.dim('Run: ctxhub workspace register && ctxhub index   to register and rebuild the index.'));
}

// ── Per-workspace RBAC: grant / revoke / members ──────────────────────────────

export async function workspaceGrantCommand(opts: { workspace: string; sub: string; role: string }) {
  if (!opts.workspace?.trim()) { console.error('Error: --workspace is required'); process.exit(1); }
  if (!opts.sub?.trim()) { console.error('Error: --sub is required'); process.exit(1); }
  if (!opts.role?.trim()) { console.error('Error: --role is required'); process.exit(1); }

  const workspaces = await listWorkspaces();
  const wsEntry = workspaces.find(w => w.name === opts.workspace.trim());
  if (!wsEntry) {
    console.error(`Error: No registered workspace named "${opts.workspace}". Run: ctxhub workspace list`);
    process.exit(1);
  }
  if (!wsEntry.exists) {
    console.error(`Error: Workspace path no longer exists: ${wsEntry.path}`);
    process.exit(1);
  }

  const { config } = await loadWorkspaceConfig(wsEntry.path);
  config.workspace.memberOverrides = { ...(config.workspace.memberOverrides ?? {}), [opts.sub.trim()]: opts.role.trim() };
  await saveConfig(config, wsEntry.path);

  console.log(chalk.green(`✓ Granted ${opts.sub.trim()} role ${opts.role.trim()} in workspace ${opts.workspace.trim()}`));
}

export async function workspaceRevokeCommand(opts: { workspace: string; sub: string }) {
  if (!opts.workspace?.trim()) { console.error('Error: --workspace is required'); process.exit(1); }
  if (!opts.sub?.trim()) { console.error('Error: --sub is required'); process.exit(1); }

  const workspaces = await listWorkspaces();
  const wsEntry = workspaces.find(w => w.name === opts.workspace.trim());
  if (!wsEntry) {
    console.error(`Error: No registered workspace named "${opts.workspace}". Run: ctxhub workspace list`);
    process.exit(1);
  }
  if (!wsEntry.exists) {
    console.error(`Error: Workspace path no longer exists: ${wsEntry.path}`);
    process.exit(1);
  }

  const { config } = await loadWorkspaceConfig(wsEntry.path);
  const overrides = { ...(config.workspace.memberOverrides ?? {}) };
  delete overrides[opts.sub.trim()];
  config.workspace.memberOverrides = Object.keys(overrides).length ? overrides : undefined;
  await saveConfig(config, wsEntry.path);

  console.log(chalk.green(`✓ Revoked override for ${opts.sub.trim()} in workspace ${opts.workspace.trim()}`));
}

export async function workspaceMembersCommand(opts: { workspace: string }) {
  if (!opts.workspace?.trim()) { console.error('Error: --workspace is required'); process.exit(1); }

  const workspaces = await listWorkspaces();
  const wsEntry = workspaces.find(w => w.name === opts.workspace.trim());
  if (!wsEntry) {
    console.error(`Error: No registered workspace named "${opts.workspace}". Run: ctxhub workspace list`);
    process.exit(1);
  }
  if (!wsEntry.exists) {
    console.error(`Error: Workspace path no longer exists: ${wsEntry.path}`);
    process.exit(1);
  }

  const { config } = await loadWorkspaceConfig(wsEntry.path);
  const allowedRoles = config.workspace.allowedRoles;
  const memberOverrides = config.workspace.memberOverrides;

  console.log(chalk.bold(`Workspace: ${opts.workspace.trim()}`));
  if (allowedRoles && allowedRoles.length > 0) {
    console.log(`  Allowed roles:   ${allowedRoles.join(', ')}`);
  } else {
    console.log(`  Allowed roles:   ${chalk.gray('(any authenticated user)')}`);
  }

  if (memberOverrides && Object.keys(memberOverrides).length > 0) {
    console.log(`\n  Member overrides:`);
    for (const [sub, role] of Object.entries(memberOverrides)) {
      console.log(`    ${sub}  →  ${chalk.cyan(role)}`);
    }
  } else {
    console.log(`  Member overrides: ${chalk.gray('(none)')}`);
  }
}

export async function workspaceSetRolesCommand(opts: { name: string; roles: string }) {
  if (!opts.name?.trim()) {
    console.error('Error: --name is required');
    process.exit(1);
  }
  if (!opts.roles?.trim()) {
    console.error('Error: --roles is required (comma-separated list, or empty string to clear)');
    process.exit(1);
  }

  const workspaces = await listWorkspaces();
  const wsEntry = workspaces.find(w => w.name === opts.name.trim());
  if (!wsEntry) {
    console.error(`Error: No registered workspace named "${opts.name}". Run: ctxhub workspace list`);
    process.exit(1);
  }
  if (!wsEntry.exists) {
    console.error(`Error: Workspace path no longer exists: ${wsEntry.path}`);
    process.exit(1);
  }

  const { config } = await loadWorkspaceConfig(wsEntry.path);
  const roles = opts.roles.trim() === '' ? undefined : opts.roles.split(',').map(r => r.trim()).filter(Boolean);
  config.workspace.allowedRoles = roles;
  await saveConfig(config, wsEntry.path);

  if (roles && roles.length > 0) {
    console.log(chalk.green(`Set allowedRoles for workspace "${opts.name}": ${roles.join(', ')}`));
  } else {
    console.log(chalk.green(`Cleared allowedRoles for workspace "${opts.name}" — any authenticated user may access it`));
  }
}
