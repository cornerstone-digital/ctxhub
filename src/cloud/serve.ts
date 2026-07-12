/**
 * Standalone entrypoint for the ctxhub Cloud service stub.
 *
 * `createCloudServer()` (service.ts) only builds an http.Server — something has to call
 * `.listen()` and own the process. This is that something, for local dev / Local DX and for
 * the Docker image (see Dockerfile.cloud). Not used by the test suite, which constructs the
 * server directly and never binds a real port.
 *
 * Still backed by CloudStore's in-memory Maps (see service.ts's doc comment) — restarting
 * this process loses all data. Not wired to Postgres (db.ts) yet; that's the next step before
 * this could back a real deployment.
 */
import { createCloudServer, createInMemoryStore } from './service.js';

const port = Number(process.env.PORT ?? 3001);
const bootstrapAdminKey = process.env.CLOUD_ADMIN_KEY;

if (!bootstrapAdminKey) {
  console.error('CLOUD_ADMIN_KEY is required — it is the only way to create an org via POST /orgs.');
  console.error('Set it to any secret string, e.g.: CLOUD_ADMIN_KEY=local-dev-admin-key');
  process.exit(1);
}

const store = createInMemoryStore(bootstrapAdminKey);
const server = createCloudServer(store);

server.listen(port, () => {
  console.log(`ctxhub Cloud service listening on :${port}`);
  console.log('Backing store: in-memory (not persisted -- restarting this process loses all data)');
});
