import chalk from 'chalk';
import { VALID_ROLES } from '../auth/roles.js';
import {
  loadCustomRoleStore,
  saveCustomRoleStore,
  findCustomRole,
  resolvePermissions,
} from '../auth/customRoleStore.js';
import type { CustomRole, Permission } from '../auth/customRoles.js';

const VALID_PERMISSIONS: Permission[] = [
  'knowledge:read', 'knowledge:write', 'knowledge:promote',
  'workspace:read', 'workspace:write',
  'group:read', 'group:write',
  'audit:read',
  'admin:all',
];

// ── role create ───────────────────────────────────────────────────────────────

export async function roleCreateCommand(opts: {
  name: string;
  permissions: string;
  inherits?: string;
  description?: string;
}): Promise<void> {
  const { name, permissions, inherits, description } = opts;

  // Validate: must not conflict with built-in roles
  if ((VALID_ROLES as readonly string[]).includes(name)) {
    console.error(chalk.red(`✗ "${name}" is a built-in role and cannot be redefined.`));
    process.exit(1);
  }

  const permList = permissions.split(',').map(p => p.trim()).filter(Boolean) as Permission[];
  const invalidPerms = permList.filter(p => !VALID_PERMISSIONS.includes(p));
  if (invalidPerms.length > 0) {
    console.error(chalk.red(`✗ Unknown permissions: ${invalidPerms.join(', ')}`));
    console.error(chalk.dim(`  Valid permissions: ${VALID_PERMISSIONS.join(', ')}`));
    process.exit(1);
  }

  if (inherits && !(VALID_ROLES as readonly string[]).includes(inherits)) {
    // Check if it's a custom role that exists (we'll re-check after loading)
    const store = await loadCustomRoleStore();
    if (!findCustomRole(store, inherits)) {
      console.error(chalk.red(`✗ Role to inherit from not found: "${inherits}"`));
      process.exit(1);
    }
  }

  const store = await loadCustomRoleStore();

  if (findCustomRole(store, name)) {
    console.error(chalk.red(`✗ Custom role "${name}" already exists. Delete it first.`));
    process.exit(1);
  }

  const role: CustomRole = {
    name,
    description,
    permissions: permList,
    inheritsFrom: inherits,
    createdAt: new Date().toISOString(),
    createdBy: 'cli',
  };

  store.roles.push(role);
  await saveCustomRoleStore(store);

  console.log(chalk.green(`✓ Custom role "${name}" created`));
  console.log(`  Permissions: ${chalk.cyan(permList.join(', ') || '(none)')}`);
  if (inherits) console.log(`  Inherits from: ${chalk.cyan(inherits)}`);
}

// ── role list ─────────────────────────────────────────────────────────────────

export async function roleListCommand(): Promise<void> {
  const store = await loadCustomRoleStore();

  console.log(chalk.bold('Built-in roles:'));
  for (const r of VALID_ROLES) {
    console.log(`  ${chalk.cyan(r)}`);
  }

  console.log('');
  if (store.roles.length === 0) {
    console.log(chalk.yellow('No custom roles defined.'));
    console.log(chalk.dim(`  Create one with: ctxhub role create --name <name> --permissions <p1,p2,...>`));
    return;
  }

  console.log(chalk.bold(`Custom roles (${store.roles.length}):`));
  for (const r of store.roles) {
    const inherits = r.inheritsFrom ? ` (inherits: ${chalk.dim(r.inheritsFrom)})` : '';
    console.log(`  ${chalk.cyan(r.name)}${inherits}`);
    if (r.description) console.log(`    ${chalk.dim(r.description)}`);
    console.log(`    Permissions: ${r.permissions.join(', ') || '(none)'}`);
  }
}

// ── role show ─────────────────────────────────────────────────────────────────

export async function roleShowCommand(name: string): Promise<void> {
  const store = await loadCustomRoleStore();

  // Check built-in
  if ((VALID_ROLES as readonly string[]).includes(name)) {
    const perms = resolvePermissions(name, store);
    console.log(chalk.bold(`Built-in role: ${name}`));
    console.log(`  Permissions:`);
    for (const p of perms) {
      console.log(`    ${chalk.cyan(p)}`);
    }
    return;
  }

  const role = findCustomRole(store, name);
  if (!role) {
    console.error(chalk.red(`✗ Role not found: "${name}"`));
    process.exit(1);
  }

  const effectivePerms = resolvePermissions(name, store);

  console.log(chalk.bold(`Custom role: ${name}`));
  if (role.description) console.log(`  Description: ${role.description}`);
  if (role.inheritsFrom) console.log(`  Inherits from: ${chalk.cyan(role.inheritsFrom)}`);
  console.log(`  Own permissions: ${role.permissions.join(', ') || '(none)'}`);
  console.log(`  Effective permissions (including inherited):`);
  for (const p of effectivePerms) {
    console.log(`    ${chalk.cyan(p)}`);
  }
  console.log(`  Created at: ${new Date(role.createdAt).toLocaleString()}`);
}

// ── role delete ───────────────────────────────────────────────────────────────

export async function roleDeleteCommand(name: string): Promise<void> {
  if ((VALID_ROLES as readonly string[]).includes(name)) {
    console.error(chalk.red(`✗ Cannot delete built-in role "${name}".`));
    process.exit(1);
  }

  const store = await loadCustomRoleStore();

  if (!findCustomRole(store, name)) {
    console.error(chalk.red(`✗ Custom role "${name}" not found.`));
    process.exit(1);
  }

  store.roles = store.roles.filter(r => r.name !== name);
  await saveCustomRoleStore(store);

  console.log(chalk.green(`✓ Custom role "${name}" deleted`));
}
