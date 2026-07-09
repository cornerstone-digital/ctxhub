import { loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';

export async function openCommand(id: string, opts: { json?: boolean } = {}) {
  const config = await loadConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const document = await index.getDocument(id);
  if (!document) throw new Error(`Chunk not found: ${id}`);

  if (opts.json) {
    console.log(JSON.stringify(document, null, 2));
    return;
  }

  console.log(`# ${document.repo}:${document.filePath}${document.title ? ` - ${document.title}` : ''}`);
  console.log('');
  console.log(document.content);
}
