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
        <Text bold color="green">
          {detail.repo} <Text color="gray">{detail.filePath}</Text>
        </Text>
        {detail.title ? <Text bold>{detail.title}</Text> : null}
        <Box marginTop={1}>
          <Text>{detail.content}</Text>
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
      <Box marginTop={1} flexDirection="column">
        {status === 'searching' ? <Text color="gray">searching...</Text> : null}
        {status === 'error' ? <Text color="red">error: {errorMessage}</Text> : null}
        {status === 'idle' && query.trim() && !results.length ? <Text color="yellow">no results</Text> : null}
        {results.map((result, i) => {
          const active = i === selected;
          return (
            <Box key={result.id} flexDirection="column">
              <Text color={active ? 'black' : undefined} backgroundColor={active ? 'cyan' : undefined}>
                {active ? '> ' : '  '}
                {result.repo} {result.filePath}
                {result.freshness?.stale ? ' [stale]' : ''}
              </Text>
              {active && result.title ? <Text color="gray">{'  '}{result.title}</Text> : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑/↓ move · enter view chunk · esc quit</Text>
      </Box>
    </Box>
  );
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
