// Auth types for Enterprise Foundations — EF-1 / EF-2
// See: docs/ctxhub_identity_model.docx, docs/trust_model.md

export interface OidcConfig {
  provider?: 'entra' | 'okta' | 'google' | 'generic'; // default: 'entra' for backward compat
  tenantId?: string;      // Entra only (keep for backward compat; required when provider='entra')
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  issuerUrl?: string;     // for 'generic'/'okta'/'google' — full OIDC issuer URL
}

export interface MachineToken {
  id: string;           // UUID
  name: string;         // human label, e.g. "github-actions"
  hashedToken: string;  // scrypt hash of the raw ctxm_ token
  roles: string[];      // e.g. ['machine']
  createdAt: string;    // ISO
  expiresAt: string;    // ISO (1 year default)
  lastUsedAt?: string;  // ISO, updated on each use
  revokedAt?: string;   // ISO, set on revoke
}

export interface MachineTokenStore {
  version: 1;
  tokens: MachineToken[];
}

/**
 * Role mapping configuration.
 *
 * Resolution order at login:
 *   1. If the user's Entra object ID (sub/oid) is in ownerSubs → role: owner
 *   2. For each Entra group ID in the ID token's `groups` claim, check groupRoles
 *      and collect the mapped ctxhub roles.
 *   3. If no group match → defaultRole (default: 'member')
 *
 * Groups appear in the ID token only when "groupMembershipClaims" is set to
 * "SecurityGroup" in the Entra app manifest (Token configuration → Add groups claim).
 */
export interface RoleMap {
  /** Entra object IDs (oid/sub) that are unconditionally granted the owner role */
  ownerSubs?: string[];
  /** Entra security group object ID → ctxhub role */
  groupRoles?: Record<string, string>;
  /** Fallback role when no group matches (default: 'member') */
  defaultRole?: string;
}

export interface AuthConfig {
  version: 1;
  oidc: OidcConfig;
  /** hex-encoded 32-byte HMAC-SHA256 signing key for ctxhub-issued JWTs */
  jwtSecret: string;
  /** Optional role mapping — omitted means everyone gets 'member' */
  roleMap?: RoleMap;
}

export interface StoredEntraTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: string; // ISO 8601
}

export interface StoredCtxhubToken {
  token: string;
  expiresAt: string; // ISO 8601
}

export interface StoredUser {
  sub: string;   // Entra ID object ID
  email: string;
  name: string;
}

export interface StoredTokens {
  version: 1;
  entraTokens: StoredEntraTokens;
  ctxhubToken: StoredCtxhubToken;
  user: StoredUser;
}

/** A principal is an authenticated identity with ctxhub roles attached */
export interface Principal {
  sub: string;
  email: string;
  name: string;
  /** ctxhub roles: owner | admin | member | reader | machine */
  roles: string[];
  /** Entra ID tenant ID (tid claim) — identifies the user's home directory */
  tenantId?: string;
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface EntraTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface CtxhubJwtPayload {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  iss: string;
  iat: number;
  exp: number;
  tenantId?: string;
}
