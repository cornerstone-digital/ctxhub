import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CtxhubConfig, IndexedDocument, SearchResult } from '../config/types.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';

type Mode = 'list' | 'detail';
type Status = 'idle' | 'searching' | 'error';

type Props = {
  config: CtxhubConfig;
  cwd: string;
  initialQuery: string;
  limit: number;
};

const SEARCH_DEBOUNCE_MS = 150;
const SNIPPET_LIMIT = 900;
const CONTENT_PREVIEW_LIMIT = 5000;

export function SearchApp({ config, cwd, initialQuery, limit }: Props) {
  const { exit } = useApp();
  const index = useMemo(
    () => createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd),
    [config, cwd]
  );

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [mode, setMode] = useState<Mode>('list');
  const [detail, setDetail] = useState<IndexedDocument>();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelected(0);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('searching');

    const timer = setTimeout(() => {
      index
        .search(query, limit)
        .then(raw => attachFreshness(config, raw, cwd))
        .then(withFreshness => {
          if (cancelled) return;
          setResults(withFreshness);
          setSelected(0);
          setStatus('idle');
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setErrorMessage((error as Error).message);
          setStatus('error');
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, index, config, cwd, limit]);

  useInput((input, key) => {
    if (mode === 'detail') {
      if (key.escape || input === 'q') setMode('list');
      return;
    }

    if (key.escape) {
      exit();
      return;
    }
    if (key.upArrow) setSelected(current => Math.max(0, current - 1));
    if (key.downArrow) setSelected(current => Math.min(results.length - 1, current + 1));
    if (key.return && results[selected]) {
      const target = results[selected];
      index.getDocument(target.id).then(document => {
        setDetail(document ?? target);
        setMode('detail');
      });
    }
  });

  if (mode === 'detail' && detail) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">ctxhub search — {config.workspace.name}</Text>
        <Text color="gray">Full chunk preview</Text>
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="green">
            {detail.repo} <Text color="gray">{detail.filePath}</Text>
          </Text>
          {detail.title ? <Text bold>{detail.title}</Text> : null}
          <Text color="gray">id {shortId(detail.id)} · indexed {detail.lastIndexed}</Text>
          {detail.commit ? <Text color="gray">commit {detail.commit.slice(0, 7)}</Text> : null}
        </Box>
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
          <Text>{truncate(detail.content, CONTENT_PREVIEW_LIMIT)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">esc/q back to results</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>ctxhub search — {config.workspace.name}</Text>
      <Box>
        <Text color="cyan">{'> '}</Text>
        <TextInput value={query} onChange={setQuery} placeholder="type to search..." />
      </Box>
      <Box marginTop={1} flexDirection="row">
        <Box width="48%" borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Results</Text>
          {status === 'searching' ? <Text color="gray">searching...</Text> : null}
          {status === 'error' ? <Text color="red">error: {errorMessage}</Text> : null}
          {status === 'idle' && query.trim() && !results.length ? <Text color="yellow">no results</Text> : null}
          {results.map((result, i) => {
            const active = i === selected;
            return (
              <Box key={result.id} flexDirection="column">
                <Text color={active ? 'black' : undefined} backgroundColor={active ? 'cyan' : undefined}>
                  {active ? '> ' : '  '}
                  {i + 1}. {result.repo} {result.filePath}
                  {result.freshness?.stale ? ' [stale]' : ''}
                </Text>
                {active && result.title ? <Text color="gray">{'  '}{result.title}</Text> : null}
              </Box>
            );
          })}
        </Box>
        <Box marginLeft={1} width="52%">
          <ResultPreview result={results[selected]} status={status} query={query} />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑/↓ move · enter full chunk · esc quit</Text>
      </Box>
    </Box>
  );
}

function ResultPreview({ result, status, query }: { result?: SearchResult; status: Status; query: string }) {
  if (!query.trim()) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text bold>Preview</Text>
        <Text color="gray">Type a query to search indexed workspace knowledge.</Text>
      </Box>
    );
  }

  if (status === 'searching') {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text bold>Preview</Text>
        <Text color="gray">Searching...</Text>
      </Box>
    );
  }

  if (!result) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text bold>Preview</Text>
        <Text color="gray">No selected result</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold>Preview</Text>
      <Text color="green">{result.repo} <Text color="gray">{result.filePath}</Text></Text>
      {result.title ? <Text bold>{result.title}</Text> : null}
      <Text color="gray">id {shortId(result.id)} · score {formatScore(result.score)}</Text>
      {result.kind ? <Text color="gray">kind {result.kind}</Text> : null}
      {result.symbol ? <Text color="gray">symbol {result.symbolKind ?? 'symbol'} {result.symbol}</Text> : null}
      {result.components?.length ? <Text color="gray">components {result.components.slice(0, 6).join(', ')}</Text> : null}
      {result.relationships?.length ? <Text color="gray">relationships {result.relationships.length}</Text> : null}
      {result.freshness?.stale ? <Text color="yellow">stale: {result.freshness.reason}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Snippet</Text>
        <Text>{truncate(result.snippet, SNIPPET_LIMIT)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">open later: ctxhub open {shortId(result.id)}</Text>
      </Box>
    </Box>
  );
}

function shortId(id: string): string {
  return id.slice(0, 12);
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(3);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}\n...`;
}

export async function runInteractiveSearch(
  config: CtxhubConfig,
  cwd: string,
  initialQuery = '',
  limit = 8
): Promise<void> {
  const instance = render(
    <SearchApp config={config} cwd={cwd} initialQuery={initialQuery} limit={limit} />
  );
  await instance.waitUntilExit();
}
