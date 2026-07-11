import { createHmac } from 'node:crypto';
import { addOrg, createGroup, removeOrg, updateSharing } from '../groups/groups.js';
import { findGroup, findOrgsByGroup, findSharingPolicy, loadGroupStore } from '../groups/store.js';
import type { SharingMode, TrustTier } from '../groups/types.js';
import { loadAuthConfig } from '../auth/config.js';
import { loadTokens } from '../auth/store.js';

// ── groupCreateCommand ────────────────────────────────────────────────────────

export async function groupCreateCommand(opts: { name: string }): Promise<void> {
  if (!opts.name?.trim()) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  const group = await createGroup(opts.name.trim(), 'cli');
  console.log(`Created group:`);
  console.log(`  id:   ${group.id}`);
  console.log(`  name: ${group.name}`);
}

// ── groupListCommand ──────────────────────────────────────────────────────────

export async function groupListCommand(): Promise<void> {
  const store = await loadGroupStore();

  if (store.groups.length === 0) {
    console.log('No corporate groups defined. Use: ctxhub group create --name <name>');
    return;
  }

  for (const group of store.groups) {
    console.log(`\nGroup: ${group.name} (${group.id})`);
    const orgs = findOrgsByGroup(store, group.id);

    if (orgs.length === 0) {
      console.log('  No orgs added yet.');
    } else {
      const col1 = Math.max(6, ...orgs.map(o => o.name.length));
      const col2 = Math.max(9, ...orgs.map(o => o.tenantId.length));
      const col3 = 11;

      console.log(
        `  ${'Name'.padEnd(col1)}  ${'Tenant ID'.padEnd(col2)}  ${'Trust Tier'.padEnd(col3)}  Id`
      );
      console.log(
        `  ${'-'.repeat(col1)}  ${'-'.repeat(col2)}  ${'-'.repeat(col3)}  ${ '-'.repeat(36)}`
      );

      for (const org of orgs) {
        console.log(
          `  ${org.name.padEnd(col1)}  ${org.tenantId.padEnd(col2)}  ${org.trustTier.padEnd(col3)}  ${org.id}`
        );
      }
    }
  }
}

// ── groupAddOrgCommand ────────────────────────────────────────────────────────

export async function groupAddOrgCommand(opts: {
  groupId: string;
  name: string;
  tenantId: string;
  groupFilter?: string;
  trustTier?: string;
  peerUrl?: string;
}): Promise<void> {
  if (!opts.groupId?.trim()) { console.error('Error: --group-id is required'); process.exit(1); }
  if (!opts.name?.trim()) { console.error('Error: --name is required'); process.exit(1); }
  if (!opts.tenantId?.trim()) { console.error('Error: --tenant-id is required'); process.exit(1); }

  const validTiers: TrustTier[] = ['observer', 'participant', 'trusted'];
  const tier = opts.trustTier as TrustTier | undefined;
  if (tier && !validTiers.includes(tier)) {
    console.error(`Error: --trust-tier must be one of: ${validTiers.join(', ')}`);
    process.exit(1);
  }

  const org = await addOrg(
    opts.groupId.trim(),
    {
      name: opts.name.trim(),
      tenantId: opts.tenantId.trim(),
      groupFilter: opts.groupFilter?.trim() || undefined,
      trustTier: tier,
      peerUrl: opts.peerUrl?.trim() || undefined,
    },
    'cli',
  );

  console.log(`Added org to group ${opts.groupId}:`);
  console.log(`  id:         ${org.id}`);
  console.log(`  name:       ${org.name}`);
  console.log(`  tenantId:   ${org.tenantId}`);
  console.log(`  trustTier:  ${org.trustTier}`);
  if (org.groupFilter) console.log(`  groupFilter: ${org.groupFilter}`);
  if (org.peerUrl) console.log(`  peerUrl:     ${org.peerUrl}`);
}

// ── groupRemoveOrgCommand ─────────────────────────────────────────────────────

