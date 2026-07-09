import type { DevctxConfig } from './types.js';

export const defaultConfig: DevctxConfig = {
  version: 1,
  workspace: {
    name: 'devctx-workspace'
  },
  repositories: [],
  knowledge: {
    include: [
      'README.md',
      'docs/**/*.md',
      'adr/**/*.md',
      '**/*.md',
      '**/*.{ts,tsx,js,jsx,mjs,cjs,json,yaml,yml}'
    ],
    exclude: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**', 'coverage/**']
  },
  memory: {
    provider: 'mempalace',
    path: '.devctx/memory/mempalace'
  },
  index: {
    provider: 'lancedb',
    path: '.devctx/index/lancedb',
    table: 'devctx_chunks',
    incremental: true,
    chunkSize: 1800
  },
  hooks: {}
};
