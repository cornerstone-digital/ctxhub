/**
 * Enterprise usage reporting — code-only piece of "Enterprise billing" (ROADMAP.md).
 *
 * Pricing, purchase-order/invoice flow, and what actually gets billed for are business
 * decisions this codebase can't make. What it *can* do is answer, from data it already
 * has on disk, "how much of this instance is actually in use" — seats and activity a
 * finance/procurement conversation would need. Deliberately not wired to any payment
 * or invoicing system.
 */
import { loadScimStore } from '../scim/store.js';
import { loadMachineTokenStore } from '../auth/machineTokenStore.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadLicence, validateLicence } from '../licence/licence.js';
import { queryAuditLog } from '../events/auditLog.js';

const DEFAULT_PERIOD_DAYS = 30;

export interface SeatUsage {
  /** Active users provisioned via SCIM (`active: true`) — the clearest seat signal when an IdP drives provisioning. */
  scimActiveUsers: number;
  scimInactiveUsers: number;
  /** Distinct principals (JWT `sub`) granted a workspace-level role override, across all workspaces. */
  workspaceMembersWithRoleOverrides: number;
  /**
   * SCIM `userName` and workspace `memberOverrides` keys live in different identifier spaces
   * (email vs. JWT sub) and this codebase has no join between them today, so the two counts
   * above are NOT deduplicated against each other. Report both; don't sum them into a single
   * "seats" figure without reconciling identifiers first.
   */
  note: string;
  licensedSeats?: number;
  licenceStatus?: 'valid' | 'expired' | 'invalid' | 'missing';
}

export interface ActivityUsage {
  /** ISO start of the reporting window. */
  since: string;
  /** ISO end of the reporting window (now). */
  until: string;
  workspaceCount: number;
  activeMachineTokens: number;
  /** Total audit-log events in the window. */
  totalEvents: number;
  /** Event counts bucketed by top-level type prefix, e.g. `auth`, `captain`, `sync`, `scim`, `blueprint`. */
  eventsByCategory: Record<string, number>;
}

export interface UsageReport {
  generatedAt: string;
  seats: SeatUsage;
  activity: ActivityUsage;
}

function eventCategory(type: string): string {
  const dot = type.indexOf('.');
  return dot === -1 ? type : type.slice(0, dot);
}

function isMachineTokenActive(token: { expiresAt: string; revokedAt?: string }, now: Date): boolean {
  if (token.revokedAt) return false;
  return new Date(token.expiresAt) > now;
}

export async function computeUsageReport(opts: { since?: string } = {}): Promise<UsageReport> {
  const now = new Date();
  const since = opts.since ?? new Date(now.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [scimStore, machineTokenStore, workspaces, licence, auditEntries] = await Promise.all([
    loadScimStore(),
    loadMachineTokenStore(),
    listWorkspaces(),
    loadLicence(),
    queryAuditLog({ from: since, to: now.toISOString(), limit: Number.MAX_SAFE_INTEGER }),
  ]);

  const scimActiveUsers = scimStore.users.filter(u => u.active).length;
  const scimInactiveUsers = scimStore.users.length - scimActiveUsers;

  const overrideSubs = new Set<string>();
  for (const ws of workspaces) {
    if (!ws.exists) continue;
    try {
      const { config } = await loadWorkspaceConfig(ws.path);
      for (const sub of Object.keys(config.workspace.memberOverrides ?? {})) {
        overrideSubs.add(sub);
      }
    } catch {
      // Skip workspaces whose config can't be read (e.g. mid-migration) rather than fail the whole report.
    }
  }

  const activeMachineTokens = machineTokenStore.tokens.filter(t => isMachineTokenActive(t, now)).length;

  const eventsByCategory: Record<string, number> = {};
  for (const entry of auditEntries) {
    const category = eventCategory(entry.type);
    eventsByCategory[category] = (eventsByCategory[category] ?? 0) + 1;
  }

  const licenceValidation = licence ? validateLicence(licence) : undefined;

  return {
    generatedAt: now.toISOString(),
    seats: {
      scimActiveUsers,
      scimInactiveUsers,
      workspaceMembersWithRoleOverrides: overrideSubs.size,
      note:
        'scimActiveUsers and workspaceMembersWithRoleOverrides are not deduplicated against ' +
        'each other (different identifier spaces: SCIM userName/email vs. JWT sub).',
      ...(licenceValidation ? { licensedSeats: licenceValidation.licence?.seats, licenceStatus: licenceValidation.status } : {}),
    },
    activity: {
      since,
      until: now.toISOString(),
      workspaceCount: workspaces.filter(w => w.exists).length,
      activeMachineTokens,
      totalEvents: auditEntries.length,
      eventsByCategory,
    },
  };
}
