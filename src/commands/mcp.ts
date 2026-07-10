import { startMcpServer } from '../mcp/server.js';

export async function mcpCommand(opts: { allowIndex?: boolean; allowMemoryWrite?: boolean; restartOnStale?: boolean } = {}) {
  await startMcpServer(process.cwd(), {
    allowIndex: Boolean(opts.allowIndex),
    allowMemoryWrite: Boolean(opts.allowMemoryWrite),
    restartOnStale: Boolean(opts.restartOnStale)
  });
}
