import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { GuidedApp } from './GuidedApp.js';
import type { GuidedCommand } from './guided/commandTree.js';

const ENTER = '\r';
const ESCAPE = '\u001B';
const DOWN = '\u001B[B';
const SPACE = ' ';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const COMMANDS: GuidedCommand[] = [
  {
    path: 'repo hook',
    description: 'Install a hook',
    category: 'Repositories',
    fields: [
      { key: 'name', label: 'Repository name', kind: 'text', required: true, variadic: false, isOption: false },
      { key: 'force', label: 'Overwrite', kind: 'boolean', required: false, variadic: false, isOption: true, flag: '--force' }
    ]
  },
  {
    path: 'repo list',
    description: 'List repos',
    category: 'Repositories',
    fields: []
  },
  {
    path: 'skills install',
    description: 'Install skills',
    category: 'Agents & Skills',
    fields: [
      {
        key: 'agents',
        label: 'Agents to install for',
        kind: 'multiselect',
        required: false,
        variadic: true,
        isOption: false,
        choices: ['claude', 'codex']
      }
    ]
  }
];

function renderApp(runCalls: string[][]) {
  return render(
    React.createElement(GuidedApp, {
      commands: COMMANDS,
      run: async (argv: string[]) => {
        runCalls.push(argv);
      }
    })
  );
}

test('GuidedApp menu shows category headers and commands, and filters as you type', async () => {
  const { stdin, lastFrame, unmount } = renderApp([]);
  try {
    await wait();
    let frame = lastFrame() ?? '';
    assert.match(frame, /Repositories/);
    assert.match(frame, /Agents & Skills/);
    assert.match(frame, /repo hook/);
    assert.match(frame, /skills install/);

    stdin.write('skills');
    await wait();
    frame = lastFrame() ?? '';
    assert.match(frame, /skills install/);
    assert.doesNotMatch(frame, /repo hook/);
  } finally {
    unmount();
  }
});

test('GuidedApp walks a multi-field wizard, shows the confirm screen, and runs the built argv', async () => {
  const runCalls: string[][] = [];
  const { stdin, lastFrame, unmount } = renderApp(runCalls);

  try {
    await wait();
    stdin.write(ENTER); // select the first selectable row: "repo hook"
    await wait();
    let frame = lastFrame() ?? '';
    assert.match(frame, /repo hook/);
    assert.match(frame, /Repository name/);
    assert.match(frame, /\(1\/2\)/);

    stdin.write('my-repo');
    await wait();
    stdin.write(ENTER); // confirm text field, advance to the boolean field
    await wait();
    frame = lastFrame() ?? '';
    assert.match(frame, /Overwrite/);
    assert.match(frame, /\(2\/2\)/);
    assert.match(frame, /> No/, 'boolean field with no default should highlight "No" first');

    stdin.write(ENTER); // confirm "No" -> advance to confirm screen
    await wait();
    frame = lastFrame() ?? '';
    assert.match(frame, /ctxhub repo hook my-repo/);
    assert.doesNotMatch(frame, /--force/);

    stdin.write(ENTER); // run
    await wait();
    assert.deepEqual(runCalls, [['repo', 'hook', 'my-repo']]);

    frame = lastFrame() ?? '';
    assert.match(frame, /guided menu/);
  } finally {
    unmount();
  }
});

test('GuidedApp skips the wizard entirely for a zero-field command', async () => {
  const runCalls: string[][] = [];
  const { stdin, lastFrame, unmount } = renderApp(runCalls);

  try {
    await wait();
    stdin.write(DOWN); // "repo list"
    await wait();
    stdin.write(ENTER);
    await wait();
    const frame = lastFrame() ?? '';
    assert.match(frame, /ctxhub repo list/);
  } finally {
    unmount();
  }
});

test('GuidedApp multiselect field: space toggles choices, enter confirms the selected set', async () => {
  const runCalls: string[][] = [];
  const { stdin, lastFrame, unmount } = renderApp(runCalls);

  try {
    await wait();
    stdin.write(DOWN);
    await wait();
    stdin.write(DOWN); // "skills install"
    await wait();
    stdin.write(ENTER);
    await wait();
    let frame = lastFrame() ?? '';
    assert.match(frame, /Agents to install for/);
    assert.match(frame, /\[ \] claude/);

    stdin.write(SPACE); // toggle "claude" on
    await wait();
    stdin.write(DOWN);
    await wait();
    stdin.write(SPACE); // toggle "codex" on
    await wait();
    frame = lastFrame() ?? '';
    assert.match(frame, /\[x\] claude/);
    assert.match(frame, /\[x\] codex/);

    stdin.write(ENTER); // confirm selection -> confirm screen
    await wait();
    frame = lastFrame() ?? '';
    assert.match(frame, /ctxhub skills install claude codex/);

    stdin.write(ENTER); // run
    await wait();
    assert.deepEqual(runCalls, [['skills', 'install', 'claude', 'codex']]);
  } finally {
    unmount();
  }
});

test('GuidedApp escape on the first wizard field cancels back to the menu without running anything', async () => {
  const runCalls: string[][] = [];
  const { stdin, lastFrame, unmount } = renderApp(runCalls);

  try {
    await wait();
    stdin.write(ENTER); // "repo hook" -> wizard
    await wait();
    let frame = lastFrame() ?? '';
    assert.match(frame, /Repository name/);

    stdin.write(ESCAPE);
    await wait();
    frame = lastFrame() ?? '';
    assert.match(frame, /guided menu/);
    assert.deepEqual(runCalls, []);
  } finally {
    unmount();
  }
});
