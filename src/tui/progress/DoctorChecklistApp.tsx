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
  const completed = states.filter(state => state.status === 'done').length;
  const lines = states.flatMap(state => state.lines);
  const errors = lines.filter(line => line.status === 'error').length;
  const warnings = lines.filter(line => line.status === 'warn').length;
  const ok = lines.filter(line => line.status === 'ok').length;
  const active = states.find(state => state.status === 'pending');

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
      <Text bold color="cyan">ctxhub doctor</Text>
      <Text color="gray">Checking workspace health · {completed}/{states.length} complete</Text>
      <Box marginTop={1} flexDirection="row">
        <Box width="64%" borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Checks</Text>
          {states.map(state =>
            state.status === 'pending' ? (
              <Text key={state.id} color="gray">
                ◐ {CHECK_LABELS[state.id] ?? state.id}...
              </Text>
            ) : state.lines.length ? (
              state.lines.map((line, index) => (
                <Text key={`${state.id}-${index}`} color={COLOR_BY_STATUS[line.status]}>
                  {GLYPH_BY_STATUS[line.status]} {line.message}
                </Text>
              ))
            ) : (
              <Text key={state.id} color="green">
                ✓ {CHECK_LABELS[state.id] ?? state.id}: no issues
              </Text>
            )
          )}
        </Box>
        <Box marginLeft={1} width="36%" borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Summary</Text>
          <Text color="green">ok {ok}</Text>
          <Text color={warnings ? 'yellow' : 'gray'}>warnings {warnings}</Text>
          <Text color={errors ? 'red' : 'gray'}>errors {errors}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold>Now</Text>
            <Text color="gray">{active ? CHECK_LABELS[active.id] ?? active.id : 'finishing'}</Text>
          </Box>
        </Box>
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
  instance.clear();
  return settled;
}
