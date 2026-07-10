import { startMcpServer } from '../mcp/server.js';

export async function mcpCommand(opts: { allowIndex?: boolean; restartOnStale?: boolean } = {}) {
  await startMcpServer(process.cwd(), { allowIndex: Boolean(opts.allowIndex), restartOnStale: Boolean(opts.restartOnStale) });
}
