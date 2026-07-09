import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp } from 'ink';
import { CHECK_LABELS, runDoctorChecks, type CheckLine, type CheckStatus, type DoctorCheck } from '../../commands/doctorChecks.js';

type CheckState = { id: string; status: 'pending' | 'done'; lines: CheckLine[] };

const COLOR_BY_STATUS: Record<CheckStatus, string> = { ok: 'green', warn: 'yellow', error: 'red' };
const GLYPH_BY_STATUS: Record<CheckStatus, string> = { ok: '✓', warn: '!', error: '✗' };

type Props = {
  checks: DoctorCheck[];
  onSettled?: (lines: CheckLine[]) => void;
};

// Same "Ink is ephemeral, the durable record is plain console.log after exit" split as
// the other progress views -- see IndexProgressApp.tsx for why.
export function DoctorChecklistApp({ checks, onSettled }: Props) {
  const { exit } = useApp();
  const [states, setStates] = useState<CheckState[]>(() => checks.map(check => ({ id: check.id, status: 'pending', lines: [] })));

  useEffect(() => {
    (async () => {
      const allLines = await runDoctorChecks(checks, (id, lines) => {
        setStates(current => current.map(state => (state.id === id ? { ...state, status: 'done', lines } : state)));
      });
      onSettled?.(allLines);
      exit();
    })();
    // Runs once on mount -- `checks` is fixed for this app's lifetime.
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>ctxhub doctor</Text>
      <Box marginTop={1} flexDirection="column">
        {states.map(state =>
          state.status === 'pending' ? (
            <Text key={state.id} color="gray">
              ◐ {CHECK_LABELS[state.id] ?? state.id}...
            </Text>
          ) : (
            state.lines.map((line, index) => (
              <Text key={`${state.id}-${index}`} color={COLOR_BY_STATUS[line.status]}>
                {GLYPH_BY_STATUS[line.status]} {line.message}
              </Text>
            ))
          )
        )}
      </Box>
    </Box>
  );
}

export async function runDoctorChecklist(checks: DoctorCheck[]): Promise<CheckLine[]> {
  let settled: CheckLine[] = [];
  const instance = render(
    React.createElement(DoctorChecklistApp, {
      checks,
      onSettled: lines => {
        settled = lines;
      }
    })
  );
  await instance.waitUntilExit();
  return settled;
}
