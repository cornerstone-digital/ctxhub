import { startMcpServer } from '../mcp/server.js';

export async function mcpCommand() {
  await startMcpServer();
}
