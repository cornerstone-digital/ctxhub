import { startMcpServer } from '../mcp/server.js';
import { startCentralMcpServer } from '../mcp/centralServer.js';

export async function mcpCommand(opts: { allowIndex?: boolean; allowMemoryWrite?: boolean; restartOnStale?: boolean; central?: boolean } = {}) {
  if (opts.central) {
    // docs/control-plane.md Phase 5: a stdio proxy routing into registered workspaces' own
    // isolated MCP servers, not a single-workspace server bound to cwd.
    await startCentralMcpServer({ allowIndex: Boolean(opts.allowIndex), allowMemoryWrite: Boolean(opts.allowMemoryWrite) });
    return;
  }

  await startMcpServer(process.cwd(), {
    allowIndex: Boolean(opts.allowIndex),
    allowMemoryWrite: Boolean(opts.allowMemoryWrite),
    restartOnStale: Boolean(opts.restartOnStale)
  });
}
