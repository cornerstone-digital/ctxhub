import type { IndexProviderName } from '../config/types.js';
import type { IndexProvider } from './IndexProvider.js';
import { createLanceDbIndex } from './LanceDbIndex.js';
import { createLocalJsonIndex } from './LocalJsonIndex.js';

export function createIndexProvider(
  provider: IndexProviderName,
  configuredPath: string,
  tableName: string,
  cwd = process.cwd()
): IndexProvider {
  if (provider === 'lancedb') {
    return createLanceDbIndex(configuredPath, tableName, cwd);
  }

  if (provider === 'local-json') {
    return createLocalJsonIndex(configuredPath, cwd);
  }

  throw new Error(`Unsupported index provider: ${provider}`);
}
