import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp } from 'ink';
import { indexWorkspace, type IndexProgressEvent, type IndexResult } from '../../indexing/indexer.js';
import { loadConfig } from '../../config/config.js';
import { RepoStatusList, type RepoStatus } from './RepoStatusList.js';
import { applyIndexProgress } from './applyIndexProgress.js';

export type IndexFn = (
  cwd: string,
  force: boolean,
  onProgress?: (event: IndexProgressEvent) => void
) => Promise<IndexResult>;

type Props = {
  repoNames: string[];
  cwd: string;
  force: boolean;
  indexFn?: IndexFn;
  onSettled?: (repos: RepoStatus[], result: IndexResult) => void;
  onError?: (error: Error) => void;
};

// Ink clears its live region on unmount (by design -- avoids leaving a stale scrolled
// viewport), so this only renders the *ephemeral* in-progress view. The durable,
// scrollback-persisted record (per-repo results + aggregate summary) is printed as
// plain console.log lines by the caller after this component exits, via `onSettled`.
export function IndexProgressApp({ repoNames, cwd, force, indexFn = indexWorkspace, onSettled, onError }: Props) {
  const { exit } = useApp();
  const [repos, setRepos] = useState<RepoStatus[]>(() => repoNames.map(name => ({ name, state: 'queued' })));

  useEffect(() => {
    let latestRepos: RepoStatus[] = repoNames.map(name => ({ name, state: 'queued' }));

    indexFn(cwd, force, event => {
      latestRepos = applyIndexProgress(latestRepos, event);
      setRepos(latestRepos);
    })
      .then(result => {
        onSettled?.(latestRepos, result);
      })
      .catch(error => {
        onError?.(error as Error);
      })
      .finally(() => {
        exit();
      });
    // Runs once on mount -- indexFn/cwd/force are fixed for this app's lifetime.
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">ctxhub index</Text>
      <Text color="gray">
        {force ? 'Force re-indexing' : 'Indexing changed files'} in {cwd}
      </Text>
      <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold>Workspace knowledge</Text>
        <RepoStatusList repos={repos} showSummary />
      </Box>
    </Box>
  );
}

export async function runIndexWithProgress(cwd: string, force: boolean): Promise<{ result: IndexResult; repos: RepoStatus[] }> {
  const config = await loadConfig(cwd);
  const repoNames = config.repositories.map(repo => repo.name);

  let settledRepos: RepoStatus[] = repoNames.map(name => ({ name, state: 'queued' }));
  let settledResult: IndexResult = { scanned: 0, indexed: 0, skipped: 0, deleted: 0 };
  let settledError: Error | undefined;

  const instance = render(
    React.createElement(IndexProgressApp, {
      repoNames,
      cwd,
      force,
      onSettled: (repos, result) => {
        settledRepos = repos;
        settledResult = result;
      },
      onError: error => {
        settledError = error;
      }
    })
  );
  await instance.waitUntilExit();
  instance.clear();

  if (settledError) throw settledError;

  return { result: settledResult, repos: settledRepos };
}
