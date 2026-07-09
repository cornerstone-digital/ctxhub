import type { SsdConfig } from './types.js';

export const defaultConfig: SsdConfig = {
  version: 1,
  workspace: {
    name: 'ssd-workspace'
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
    path: '.ssd/memory/mempalace'
  },
  index: {
    provider: 'lancedb',
    path: '.ssd/index/lancedb',
    table: 'ssd_chunks',
    incremental: true,
    chunkSize: 1800
  },
  hooks: {}
};
