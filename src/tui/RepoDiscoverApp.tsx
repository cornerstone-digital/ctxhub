import React, { useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { SelectList, firstSelectableIndex, nextSelectableIndex, toggleSelection, type SelectListItem } from './components/SelectList.js';
import type { DiscoveredRepo } from '../commands/repo.js';

type Props = {
  root: string;
  repos: DiscoveredRepo[];
  onDone?: (selected: DiscoveredRepo[] | undefined) => void;
};

type RepoRow = SelectListItem & { repo?: DiscoveredRepo };

export function RepoDiscoverApp({ root, repos, onDone }: Props) {
  const { exit } = useApp();
  const rows = useMemo<RepoRow[]>(() => repos.map(repo => ({
    key: repo.path,
    label: `${repo.name} — ${repo.path}`,
    repo
  })), [repos]);
  const [selectedIndex, setSelectedIndex] = useState(firstSelectableIndex(rows));
  const [selectedRows, setSelectedRows] = useState<Set<number>>(
    () => new Set(rows.map((row, index) => (row.repo?.state === 'new' ? index : -1)).filter(index => index >= 0))
  );
  const currentRepo = rows[selectedIndex]?.repo ?? repos[0];
  const newCount = repos.filter(repo => repo.state === 'new').length;
  const configuredCount = repos.length - newCount;

  function finish(value: DiscoveredRepo[] | undefined) {
    onDone?.(value);
    exit();
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      finish(undefined);
      return;
    }
    if (key.upArrow) setSelectedIndex(current => nextSelectableIndex(rows, current, -1));
    if (key.downArrow) setSelectedIndex(current => nextSelectableIndex(rows, current, 1));
    if (input === ' ' && rows[selectedIndex]?.repo?.state === 'new') {
      setSelectedRows(current => toggleSelection(current, selectedIndex));
    }
    if (key.return) {
      finish([...selectedRows].map(index => rows[index]?.repo).filter((repo): repo is DiscoveredRepo => Boolean(repo)));
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">ctxhub repo discover</Text>
      <Text color="gray">{root} · {newCount} new · {configuredCount} already configured</Text>
      <Box marginTop={1} flexDirection="row">
        <Box width="58%" borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Repositories</Text>
          <SelectList
            items={rows}
            selectedIndex={selectedIndex}
            markerFor={(item, index) => {
              const row = item as RepoRow;
              if (row.repo?.state === 'configured') return '✓ ';
              return selectedRows.has(index) ? '[x] ' : '[ ] ';
            }}
          />
        </Box>
        <Box marginLeft={1} width="42%">
          <RepoPreview repo={currentRepo} selected={currentRepo ? selectedRows.has(rows.findIndex(row => row.repo === currentRepo)) : false} />
        </Box>
      </Box>
      <Text color="gray">up/down move · space toggle · enter add selected · esc cancel</Text>
    </Box>
  );
}

function RepoPreview({ repo, selected }: { repo?: DiscoveredRepo; selected: boolean }) {
  if (!repo) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text bold>Preview</Text>
        <Text color="gray">No repository selected</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold>Preview</Text>
      <Text color="green">{repo.name}</Text>
      <Text color="gray">{repo.path}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Status</Text>
        <Text color={repo.state === 'new' ? 'cyan' : 'gray'}>{repo.state === 'new' ? 'new repository' : 'already configured'}</Text>
        {repo.state === 'new' ? <Text color={selected ? 'green' : 'yellow'}>{selected ? 'will be added' : 'will be skipped'}</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Next</Text>
        <Text color="gray">{repo.state === 'new' ? 'Add it, then run ctxhub index.' : 'No change needed.'}</Text>
      </Box>
    </Box>
  );
}

export async function runRepoDiscoverReview(root: string, repos: DiscoveredRepo[]): Promise<DiscoveredRepo[] | undefined> {
  let selected: DiscoveredRepo[] | undefined;
  const instance = render(
    <RepoDiscoverApp
      root={root}
      repos={repos}
      onDone={value => {
        selected = value;
      }}
    />
  );
  await instance.waitUntilExit();
  instance.clear();
  return selected;
}
