import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { initConfig, loadConfig } from '../config/config.js';
import { buildDoctorChecks } from './doctorChecks.js';

// Regression test for the air-gapped deployment fix: `ctxhub doctor`'s version check must
// never attempt an outbound call to the public npm registry when CTXHUB_OFFLINE is set --
// a security team monitoring egress on an air-gapped network sees the attempt regardless of
// whether it times out gracefully, so this has to skip the fetch entirely, not just handle
// its failure well.
test('doctor version check skips the npm registry call when CTXHUB_OFFLINE is set', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-doctor-offline-'));
  const previous = process.env.CTXHUB_OFFLINE;
  try {
    await initConfig('doctor-offline-ws', cwd);
    const config = await loadConfig(cwd);
    const configPath = path.join(cwd, '.ctxhub', 'config.yaml');

    process.env.CTXHUB_OFFLINE = 'true';
    const checks = buildDoctorChecks(config, configPath, cwd);
    const versionCheck = checks.find(c => c.id === 'version');
    assert.ok(versionCheck, 'version check should exist');

    const results = await versionCheck!.run();
    assert.equal(results.length, 1);
    assert.equal(results[0]!.status, 'ok');
    assert.match(results[0]!.message, /CTXHUB_OFFLINE/);
  } finally {
    if (previous === undefined) delete process.env.CTXHUB_OFFLINE;
    else process.env.CTXHUB_OFFLINE = previous;
    await rm(cwd, { recursive: true, force: true });
  }
});
