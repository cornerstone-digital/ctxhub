import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependencies } from './resolver.js';
import type { BlueprintManifest, BlueprintStore } from './types.js';

function makeManifest(overrides: Partial<BlueprintManifest> = {}): BlueprintManifest {
  return {
    name: 'my-blueprint',
    version: '1.0.0',
    description: 'Test blueprint',
    ...overrides,
  };
}

function makeStore(installed: Array<{ name: string; version: string; path: string }> = []): BlueprintStore {
  return {
    version: 1,
    installed: installed.map(({ name, version, path }) => ({
      name,
      version,
      path,
      installedAt: new Date().toISOString(),
    })),
  };
}

describe('resolveDependencies', () => {
  it('returns empty result when manifest has no dependencies', async () => {
    const manifest = makeManifest();
    const store = makeStore();
    const result = await resolveDependencies(manifest, store);
    assert.equal(result.resolved.length, 0);
    assert.equal(result.missing.length, 0);
    assert.equal(result.order.length, 0);
  });

  it('marks installed dep as resolved', async () => {
    const manifest = makeManifest({
      dependencies: [{ name: 'shared-base', version: '1.0.0' }],
    });
    const store = makeStore([{ name: 'shared-base', version: '1.0.0', path: '/tmp/blueprints/shared-base' }]);
    const result = await resolveDependencies(manifest, store);
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0]!.name, 'shared-base');
    assert.equal(result.resolved[0]!.path, '/tmp/blueprints/shared-base');
    assert.equal(result.missing.length, 0);
    assert.ok(result.order.includes('shared-base'));
    // Dependency comes before the dependent (my-blueprint) in install order
    assert.ok(result.order.indexOf('shared-base') < result.order.indexOf('my-blueprint'));
  });

  it('resolves dep from local path when not installed', async () => {
    const manifest = makeManifest({
      dependencies: [{ name: 'shared-base', path: './shared-base-1.0.0.ctxblueprint' }],
    });
    const store = makeStore();
    const result = await resolveDependencies(manifest, store);
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0]!.name, 'shared-base');
    assert.equal(result.resolved[0]!.path, './shared-base-1.0.0.ctxblueprint');
    assert.equal(result.missing.length, 0);
  });

  it('marks dep as missing when not installed and no path', async () => {
    const manifest = makeManifest({
      dependencies: [{ name: 'missing-dep' }],
    });
    const store = makeStore();
    const result = await resolveDependencies(manifest, store);
    assert.equal(result.resolved.length, 0);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]!.name, 'missing-dep');
    assert.ok(result.missing[0]!.reason.includes('not installed'));
  });

  it('detects circular dependency when dep has same name as root manifest', async () => {
    const manifest = makeManifest({
      name: 'circular-a',
      dependencies: [{ name: 'circular-a' }],
    });
    const store = makeStore();
    const result = await resolveDependencies(manifest, store);
    assert.ok(result.missing.some(m => m.reason === 'circular dependency'));
  });

  it('handles multiple deps: installed + path-based + missing', async () => {
    const manifest = makeManifest({
      dependencies: [
        { name: 'dep-a' },
        { name: 'dep-b', path: './dep-b.ctxblueprint' },
        { name: 'dep-c', version: '2.0.0' },
      ],
    });
    const store = makeStore([{ name: 'dep-a', version: '1.0.0', path: '/tmp/dep-a' }]);
    const result = await resolveDependencies(manifest, store);
    // dep-a (installed) and dep-b (local path) are resolved
    assert.equal(result.resolved.length, 2);
    // dep-c has no installation and no path
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]!.name, 'dep-c');
  });
});
