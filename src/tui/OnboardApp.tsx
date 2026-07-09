import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { SelectList, nextSelectableIndex, toggleSelection, type SelectListItem } from './components/SelectList.js';
import { runOnboardFlow, type OnboardDeps, type OnboardIO } from './onboardFlow.js';

type PendingPrompt =
  | { kind: 'text'; message: string; defaultValue: string; resolve: (value: string) => void }
  | { kind: 'confirm'; message: string; defaultValue: boolean; resolve: (value: boolean) => void }
  | { kind: 'multiselect'; message: string; choices: string[]; resolve: (value: string[]) => void };

type Props = {
  cwd?: string;
  deps?: OnboardDeps;
};

// Bridges the linear `runOnboardFlow` orchestration to Ink: each ask* call in the flow
// pauses on a promise that resolves once the user answers the rendered prompt below.
// Like the other progress views, this tree is ephemeral -- durable output (banners,
// suspended command output) comes from plain console.log, safe to call at any time
// here because Ink's default `patchConsole` option safely interleaves it above the
// live region (unlike ora's raw ANSI writes or a nested Ink instance, which do need
// suspendTerminal -- see onboardFlow.ts's indexCommand/repoHookCommand calls).
export function OnboardApp({ cwd = process.cwd(), deps }: Props) {
  const { exit, suspendTerminal } = useApp();
  const [pending, setPending] = useState<PendingPrompt>();

  useEffect(() => {
    const io: OnboardIO = {
      suspendTerminal,
      askText: (message, defaultValue) =>
        new Promise<string>(resolve => setPending({ kind: 'text', message, defaultValue, resolve })),
      askConfirm: (message, defaultValue) =>
        new Promise<boolean>(resolve => setPending({ kind: 'confirm', message, defaultValue, resolve })),
      askMultiSelect: (message, choices) =>
        new Promise<string[]>(resolve => setPending({ kind: 'multiselect', message, choices, resolve }))
    };

    (async () => {
      await runOnboardFlow(cwd, io, deps);
      exit();
    })();
    // Runs once on mount -- cwd/deps are fixed for this app's lifetime.
  }, []);

  if (!pending) return null;

  function done() {
    setPending(undefined);
  }

  if (pending.kind === 'text') {
    return (
      <TextPrompt
        key={pending.message}
        message={pending.message}
        defaultValue={pending.defaultValue}
        onSubmit={value => {
          pending.resolve(value);
          done();
        }}
      />
    );
  }

  if (pending.kind === 'confirm') {
    return (
      <ConfirmPrompt
        key={pending.message}
        message={pending.message}
        defaultValue={pending.defaultValue}
        onSubmit={value => {
          pending.resolve(value);
          done();
        }}
      />
    );
  }

  return (
    <MultiSelectPrompt
      key={pending.message}
      message={pending.message}
      choices={pending.choices}
      onSubmit={value => {
        pending.resolve(value);
        done();
      }}
    />
  );
}

function TextPrompt({ message, defaultValue, onSubmit }: { message: string; defaultValue: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>{message}</Text>
      <Box>
        <Text color="cyan">{'> '}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}

function ConfirmPrompt({
  message,
  defaultValue,
  onSubmit
}: {
  message: string;
  defaultValue: boolean;
  onSubmit: (value: boolean) => void;
}) {
  const items: SelectListItem[] = [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }];
  const [choiceIndex, setChoiceIndex] = useState(defaultValue ? 0 : 1);

  useInput((_input, key) => {
    if (key.upArrow) setChoiceIndex(current => nextSelectableIndex(items, current, -1));
    if (key.downArrow) setChoiceIndex(current => nextSelectableIndex(items, current, 1));
    if (key.return) onSubmit(choiceIndex === 0);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>{message}</Text>
      <SelectList items={items} selectedIndex={choiceIndex} />
      <Text color="gray">↑/↓ move · enter confirm</Text>
    </Box>
  );
}

function MultiSelectPrompt({
  message,
  choices,
  onSubmit
}: {
  message: string;
  choices: string[];
  onSubmit: (value: string[]) => void;
}) {
  const items: SelectListItem[] = choices.map(choice => ({ key: choice, label: choice }));
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [toggled, setToggled] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.upArrow) setChoiceIndex(current => nextSelectableIndex(items, current, -1));
    if (key.downArrow) setChoiceIndex(current => nextSelectableIndex(items, current, 1));
    if (input === ' ') setToggled(current => toggleSelection(current, choiceIndex));
    if (key.return) onSubmit([...toggled].map(index => choices[index]).filter((value): value is string => Boolean(value)));
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>{message}</Text>
      <SelectList items={items} selectedIndex={choiceIndex} markerFor={(_item, index) => (toggled.has(index) ? '[x] ' : '[ ] ')} />
      <Text color="gray">↑/↓ move · space toggle · enter confirm</Text>
    </Box>
  );
}

export async function runOnboardMode(): Promise<void> {
  const instance = render(React.createElement(OnboardApp));
  await instance.waitUntilExit();
}
