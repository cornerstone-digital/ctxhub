import type { CtxhubConfig } from './types.js';

export const defaultConfig: CtxhubConfig = {
  version: 1,
  workspace: {
    name: 'ctxhub-workspace'
  },
  repositories: [],
  knowledge: {
    include: [
      'README.md',
      'docs/**/*.md',
      'adr/**/*.md',
      'architecture/**/*.{mmd,mermaid}',
      'diagrams/**/*.{mmd,mermaid}',
      '**/*.md',
      '**/*.{mmd,mermaid}',
      '**/*.{ts,tsx,js,jsx,mjs,cjs,json}'
    ],
    exclude: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**', 'coverage/**', 'cicd/**', '.env', '.env.*']
  },
  memory: {
    provider: 'mempalace',
    path: '.ctxhub/memory/mempalace'
  },
  index: {
    provider: 'lancedb',
    path: '.ctxhub/index/lancedb',
    table: 'ctxhub_chunks',
    incremental: true,
    chunkSize: 1800
  },
  hooks: {},
  privacy: {
    redactPatterns: [
      '(api[_-]?key|token|secret|password)\\s*[:=]\\s*[^\\s]+',
      'AKIA[0-9A-Z]{16}',
      '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----'
    ]
  },
  llm: {
    enabled: false,
    timeoutMs: 120_000
  },
  executionProfiles: {}
};