export async function groupRemoveOrgCommand(opts: { groupId: string; orgId: string }): Promise<void> {
  if (!opts.groupId?.trim()) { console.error('Error: --group-id is required'); process.exit(1); }
  if (!opts.orgId?.trim()) { console.error('Error: --org-id is required'); process.exit(1); }

  try {
    await removeOrg(opts.groupId.trim(), opts.orgId.trim(), 'cli');
    console.log(`Removed org ${opts.orgId} from group ${opts.groupId} (and all its sharing policies).`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ── groupSharingCommand ───────────────────────────────────────────────────────

export async function groupSharingCommand(opts: { fromOrg: string; toOrg: string; mode: string }): Promise<void> {
  if (!opts.fromOrg?.trim()) { console.error('Error: --from-org is required'); process.exit(1); }
  if (!opts.toOrg?.trim()) { console.error('Error: --to-org is required'); process.exit(1); }

  const validModes: SharingMode[] = ['none', 'read', 'bidirectional'];
  if (!validModes.includes(opts.mode as SharingMode)) {
    console.error(`Error: --mode must be one of: ${validModes.join(', ')}`);
    process.exit(1);
  }

  try {
    const policy = await updateSharing(
      opts.fromOrg.trim(),
      opts.toOrg.trim(),
      opts.mode as SharingMode,
      'cli',
    );
    if (policy.mode === 'none') {
      console.log(`Sharing policy removed: ${opts.fromOrg} ↔ ${opts.toOrg}`);
    } else if (policy.mode === 'bidirectional') {
      console.log(`Sharing set to bidirectional: ${opts.fromOrg} ↔ ${opts.toOrg}`);
    } else {
      console.log(`Sharing set to read: ${opts.fromOrg} → ${opts.toOrg}`);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ── groupStatusCommand ────────────────────────────────────────────────────────

export async function groupStatusCommand(opts: { groupId: string }): Promise<void> {
  if (!opts.groupId?.trim()) { console.error('Error: --group-id is required'); process.exit(1); }

  const store = await loadGroupStore();
  const group = findGroup(store, opts.groupId.trim());

  if (!group) {
    console.error(`Error: No corporate group with id "${opts.groupId}"`);
    process.exit(1);
  }

  const orgs = findOrgsByGroup(store, group.id);

  console.log(`Group: ${group.name} (${orgs.length} org${orgs.length === 1 ? '' : 's'})`);
  console.log(`Id:    ${group.id}`);
  console.log(`Created: ${group.createdAt} by ${group.createdBy}`);
  console.log(`\nOrgs (${orgs.length}):`);

  if (orgs.length === 0) {
    console.log('  None.');
    return;
  }

  // Build display labels: "Org Name [trustTier]"
  const orgLabels = orgs.map(o => `${o.name} [${o.trustTier}]`);
  const col1 = Math.max(6, ...orgLabels.map(l => l.length));
  console.log(`  ${'Org'.padEnd(col1)}  Id`);
  console.log(`  ${'-'.repeat(col1)}  ${'-'.repeat(36)}`);
  for (let i = 0; i < orgs.length; i++) {
    const peerSuffix = orgs[i].peerUrl ? ` → ${orgs[i].peerUrl}` : '';
    console.log(`  ${orgLabels[i].padEnd(col1)}  ${orgs[i].id}${peerSuffix}`);
  }

  // Sharing matrix as ASCII table with ⇄ / → / · symbols
  console.log(`\nSharing matrix:`);
  // Column headers: truncate org names to fit
  const colW = Math.max(3, ...orgs.map(o => Math.min(o.name.length, 14)));
  const rowLabelW = col1;
  const colHeaders = orgs.map(o => o.name.substring(0, colW).padEnd(colW));
  console.log(`  ${''.padEnd(rowLabelW)}  ${colHeaders.join('  ')}`);
  console.log(`  ${'-'.repeat(rowLabelW)}  ${orgs.map(() => '-'.repeat(colW)).join('  ')}`);

  for (let ri = 0; ri < orgs.length; ri++) {
    const fromOrg = orgs[ri];
    const cells = orgs.map((toOrg, ci) => {
      if (ri === ci) return '·'.padEnd(colW);
      const fwd = findSharingPolicy(store, fromOrg.id, toOrg.id);
      const rev = findSharingPolicy(store, toOrg.id, fromOrg.id);
      const fwdMode = fwd?.mode ?? 'none';
      const revMode = rev?.mode ?? 'none';
      let symbol: string;
      if (fwdMode === 'bidirectional' || revMode === 'bidirectional') {
        symbol = '⇄';
      } else if (fwdMode === 'read') {
        symbol = '→';
      } else {
        symbol = '·';
      }
      return symbol.padEnd(colW);
    });
    console.log(`  ${orgLabels[ri].padEnd(rowLabelW)}  ${cells.join('  ')}`);
  }

  // Summary of active policies
  const activePolicies = store.sharingPolicies.filter(
    p => orgs.some(o => o.id === p.fromOrgId) && orgs.some(o => o.id === p.toOrgId)
  );

  if (activePolicies.length > 0) {
    console.log(`\nActive policies:`);
    for (const p of activePolicies) {
      const from = orgs.find(o => o.id === p.fromOrgId)?.name ?? p.fromOrgId;
      const to = orgs.find(o => o.id === p.toOrgId)?.name ?? p.toOrgId;
      console.log(`  ${from} → ${to}: ${p.mode}`);
    }
  }
}

// ── Invitation token helpers ──────────────────────────────────────────────────

const INVITE_TOKEN_TTL_S = 86400; // 24 hours
const INVITE_TOKEN_ISSUER = 'ctxhub-invite';

interface InvitePayload {
  iss: string;
  type: 'group-invite';
  groupId: string;
  orgName: string;
  iat: number;
  exp: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signInviteToken(headerDotPayload: string, jwtSecret: string): string {
  const secret = Buffer.from(jwtSecret, 'hex');
  return base64url(createHmac('sha256', secret).update(headerDotPayload).digest());
}

function issueInviteToken(groupId: string, orgName: string, jwtSecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims: InvitePayload = {
    iss: INVITE_TOKEN_ISSUER,
    type: 'group-invite',
    groupId,
    orgName,
    iat: now,
    exp: now + INVITE_TOKEN_TTL_S,
  };
  const payload = base64url(Buffer.from(JSON.stringify(claims)));
  const sig = signInviteToken(`${header}.${payload}`, jwtSecret);
  return `${header}.${payload}.${sig}`;
}

function verifyInviteToken(token: string, jwtSecret: string): InvitePayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed invitation token');
  const [header, payload, signature] = parts as [string, string, string];
  const expected = signInviteToken(`${header}.${payload}`, jwtSecret);
  if (signature !== expected) throw new Error('Invalid invitation token signature');
  const claims = JSON.parse(base64urlDecode(payload).toString('utf-8')) as InvitePayload;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) throw new Error('Invitation token has expired');
  if (claims.iss !== INVITE_TOKEN_ISSUER) throw new Error('Invalid invitation token issuer');
  if (claims.type !== 'group-invite') throw new Error('Token is not a group invitation');
  return claims;
}

// ── groupInviteCommand ────────────────────────────────────────────────────────

export async function groupInviteCommand(opts: { groupId: string; orgName: string }): Promise<void> {
  if (!opts.groupId?.trim()) { console.error('Error: --group-id is required'); process.exit(1); }
  if (!opts.orgName?.trim()) { console.error('Error: --org-name is required'); process.exit(1); }

  const authConfig = await loadAuthConfig();
  if (!authConfig?.jwtSecret) {
    console.error('Error: Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  const store = await loadGroupStore();
  const group = findGroup(store, opts.groupId.trim());
  if (!group) {
    console.error(`Error: No corporate group with id "${opts.groupId}"`);
    process.exit(1);
  }

  const token = issueInviteToken(opts.groupId.trim(), opts.orgName.trim(), authConfig.jwtSecret);
  const expiresAt = new Date((Math.floor(Date.now() / 1000) + INVITE_TOKEN_TTL_S) * 1000).toISOString();

  console.log(`Invitation token for group "${group.name}" (expires: ${expiresAt}):`);
  console.log('');
  console.log(token);
  console.log('');
  console.log('Share this token with the org admin. They can join with:');
  console.log(`  ctxhub group join ${token}`);
}

// ── groupJoinCommand ──────────────────────────────────────────────────────────

export async function groupJoinCommand(token: string): Promise<void> {
  if (!token?.trim()) {
    console.error('Error: invitation token argument is required');
    process.exit(1);
  }

  const authConfig = await loadAuthConfig();
  if (!authConfig?.jwtSecret) {
    console.error('Error: Auth not configured. Run: ctxhub auth configure');
    process.exit(1);
  }

  let claims: InvitePayload;
  try {
    claims = verifyInviteToken(token.trim(), authConfig.jwtSecret);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const tokens = await loadTokens();
  if (!tokens) {
    console.error('Error: Not logged in. Run: ctxhub login');
    process.exit(1);
  }

  const tenantId = tokens.user.sub.split('.')[0] ?? tokens.user.sub;
  // Prefer to use the tenantId from the ctxhub JWT if available by decoding it
  // Fall back to using the user's sub as a reasonable tenant identifier
  let resolvedTenantId = tenantId;
  try {
    const parts = tokens.ctxhubToken.token.split('.');
    if (parts.length === 3) {
      const payloadJson = Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf-8');
      const payload = JSON.parse(payloadJson) as { tenantId?: string };
      if (payload.tenantId) resolvedTenantId = payload.tenantId;
    }
  } catch {
    // fall through — use the sub-derived value
  }

  const store = await loadGroupStore();
  const group = findGroup(store, claims.groupId);
  if (!group) {
    console.error(`Error: Invited group "${claims.groupId}" does not exist on this instance`);
    process.exit(1);
  }

  const org = await addOrg(
    claims.groupId,
    {
      name: claims.orgName,
      tenantId: resolvedTenantId,
    },
    tokens.user.sub,
  );

  console.log(`Joined group "${group.name}" successfully.`);
  console.log(`  Org id:       ${org.id}`);
  console.log(`  Org name:     ${org.name}`);
  console.log(`  Tenant ID:    ${org.tenantId}`);
  console.log(`  Trust tier:   ${org.trustTier}`);
}

// ── groupHeartbeatCommand ─────────────────────────────────────────────────────

export async function groupHeartbeatCommand(): Promise<void> {
  // Read peerUrl from environment variable or workspace config's service section
  let resolvedPeerUrl: string | undefined = process.env['CTXHUB_PEER_URL'];

  if (!resolvedPeerUrl) {
    try {
      const { loadWorkspaceConfig } = await import('../config/config.js');
      const { config } = await loadWorkspaceConfig();
      resolvedPeerUrl = config.service?.peerUrl;
    } catch {
      // workspace config not available
    }
  }

  if (!resolvedPeerUrl) {
    // Also check the service config file
    try {
      const { loadServiceConfig } = await import('./service.js');
      const svcConfig = await loadServiceConfig();
      resolvedPeerUrl = svcConfig.peerUrl;
    } catch {
      // service config not available
    }
  }

  if (!resolvedPeerUrl) {
    console.error('Error: No peerUrl configured. Set service.peerUrl in ctxhub.yaml or CTXHUB_PEER_URL env var.');
    console.error('  To configure: ctxhub service set-peer-url <url>');
    process.exit(1);
  }

  const orgId = process.env['CTXHUB_ORG_ID'];
  const groupId = process.env['CTXHUB_GROUP_ID'];
  if (!orgId || !groupId) {
    console.error('Error: CTXHUB_ORG_ID and CTXHUB_GROUP_ID environment variables are required for heartbeat.');
    process.exit(1);
  }

  const { DEFAULT_SERVICE_PORT } = await import('../service/server.js');
  const port = process.env['CTXHUB_PORT'] ?? String(DEFAULT_SERVICE_PORT);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/peers/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, peerUrl: resolvedPeerUrl, groupId }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (data.ok) {
      console.log(`Heartbeat sent: org=${orgId} peerUrl=${resolvedPeerUrl}`);
    } else {
      console.error(`Heartbeat failed: ${data.error ?? 'unknown error'}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Failed to reach ctxhub service: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
