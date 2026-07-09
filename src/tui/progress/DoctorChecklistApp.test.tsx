import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { DoctorChecklistApp } from './DoctorChecklistApp.js';
import type { CheckLine, DoctorCheck } from '../../commands/doctorChecks.js';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('DoctorChecklistApp shows each check as pending, then its resolved lines, in order', async () => {
  let resolveGit: (() => void) | undefined;
  const checks: DoctorCheck[] = [
    { id: 'node', run: async () => [{ status: 'ok', message: 'Node v22' }] },
    {
      id: 'git',
      run: () =>
        new Promise<CheckLine[]>(resolve => {
          resolveGit = () => resolve([{ status: 'error', message: 'Git is not installed' }]);
        })
    }
  ];

  const { lastFrame, unmount } = render(React.createElement(DoctorChecklistApp, { checks }));

  try {
    await wait();
    const frame = lastFrame() ?? '';
    assert.match(frame, /✓ Node v22/);
    assert.match(frame, /◐ Git\.\.\./);
    assert.match(frame, /Summary/);
    assert.match(frame, /Now/);

    // Resolving triggers exit(), which clears Ink's live region by design (see
    // IndexProgressApp.tsx) -- the durable record is what onSettled reports, covered
    // by the next test. Just confirm this doesn't throw.
    resolveGit?.();
    await wait();
  } finally {
    unmount();
  }
});

test('DoctorChecklistApp reports the flattened, ordered line list via onSettled and exits', async () => {
  const checks: DoctorCheck[] = [
    { id: 'node', run: async () => [{ status: 'ok', message: 'Node v22' }] },
    { id: 'repos', run: async () => [{ status: 'ok', message: 'app: abc1234' }, { status: 'warn', message: 'web: not a git repo' }] },
    { id: 'drift', run: async () => [] }
  ];

  let settled: CheckLine[] | undefined;
  const { unmount } = render(
    React.createElement(DoctorChecklistApp, {
      checks,
      onSettled: lines => {
        settled = lines;
      }
    })
  );

  try {
    await wait();
    assert.deepEqual(settled, [
      { status: 'ok', message: 'Node v22' },
      { status: 'ok', message: 'app: abc1234' },
      { status: 'warn', message: 'web: not a git repo' }
    ]);
  } finally {
    unmount();
  }
});
