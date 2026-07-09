import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPackageVersion } from './version.js';

test('getPackageVersion reads the version from this package\'s package.json', () => {
  assert.match(getPackageVersion(), /^\d+\.\d+\.\d+/);
});
