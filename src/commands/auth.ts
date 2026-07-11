import { initAuthConfig, loadAuthConfig, isAuthConfigured, updateRoleMap } from '../auth/config.js';
import { loadTokens, clearTokens } from '../auth/store.js';
import { runLoginFlow } from '../auth/loginFlow.js';
import { REDIRECT_URI } from '../auth/loginFlow.js';
import { isValidRole, VALID_ROLES } from '../auth/roles.js';
import { eventBus } from '../events/eventBus.js';
import type { RoleMap } from '../auth/types.js';
import { loadGroupStore, findGroup } from '../groups/store.js';
import { resolveOrgForUser } from '../groups/groups.js';

export interface AuthConfigureOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export async function authConfigureCommand(opts: AuthConfigureOptions): Promise<void> {
  const config = await initAuthConfig({
    tenantId: opts.tenantId,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: REDIRECT_URI,
  });

  console.log('✓ Auth configured');
  console.log(`  Tenant ID:    ${config.oidc.tenantId}`);
  console.log(`  Client ID:    ${config.oidc.clientId}`);
  console.log(`  Redirect URI: ${config.oidc.redirectUri}`);
  console.log('');
  console.log('Ensure this redirect URI is registered in your Entra ID app registration.');
  console.log('Then run: ctxhub login');

  const allEnvVarsPresent =
    Boolean(process.env['CTXHUB_TENANT_ID']) &&
    Boolean(process.env['CTXHUB_CLIENT_ID']) &&
    Boolean(process.env['CTXHUB_CLIENT_SECRET']) &&
    Boolean(process.env['CTXHUB_JWT_SECRET']);

  if (allEnvVarsPresent) {
    console.log('');
    console.log('Note: auth is also configured via environment variables (CTXHUB_TENANT_ID etc.).');
    console.log('Environment variables take precedence over this file configuration.');
  }
}

export async function authStatusCommand(): Promise<void> {
  const configured = await isAuthConfigured();

  if (!configured) {
    console.log('Auth:    not configured');
    console.log('Mode:    local (no authentication required)');
    console.log('');
    console.log('To configure enterprise SSO:');
    console.log('  ctxhub auth configure --tenant-id <id> --client-id <id> --client-secret <secret>');
    return;
  }

  const config = await loadAuthConfig();
  const tokens = await loadTokens();

  console.log('Auth:    configured (Microsoft Entra ID)');
  console.log(`Tenant:  ${config!.oidc.tenantId}`);
  console.log(`Client:  ${config!.oidc.clientId}`);
  console.log('');

  if (!tokens) {
    console.log('Session: not logged in');
    console.log('Run:     ctxhub login');
    return;
  }

  const expiry = new Date(tokens.ctxhubToken.expiresAt);
  const expired = expiry <= new Date();

  console.log(`User:    ${tokens.user.name} <${tokens.user.email}>`);
  console.log(`Sub:     ${tokens.user.sub}`);

  // Decode roles from the ctxhub JWT payload (same pattern as the Groups block below)
  try {
    const jwtParts = tokens.ctxhubToken.token.split('.');
    if (jwtParts.length === 3) {
      const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString()) as { roles?: string[] };
      const roles = payload.roles ?? [];
      console.log(`Roles:   ${roles.length ? roles.join(', ') : '(none)'}`);
    }
  } catch {
    // Non-fatal: JWT decode errors must not break auth status
  }

  console.log(`Session: ${expired ? 'expired' : 'active'}`);
  console.log(`Expires: ${expiry.toLocaleString()}`);

  if (expired) {
    console.log('');
    console.log('Run: ctxhub login');
  }

  // Show corporate group membership derived from tenantId in the stored JWT
  try {
    const jwtParts = tokens.ctxhubToken.token.split('.');
    if (jwtParts.length === 3) {
      const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString()) as { tenantId?: string };
      const tenantId = payload.tenantId;
      if (tenantId) {
        const groupStore = await loadGroupStore();
        const org = resolveOrgForUser(tenantId, groupStore);
        if (org) {
          const group = findGroup(groupStore, org.groupId);
          const groupName = group?.name ?? org.groupId;
          console.log(`Groups:  ${org.name} (${groupName})`);
        } else {
          console.log('Groups:  (not a member of any corporate group)');
        }
      } else {
        console.log('Groups:  (none)');
      }
    }
  } catch {
    // Non-fatal: group lookup errors must not break auth status
  }

  const roleMap = config!.roleMap;
  const hasOwnerSub = roleMap?.ownerSubs?.includes(tokens.user.sub);
  if (!hasOwnerSub) {
    console.log('');
    console.log('Tip: grant yourself owner access with:');
    console.log(`  ctxhub auth role-map add-owner --sub ${tokens.user.sub}`);
  }
}

