import type { EvidenceSourceConfig, RepoConfig } from '../../config/types.js';
import type { EvidenceSource } from '../evidenceSource.js';
import { GitEvidenceSource } from './gitEvidenceSource.js';
import { LandRegistryEvidenceSource } from './landRegistryEvidenceSource.js';

export { GitEvidenceSource } from './gitEvidenceSource.js';
export { LandRegistryEvidenceSource } from './landRegistryEvidenceSource.js';

export function createGitEvidenceSource(
  repo: RepoConfig,
  workspaceRoot: string,
  globalInclude: string[],
  globalExclude: string[],
  ignorePatterns: string[],
  concurrency: number
): EvidenceSource {
  return new GitEvidenceSource(repo, workspaceRoot, globalInclude, globalExclude, ignorePatterns, concurrency);
}

// Mirrors createIndexProvider's (src/indexing/providers.ts) switch-on-kind shape.
export function createEvidenceSource(config: EvidenceSourceConfig): EvidenceSource {
  switch (config.kind) {
    case 'land-registry':
      return new LandRegistryEvidenceSource(config);
    default: {
      const _exhaustive: never = config.kind;
      throw new Error(`Unsupported evidence source kind: ${_exhaustive}`);
    }
  }
}
