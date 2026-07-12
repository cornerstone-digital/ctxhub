/**
 * Air-gapped licence key types for ctxhub Enterprise.
 *
 * For air-gapped enterprise deployments, a local licence file is validated
 * instead of calling ctxhub infrastructure. This allows fully offline operation.
 */

export interface LicenceKey {
  licenceId: string;
  orgName: string;
  seats: number;            // max active users
  features: string[];       // e.g. ['enterprise', 'scim', 'audit', 'cloud-sync']
  validFrom: string;        // ISO
  validUntil: string;       // ISO
  signature: string;        // HMAC-SHA256 of the other fields, signed with the ctxhub licence key
}

export type LicenceStatus = 'valid' | 'expired' | 'invalid' | 'missing';

export interface LicenceValidation {
  status: LicenceStatus;
  licence?: LicenceKey;
  reason?: string;
}