export async function loginCommand(): Promise<void> {
  const configured = await isAuthConfigured();
  if (!configured) {
    console.error('Auth not configured.');
    console.error('Run: ctxhub auth configure --tenant-id <id> --client-id <id> --client-secret <secret>');
    process.exit(1);
  }

  try {
    const principal = await runLoginFlow();
    console.log(`\n✓ Signed in as ${principal.name} <${principal.email}>`);
  } catch (err) {
    console.error(`\nLogin failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export async function logoutCommand(): Promise<void> {
  const tokens = await loadTokens();
  await clearTokens();
  if (tokens) {
    try { eventBus.publish({ type: 'auth.logout', sub: tokens.user.sub, email: tokens.user.email }); } catch { /* audit failure must not break logout */ }
  }
  console.log('✓ Signed out');
}

// ── Role map commands ─────────────────────────────────────────────────────────

export async function roleMapListCommand(): Promise<void> {
  const config = await loadAuthConfig();
  if (!config) {
    console.error('Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  const map = config.roleMap ?? {};
  const ownerSubs = map.ownerSubs ?? [];
  const groupRoles = map.groupRoles ?? {};
  const defaultRole = map.defaultRole ?? 'member';

  console.log('Role map:');
  console.log(`  default role: ${defaultRole}`);
  console.log('');

  if (ownerSubs.length === 0 && Object.keys(groupRoles).length === 0) {
    console.log('  No explicit mappings. All authenticated users get the default role.');
    console.log('');
    console.log('  To grant yourself owner access:');
    console.log('    ctxhub auth role-map add-owner --sub <your-entra-object-id>');
    console.log('');
    console.log('  Your sub is shown in: ctxhub auth status');
    return;
  }

  if (ownerSubs.length > 0) {
    console.log('  Owner subs (unconditional):');
    for (const sub of ownerSubs) {
      console.log(`    ${sub}`);
    }
    console.log('');
  }

  if (Object.keys(groupRoles).length > 0) {
    console.log('  Group → role mappings:');
    for (const [group, role] of Object.entries(groupRoles)) {
      console.log(`    ${group} → ${role}`);
    }
    console.log('');
  }
}

export async function roleMapAddOwnerCommand(opts: { sub: string }): Promise<void> {
  const config = await loadAuthConfig();
  if (!config) {
    console.error('Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  const existing = config.roleMap ?? {};
  const ownerSubs = [...(existing.ownerSubs ?? [])];

  if (ownerSubs.includes(opts.sub)) {
    console.log(`Already an owner: ${opts.sub}`);
    return;
  }

  ownerSubs.push(opts.sub);
  const updated: RoleMap = { ...existing, ownerSubs };
  await updateRoleMap(updated);
  console.log(`✓ Added owner: ${opts.sub}`);
  console.log('  Re-run ctxhub login for the new role to take effect.');
}

export async function roleMapAddGroupCommand(opts: { group: string; role: string }): Promise<void> {
  if (!isValidRole(opts.role)) {
    console.error(`Invalid role: ${opts.role}`);
    console.error(`Valid roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const config = await loadAuthConfig();
  if (!config) {
    console.error('Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  const existing = config.roleMap ?? {};
  const groupRoles = { ...(existing.groupRoles ?? {}), [opts.group]: opts.role };
  await updateRoleMap({ ...existing, groupRoles });
  console.log(`✓ Mapped group ${opts.group} → ${opts.role}`);
  console.log('  Re-run ctxhub login for the new mapping to take effect.');
}

export async function roleMapRemoveGroupCommand(opts: { group: string }): Promise<void> {
  const config = await loadAuthConfig();
  if (!config) {
    console.error('Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  const existing = config.roleMap ?? {};
  const groupRoles = { ...(existing.groupRoles ?? {}) };
  if (!(opts.group in groupRoles)) {
    console.log(`Group not mapped: ${opts.group}`);
    return;
  }

  delete groupRoles[opts.group];
  await updateRoleMap({ ...existing, groupRoles });
  console.log(`✓ Removed group mapping: ${opts.group}`);
}

export async function roleMapSetDefaultCommand(opts: { role: string }): Promise<void> {
  if (!isValidRole(opts.role)) {
    console.error(`Invalid role: ${opts.role}`);
    console.error(`Valid roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const config = await loadAuthConfig();
  if (!config) {
    console.error('Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  const existing = config.roleMap ?? {};
  await updateRoleMap({ ...existing, defaultRole: opts.role });
  console.log(`✓ Default role set to: ${opts.role}`);
  console.log('  Re-run ctxhub login for the change to take effect.');
}
