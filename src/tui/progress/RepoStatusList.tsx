import React from 'react';
import { Box, Text } from 'ink';

export type RepoState = 'queued' | 'active' | 'done' | 'missing' | 'error';

export type RepoStatus = {
  name: string;
  state: RepoState;
  detail?: string;
};

const ICON_BY_STATE: Record<RepoState, string> = {
  queued: '·',
  active: '◐',
  done: '✓',
  missing: '!',
  error: '✗'
};

const COLOR_BY_STATE: Record<RepoState, string | undefined> = {
  queued: 'gray',
  active: 'cyan',
  done: 'green',
  missing: 'yellow',
  error: 'red'
};

export function summarizeRepoStatuses(repos: RepoStatus[]): string {
  const counts = repos.reduce<Record<RepoState, number>>(
    (acc, repo) => {
      acc[repo.state]++;
      return acc;
    },
    { queued: 0, active: 0, done: 0, missing: 0, error: 0 }
  );

  return [
    counts.active ? `${counts.active} active` : undefined,
    counts.done ? `${counts.done} done` : undefined,
    counts.queued ? `${counts.queued} queued` : undefined,
    counts.missing ? `${counts.missing} missing` : undefined,
    counts.error ? `${counts.error} error` : undefined
  ].filter(Boolean).join(' · ') || 'no repositories';
}

// Pure presentational list -- no timers/animation, so it stays trivially testable.
// "active" is a static glyph rather than an animated spinner frame, deliberately:
// the commands using this (index/sync/watch) already resolve per-repo work quickly
// enough that a spinner would mostly just flash, and a static indicator keeps this
// component free of intervals to manage/clean up.
export function RepoStatusList({ repos, showSummary = false }: { repos: RepoStatus[]; showSummary?: boolean }) {
  return (
    <Box flexDirection="column">
      {showSummary ? <Text color="gray">{summarizeRepoStatuses(repos)}</Text> : null}
      {repos.map(repo => (
        <Text key={repo.name} color={COLOR_BY_STATE[repo.state]}>
          {ICON_BY_STATE[repo.state]} {repo.name}
          {repo.detail ? ` — ${repo.detail}` : ''}
        </Text>
      ))}
    </Box>
  );
}
