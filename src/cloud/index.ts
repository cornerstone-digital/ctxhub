/**
 * ctxhub Cloud — entry point.
 *
 * Exports the cloud server factory so consumers can create and bind a server:
 *
 *   import { createCloudServer } from './cloud/index.js';
 *   const server = createCloudServer();
 *   server.listen(3001, () => console.log('Cloud service listening on port 3001'));
 */

export { createCloudServer, createInMemoryStore } from './service.js';
export type { CloudStore } from './service.js';
export type {
  CloudChunk,
  CloudOrg,
  CloudWorkspace,
  CloudSyncRequest,
  CloudSyncResponse,
  CloudSearchResult,
} from './types.js';
