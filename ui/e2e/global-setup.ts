import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { registerWorkspace } from '../../dist/workspaces/registry.js';
import { indexWorkspace } from '../../dist/indexing/indexer.js';
import { runForegroundService } from '../../dist/commands/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const E2E_PORT = 7343;
export const E2E_WORKSPACE_NAME = 'e2e-fixture';

// Fully isolated, not the real user's control plane: a disposable CTXHUB_HOME (so the registry,
// captain tasks, etc. this run creates never touch ~/.ctxhub/) and a throwaway *copy* of
// examples/reference-workspace (not the git-tracked original) so config edits, skill installs,
// and persona scaffolds the UI tests exercise never leave a real diff in the repo. Both temp dirs
// are torn down in the returned teardown callback -- the officially documented way to pair
// globalSetup with cleanup without needing a separate globalTeardown file to share state with.
export default async function globalSetup() {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-e2e-home-'));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-e2e-fixture-'));
  const fixtureWorkspacePath = path.join(fixtureDir, 'reference-workspace');

  process.env.CTXHUB_HOME = ctxhubHome;

  const sourceFixture = path.resolve(__dirname, '../../examples/reference-workspace');
  await cp(sourceFixture, fixtureWorkspacePath, { recursive: true });

  await registerWorkspace(fixtureWorkspacePath, E2E_WORKSPACE_NAME);
  await indexWorkspace(fixtureWorkspacePath, false);

  const handle = await runForegroundService(E2E_PORT, { log: () => {} });

  return async () => {
    await handle.stop();
    await rm(ctxhubHome, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  };
}
