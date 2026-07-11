// Corporate Groups — shared knowledge topology for multiple legal entities under one corporate parent.
// See: docs/architecture/corporate_groups.md

export type SharingMode = 'none' | 'read' | 'bidirectional';
export type TrustTier = 'observer' | 'participant' | 'trusted';

export interface CorporateGroup {
  id: string;           // crypto.randomUUID()
  name: string;         // e.g. "VodafoneThree UK"
  createdAt: string;    // ISO 8601
  createdBy: string;    // sub of creating user
}

export interface Org {
  id: string;
  groupId: string;
  name: string;                  // e.g. "Vodafone UK Engineering"
  tenantId: string;              // Entra tenant ID for this org
  groupFilter?: string;          // optional Entra group object ID to restrict membership
  trustTier: TrustTier;          // observer | participant | trusted
  peerUrl?: string;              // optional base URL of this org's ctxhub service for cross-org fan-out
  lastSeen?: string;             // ISO timestamp of last heartbeat
  registeredAt?: string;         // when peerUrl was first registered
  addedAt: string;               // ISO 8601
  addedBy: string;               // sub
  identityConfig?: {
    roleOverrides?: Record<string, string>; // sub → role, per-org role override
    groupRoles?: Record<string, string>;    // Entra group ID → ctxhub role (per-org)
    defaultRole?: string;                   // fallback role for this org (overrides global)
  };
}

export interface SharingPolicy {
  fromOrgId: string;
  toOrgId: string;
  mode: SharingMode;             // what fromOrg can do to toOrg's knowledge
  updatedAt: string;
  updatedBy: string;
}

export interface GroupStore {
  version: 1;
  groups: CorporateGroup[];
  orgs: Org[];
  sharingPolicies: SharingPolicy[];
}
