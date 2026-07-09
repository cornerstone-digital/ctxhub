import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp } from 'ink';
import { indexWorkspace, type IndexResult } from '../../indexing/indexer.js';
import { loadConfig } from '../../config/config.js';
import { pullRepo } from '../../git/git.js';
import { RepoStatusList, type RepoStatus } from './RepoStatusList.js';
import { applyIndexProgress } from './applyIndexProgress.js';

export type PullFn = (repoPath: string) => Promise<void>;
export type IndexFn = typeof indexWorkspace;

type Props = {
  repos: Array<{ name: string; path: string }>;
  cwd: string;
  noPull: boolean;
  pullFn?: PullFn;
  indexFn?: IndexFn;
  onSettled?: (pullResults: RepoStatus[], indexResults: RepoStatus[], result: IndexResult) => void;
  onError?: (error: Error) => void;
};

// Same "Ink is ephemeral, the durable record is plain console.log after exit" split as
// IndexProgressApp -- see that file's comment for why.
export function SyncProgressApp({ repos, cwd, noPull, pullFn = pullRepo, indexFn = indexWorkspace, onSettled, onError }: Props) {
  const { exit } = useApp();
  const [pullStatus, setPullStatus] = useState<RepoStatus[]>(() => repos.map(repo => ({ name: repo.name, state: 'queued' })));
  const [indexStatus, setIndexStatus] = useState<RepoStatus[]>(() => repos.map(repo => ({ name: repo.name, state: 'queued' })));
  const [phase, setPhase] = useState<'pull' | 'index'>(noPull ? 'index' : 'pull');

  useEffect(() => {
    let latestPull: RepoStatus[] = repos.map(repo => ({ name: repo.name, state: 'queued' }));
    let latestIndex: RepoStatus[] = repos.map(repo => ({ name: repo.name, state: 'queued' }));

    (async () => {
      if (!noPull) {
        for (const repo of repos) {
          latestPull = latestPull.map(status => (status.name === repo.name ? { ...status, state: 'active' } : status));
          setPullStatus(latestPull);
          try {
            await pullFn(repo.path);
            latestPull = latestPull.map(status => (status.name === repo.name ? { ...status, state: 'done', detail: 'pulled' } : status));
          } catch (error) {
            latestPull = latestPull.map(status =>
              status.name === repo.name ? { ...status, state: 'error', detail: (error as Error).message } : status
            );
          }
          setPullStatus(latestPull);
        }
      }

      try {
        setPhase('index');
        const result = await indexFn(cwd, false, event => {
          latestIndex = applyIndexProgress(latestIndex, event);
          setIndexStatus(latestIndex);
        });

        onSettled?.(latestPull, latestIndex, result);
      } catch (error) {
        onError?.(error as Error);
      } finally {
        exit();
      }
    })();
    // Runs once on mount -- props are fixed for this app's lifetime.
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">ctxhub sync</Text>
      <Text color="gray">
        {noPull ? 'Skipping pull phase' : 'Pulling repositories, then re-indexing'} in {cwd}
      </Text>
      {!noPull ? (
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Pulling repositories</Text>
          <RepoStatusList repos={pullStatus} showSummary />
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={phase === 'pull' ? 'gray' : 'cyan'} paddingX={1}>
        <Text bold>{phase === 'pull' ? 'Re-indexing changed knowledge (queued)' : 'Re-indexing changed knowledge'}</Text>
        <RepoStatusList repos={indexStatus} showSummary />
      </Box>
    </Box>
  );
}

export async function runSyncWithProgress(
  cwd: string,
  noPull: boolean
): Promise<{ pullResults: RepoStatus[]; indexResults: RepoStatus[]; result: IndexResult }> {
  const config = await loadConfig(cwd);
  const repos = config.repositories.map(repo => ({ name: repo.name, path: repo.path }));

  let settledPull: RepoStatus[] = repos.map(repo => ({ name: repo.name, state: 'queued' }));
  let settledIndex: RepoStatus[] = repos.map(repo => ({ name: repo.name, state: 'queued' }));
  let settledResult: IndexResult = { scanned: 0, indexed: 0, skipped: 0, deleted: 0 };
  let settledError: Error | undefined;

  const instance = render(
    React.createElement(SyncProgressApp, {
      repos,
      cwd,
      noPull,
      pullFn: pullRepo,
      onSettled: (pullResults, indexResults, result) => {
        settledPull = pullResults;
        settledIndex = indexResults;
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

  return { pullResults: settledPull, indexResults: settledIndex, result: settledResult };
}
