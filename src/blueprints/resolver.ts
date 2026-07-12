import type { BlueprintManifest } from './types.js';
import type { BlueprintStore } from './types.js';

export interface ResolutionResult {
  resolved: Array<{ name: string; version: string; path: string }>;
  missing: Array<{ name: string; reason: string }>;
  order: string[];  // topological install order (dependencies before dependents)
}

/**
 * Resolve the dependency graph for a blueprint manifest.
 *
 * - Checks if each dependency is already installed in the store
 * - If installed: includes in resolved with its installed path
 * - If not installed but has a local path: marks as resolvable from local path
 * - If not installed and no path: marks as missing
 * - Detects circular dependencies
 * - Returns a topological order (dependencies before dependents)
 */
export async function resolveDependencies(
  manifest: BlueprintManifest,
  installedStore: BlueprintStore
): Promise<ResolutionResult> {
  const resolved: ResolutionResult['resolved'] = [];
  const missing: ResolutionResult['missing'] = [];
  const order: string[] = [];

  const deps = manifest.dependencies ?? [];
  if (deps.length === 0) {
    return { resolved, missing, order };
  }

  // Build a set of installed blueprints by name for quick lookup
  const installedByName = new Map(installedStore.installed.map(b => [b.name, b]));

  // Track visited to detect cycles.
  // inStack contains names currently being resolved (ancestors in DFS).
  // The root manifest is pre-added to inStack so self-references are detected.
  const visited = new Set<string>();
  const inStack = new Set<string>(); // ancestors currently being resolved

  // Add the root manifest to inStack so self-references are detected as circular
  inStack.add(manifest.name);

  function visit(depName: string, depPath: string | undefined): void {
    if (inStack.has(depName)) {
      missing.push({ name: depName, reason: 'circular dependency' });
      return;
    }
    if (visited.has(depName)) {
      // Already resolved in this pass — still include in order if not already present
      if (!order.includes(depName)) order.push(depName);
      return;
    }

    visited.add(depName);
    inStack.add(depName);

    const installed = installedByName.get(depName);
    if (installed) {
      if (!order.includes(depName)) order.push(depName);
      resolved.push({ name: depName, version: installed.version, path: installed.path });
    } else if (depPath) {
      // Resolvable from local path
      if (!order.includes(depName)) order.push(depName);
      resolved.push({ name: depName, version: 'local', path: depPath });
    } else {
      missing.push({
        name: depName,
        reason: `not installed — install with: ctxhub blueprint install ${depName}`
      });
    }

    inStack.delete(depName);
  }

  for (const dep of deps) {
    visit(dep.name, dep.path);
  }

  // The root manifest itself goes last in the install order
  order.push(manifest.name);

  return { resolved, missing, order };
}
