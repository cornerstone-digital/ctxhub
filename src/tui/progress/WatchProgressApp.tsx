import React, { useEffect, useState } from 'react';
import { Box, Text, render } from 'ink';
import { indexWorkspace } from '../../indexing/indexer.js';
import { loadConfig } from '../../config/config.js';
import { RepoStatusList, type RepoStatus } from './RepoStatusList.js';
import { applyIndexProgress } from './applyIndexProgress.js';
import type { IndexFn } from './IndexProgressApp.js';

const MAX_ACTIVITY_ENTRIES = 10;

type ActivityEntry = { at: string; message: string };

type Props = {
  repoNames: string[];
  cwd: string;
  intervalMs: number;
  indexFn?: IndexFn;
};

// Runs indefinitely -- there is no exit() call here by design. Ink's default Ctrl+C
// handling unmounts the tree (running this component's effect cleanup, which clears
// the interval) when the process is interrupted, matching the plain implementation's
// "Press Ctrl+C to stop" behavior.
export function WatchProgressApp({ repoNames, cwd, intervalMs, indexFn = indexWorkspace }: Props) {
  const [repos, setRepos] = useState<RepoStatus[]>(() => repoNames.map(name => ({ name, state: 'queued' })));
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const [lastChecked, setLastChecked] = useState<string>();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function runCycle() {
      if (cancelled) return;
      let latestRepos: RepoStatus[] = repoNames.map(name => ({ name, state: 'queued' }));
      setRunning(true);
      setRepos(latestRepos);

      try {
        const result = await indexFn(cwd, false, event => {
          latestRepos = applyIndexProgress(latestRepos, event);
          setRepos(latestRepos);
        });
        if (cancelled) return;

        setCycles(current => current + 1);
        setLastChecked(new Date().toISOString());
        const changed = result.indexed + result.deleted;
        if (changed) {
          setActivity(current =>
            [{ at: new Date().toISOString(), message: `indexed=${result.indexed} deleted=${result.deleted} skipped=${result.skipped}` }, ...current].slice(
              0,
              MAX_ACTIVITY_ENTRIES
            )
          );
        }
      } catch (error) {
        if (cancelled) return;
        setActivity(current => [{ at: new Date().toISOString(), message: `error: ${(error as Error).message}` }, ...current].slice(0, MAX_ACTIVITY_ENTRIES));
      } finally {
        if (!cancelled) setRunning(false);
      }
    }

    void runCycle();
    const timer = setInterval(() => void runCycle(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Runs once on mount -- props are fixed for this app's lifetime.
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">ctxhub watch</Text>
      <Text color="gray">Indexing every {intervalMs / 1000}s in {cwd}. Press Ctrl+C to stop.</Text>
      <Box marginTop={1}>
        <Text color="gray">
          cycles: {cycles}
          {lastChecked ? ` · last checked: ${lastChecked}` : ''}
        </Text>
      </Box>
      {running ? (
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Indexing...</Text>
          <RepoStatusList repos={repos} showSummary />
        </Box>
      ) : null}
      {activity.length ? (
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Recent activity</Text>
          {activity.map((entry, index) => (
            <Text key={index} color="gray">
              {entry.at} {entry.message}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export async function runWatchWithProgress(cwd: string, intervalMs: number): Promise<void> {
  const config = await loadConfig(cwd);
  const repoNames = config.repositories.map(repo => repo.name);
  const instance = render(React.createElement(WatchProgressApp, { repoNames, cwd, intervalMs }));
  await instance.waitUntilExit();
}
