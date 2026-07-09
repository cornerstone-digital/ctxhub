import { startMcpServer } from '../mcp/server.js';

export async function mcpCommand(opts: { allowIndex?: boolean } = {}) {
  await startMcpServer(process.cwd(), { allowIndex: Boolean(opts.allowIndex) });
}
