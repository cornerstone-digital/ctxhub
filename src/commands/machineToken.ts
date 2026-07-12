import { randomUUID } from 'node:crypto';
import {
  loadMachineTokenStore,
  saveMachineTokenStore,
  generateRawToken,
  hashToken,
} from '../auth/machineTokenStore.js';
import { eventBus } from '../events/eventBus.js';

export interface MachineTokenCreateOptions {
  name: string;
  role?: string;
  expiresIn?: string; // days
}

export async function machineTokenCreateCommand(opts: MachineTokenCreateOptions): Promise<void> {
  const store = await loadMachineTokenStore();

  const role = opts.role ?? 'machine';
  const expiresInDays = opts.expiresIn ? parseInt(opts.expiresIn, 10) : 365;

  if (isNaN(expiresInDays) || expiresInDays <= 0) {
    console.error('Invalid --expires-in value. Must be a positive number of days.');
    process.exit(1);
  }

  const rawToken = generateRawToken();
  const hashedToken = await hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  const token = {
    id: randomUUID(),
    name: opts.name,
    hashedToken,
    roles: [role],
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  store.tokens.push(token);
  await saveMachineTokenStore(store);

  try {
    eventBus.publish({
      type: 'auth.machine_token_created',
      tokenId: token.id,
      name: token.name,
      roles: token.roles,
    });
  } catch { /* audit failure must not block token creation */ }

  console.log('');
  console.log('✓ Machine token created');
  console.log('');
  console.log('  ID:      ', token.id);
  console.log('  Name:    ', token.name);
  console.log('  Roles:   ', token.roles.join(', '));
  console.log('  Expires: ', expiresAt.toLocaleString());
  console.log('');
  console.log('  ⚠  Save this token now — it cannot be retrieved again:');
  console.log('');
  console.log(' ', rawToken);
  console.log('');
}

export async function machineTokenListCommand(): Promise<void> {
  const store = await loadMachineTokenStore();
  const now = new Date();

  if (store.tokens.length === 0) {
    console.log('No machine tokens. Create one with: ctxhub machine-token create --name <name>');
    return;
  }

  console.log('');
  console.log(
    'ID (first 8)  Name                          Roles           Created              Expires              Last Used            Status'
  );
  console.log('-'.repeat(145));

  for (const token of store.tokens) {
    const shortId = token.id.substring(0, 8);
    const created = new Date(token.createdAt).toLocaleDateString();
    const expires = new Date(token.expiresAt).toLocaleDateString();
    const lastUsed = token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : 'never';

    let status = 'active';
    if (token.revokedAt) {
      status = 'revoked';
    } else if (new Date(token.expiresAt) < now) {
      status = 'expired';
    }

    const name = token.name.substring(0, 30).padEnd(30);
    const roles = token.roles.join(', ').substring(0, 15).padEnd(15);

    console.log(
      `${shortId}      ${name}  ${roles}  ${created.padEnd(20)} ${expires.padEnd(20)} ${lastUsed.padEnd(20)} ${status}`
    );
  }
  console.log('');
}

export async function machineTokenRevokeCommand(id: string): Promise<void> {
  const store = await loadMachineTokenStore();

  // Find by prefix match (full id or first 8 chars)
  const token = store.tokens.find(t => t.id === id || t.id.startsWith(id));

  if (!token) {
    console.error(`No machine token found with id: ${id}`);
    process.exit(1);
  }

  if (token.revokedAt) {
    console.log(`Token "${token.name}" (${token.id.substring(0, 8)}) is already revoked.`);
    return;
  }

  token.revokedAt = new Date().toISOString();
  await saveMachineTokenStore(store);

  try {
    eventBus.publish({
      type: 'auth.machine_token_revoked',
      tokenId: token.id,
      name: token.name,
    });
  } catch { /* audit failure must not block revocation */ }

  console.log(`✓ Revoked machine token: ${token.name} (${token.id.substring(0, 8)})`);
}
