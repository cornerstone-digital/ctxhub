import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateLicence, hasFeature, loadLicence, LICENCE_HMAC_KEY } from './licence.js';
import type { LicenceKey } from './types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function computeSignature(key: Omit<LicenceKey, 'signature'>): string {
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

function makeValidLicence(overrides: Partial<LicenceKey> = {}): LicenceKey {
  const base: Omit<LicenceKey, 'signature'> = {
    licenceId: 'lic-test-001',
    orgName: 'Test Corp',
    seats: 50,
    features: ['enterprise', 'audit', 'cloud-sync'],
    validFrom: '2024-01-01T00:00:00Z',
    validUntil: '2099-12-31T23:59:59Z',
    ...overrides,
  };
  const sig = overrides.signature ?? computeSignature(base);
  return { ...base, signature: sig };
}

// ── validateLicence ───────────────────────────────────────────────────────────

describe('validateLicence', () => {
  it('returns valid for a correct licence', () => {
    const key = makeValidLicence();
    const result = validateLicence(key);
    assert.equal(result.status, 'valid');
    assert.ok(result.licence !== undefined);
  });

  it('returns expired for past validUntil', () => {
    const base = {
      licenceId: 'lic-expired',
      orgName: 'Test Corp',
      seats: 10,
      features: ['enterprise'],
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: '2021-01-01T00:00:00Z',
    };
    const key: LicenceKey = { ...base, signature: computeSignature(base) };
    const result = validateLicence(key);
    assert.equal(result.status, 'expired');
    assert.ok(result.reason !== undefined && result.reason.toLowerCase().includes('expir'));
  });

  it('returns invalid for wrong HMAC signature', () => {
    const key = makeValidLicence({ signature: 'bad-signature-value-that-is-definitely-wrong' });
    const result = validateLicence(key);
    assert.equal(result.status, 'invalid');
    assert.ok(result.reason !== undefined && result.reason.toLowerCase().includes('signature'));
  });

  it('returns invalid for invalid validUntil date', () => {
    const key = makeValidLicence({ validUntil: 'not-a-date', signature: 'irrelevant' });
    const result = validateLicence(key);
    assert.equal(result.status, 'invalid');
  });
});

// ── hasFeature ────────────────────────────────────────────────────────────────

describe('hasFeature', () => {
  it('returns true for a feature present in a valid licence', () => {
    const key = makeValidLicence({ features: ['enterprise', 'scim'] });
    const validation = validateLicence(key);
    assert.ok(hasFeature(validation, 'enterprise'));
    assert.ok(hasFeature(validation, 'scim'));
  });

  it('returns false for a feature not in the licence', () => {
    const key = makeValidLicence({ features: ['enterprise'] });
    const validation = validateLicence(key);
    assert.equal(hasFeature(validation, 'nonexistent-feature'), false);
  });

  it('returns false for an invalid licence', () => {
    const key = makeValidLicence({ signature: 'bad' });
    const validation = validateLicence(key);
    assert.equal(hasFeature(validation, 'enterprise'), false);
  });
});

// ── loadLicence ───────────────────────────────────────────────────────────────

describe('loadLicence', () => {
  it('returns null when no licence file exists at specified path', async () => {
    const prev = process.env['CTXHUB_LICENCE_FILE'];
    process.env['CTXHUB_LICENCE_FILE'] = '/tmp/ctxhub-nonexistent-licence-test-99999.json';
    try {
      const result = await loadLicence();
      assert.equal(result, null);
    } finally {
      if (prev === undefined) {
        delete process.env['CTXHUB_LICENCE_FILE'];
      } else {
        process.env['CTXHUB_LICENCE_FILE'] = prev;
      }
    }
  });
});
