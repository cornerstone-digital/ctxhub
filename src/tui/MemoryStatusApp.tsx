import React from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import type { IndexStatus, MemoryStatus } from '../config/types.js';

type Props = {
  memory: MemoryStatus;
  index: IndexStatus;
  onExit?: () => void;
};

export function MemoryStatusApp({ memory, index, onExit }: Props) {
  const { exit } = useApp();
  const healthy = index.chunkCount > 0;

  useInput((_input, key) => {
    if (key.escape || key.return) {
      onExit?.();
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">ctxhub memory status</Text>
      <Text color={healthy ? 'green' : 'yellow'}>{healthy ? 'index ready' : 'index empty'}</Text>
      <Box marginTop={1} flexDirection="row">
        <Box width="50%" borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Memory</Text>
          <Text>Provider: {memory.provider}</Text>
          <Text>Documents: {memory.documentCount}</Text>
          <Text>Chunks: {memory.chunkCount}</Text>
          <Text color="gray">Path: {memory.indexLocation}</Text>
          <Text color="gray">Updated: {memory.lastIndexed ?? 'never'}</Text>
        </Box>
        <Box marginLeft={1} width="50%" borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Index</Text>
          <Text>Provider: {index.provider}</Text>
          <Text>Documents: {index.documentCount}</Text>
          <Text>Chunks: {index.chunkCount}</Text>
          <Text color="gray">Path: {index.indexLocation}</Text>
          <Text color="gray">Indexed: {index.lastIndexed ?? 'never'}</Text>
        </Box>
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor={healthy ? 'gray' : 'yellow'} paddingX={1} flexDirection="column">
        <Text bold>Next</Text>
        <Text color="gray">{healthy ? 'Run ctxhub search, ctxhub pack, or ctxhub report.' : 'Run ctxhub index to build searchable workspace knowledge.'}</Text>
      </Box>
      <Text color="gray">enter/esc close</Text>
    </Box>
  );
}

export async function runMemoryStatusApp(memory: MemoryStatus, index: IndexStatus): Promise<void> {
  const instance = render(<MemoryStatusApp memory={memory} index={index} />);
  await instance.waitUntilExit();
  instance.clear();
}
