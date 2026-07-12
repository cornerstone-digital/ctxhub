import path from 'node:path';
import { createHmac } from 'node:crypto';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText } from '../utils/fs.js';
import type { LicenceKey, LicenceValidation } from './types.js';

/**
 * The HMAC key used to verify licence signatures.
 * In production, this would be a secure embedded key; for now we use a well-known string.
 */
const LICENCE_HMAC_KEY = 'ctxhub-licence-public-key-v1';

// ── File path resolution ──────────────────────────────────────────────────────

export function getLicenceFilePath(): string {
  // Check env var first
  const envPath = process.env['CTXHUB_LICENCE_FILE'];
  if (envPath) return envPath;

  // Then ~/.ctxhub/licence.json
  const homePath = path.join(getCtxhubHome(), 'licence.json');
  return homePath;
}

function getSystemLicencePath(): string {
  return '/etc/ctxhub/licence.json';
}

// ── Load licence ──────────────────────────────────────────────────────────────

export async function loadLicence(): Promise<LicenceKey | null> {
  // Check env-specified path or ~/.ctxhub/licence.json
  const primaryPath = getLicenceFilePath();
  if (await pathExists(primaryPath)) {
    try {
      const raw = await readText(primaryPath);
      return JSON.parse(raw) as LicenceKey;
    } catch {
      return null;
    }
  }

  // Fall back to /etc/ctxhub/licence.json
  const systemPath = getSystemLicencePath();
  if (await pathExists(systemPath)) {
    try {
      const raw = await readText(systemPath);
      return JSON.parse(raw) as LicenceKey;
    } catch {
      return null;
    }
  }

  return null;
}

// ── Validate licence ──────────────────────────────────────────────────────────

/**
 * Compute the expected HMAC-SHA256 signature for a licence key.
 * The signature covers: licenceId, orgName, seats, features (sorted, joined),
 * validFrom, validUntil.
 */
function computeSignature(key: LicenceKey): string {
  const payload = [
    key.licenceId,
    key.orgName,
    String(key.seats),
    [...key.features].sort().join(','),
    key.validFrom,
    key.validUntil,
  ].join('|');

  return createHmac('sha256', LICENCE_HMAC_KEY).update(payload).digest('hex');
}

export function validateLicence(key: LicenceKey): LicenceValidation {
  const now = new Date();

  // Check date validity
  const validFrom = new Date(key.validFrom);
  const validUntil = new Date(key.validUntil);

  if (isNaN(validUntil.getTime())) {
    return { status: 'invalid', licence: key, reason: 'Invalid validUntil date' };
  }

  if (now > validUntil) {
    return { status: 'expired', licence: key, reason: `Licence expired at ${key.validUntil}` };
  }

  if (!isNaN(validFrom.getTime()) && now < validFrom) {
    return { status: 'invalid', licence: key, reason: `Licence not yet valid (validFrom: ${key.validFrom})` };
  }

  // Verify HMAC signature
  const expected = computeSignature(key);
  if (key.signature !== expected) {
    return { status: 'invalid', licence: key, reason: 'Signature verification failed' };
  }

  return { status: 'valid', licence: key };
}

export function hasFeature(validation: LicenceValidation, feature: string): boolean {
  if (validation.status !== 'valid') return false;
  if (!validation.licence) return false;
  return validation.licence.features.includes(feature);
}

// ── Export HMAC key for testing ───────────────────────────────────────────────

export { LICENCE_HMAC_KEY };
