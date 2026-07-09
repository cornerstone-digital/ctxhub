import React, { useEffect, useMemo, useState } from 'react';
import { spawnSync } from 'node:child_process';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { buildProgram } from '../cli/program.js';
import { buildArgv, extractGuidedCommands, type GuidedCommand, type GuidedField } from './guided/commandTree.js';
import {
  SelectList,
  firstSelectableIndex,
  nextSelectableIndex,
  toggleSelection,
  type SelectListItem
} from './components/SelectList.js';

type Screen = 'menu' | 'wizard' | 'confirm';

type MenuRow = SelectListItem & { command?: GuidedCommand };

type Props = {
  commands?: GuidedCommand[];
  run?: (argv: string[]) => Promise<void>;
};

function defaultRun(argv: string[]): Promise<void> {
  const entry = process.argv[1] ?? '';
  spawnSync(process.execPath, [...process.execArgv, entry, ...argv], { stdio: 'inherit' });
  return Promise.resolve();
}

function buildMenuRows(commands: GuidedCommand[], filter: string): MenuRow[] {
  const term = filter.trim().toLowerCase();
  const matches = term
    ? commands.filter(command => `${command.path} ${command.description}`.toLowerCase().includes(term))
    : commands;

  // Group by category first, rather than inserting a header whenever the category
  // differs from the previous row -- commands sharing a category aren't necessarily
  // contiguous in `commands` (e.g. "doctor" is categorized "Setup" but registered long
  // after "init"/"onboard"), so the naive "changed since last row" approach produced
  // duplicate headers for the same category. A Map preserves first-seen category order.
  const byCategory = new Map<string, GuidedCommand[]>();
  for (const command of matches) {
    const existing = byCategory.get(command.category);
    if (existing) existing.push(command);
    else byCategory.set(command.category, [command]);
  }

  const rows: MenuRow[] = [];
  for (const [category, categoryCommands] of byCategory) {
    rows.push({ key: `category:${category}`, label: category, disabled: true });
    for (const command of categoryCommands) {
      rows.push({ key: command.path, label: `${command.path} — ${command.description}`, command });
    }
  }
  return rows;
}

function initialFieldValue(field: GuidedField): unknown {
  if (field.kind === 'multiselect') return [];
  if (field.kind === 'boolean') return Boolean(field.defaultValue);
  return field.defaultValue !== undefined ? String(field.defaultValue) : '';
}

export function GuidedApp({ commands: commandsProp, run: runProp }: Props) {
  const { exit, suspendTerminal } = useApp();
  const commands = useMemo(() => commandsProp ?? extractGuidedCommands(buildProgram()), [commandsProp]);
  const run = useMemo(
    () => runProp ?? ((argv: string[]) => suspendTerminal(() => defaultRun(argv))),
    [runProp, suspendTerminal]
  );

  const [screen, setScreen] = useState<Screen>('menu');
  const [filter, setFilter] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [selectedCommand, setSelectedCommand] = useState<GuidedCommand>();
  const [fieldIndex, setFieldIndex] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [confirmArgv, setConfirmArgv] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const menuRows = useMemo(() => buildMenuRows(commands, filter), [commands, filter]);
  const field = selectedCommand?.fields[fieldIndex];

  // menuRows always starts with a disabled category header, so index 0 is never a real
  // selection -- re-anchor to the first selectable row whenever filtering changes it.
  useEffect(() => {
    setMenuIndex(firstSelectableIndex(menuRows));
  }, [menuRows]);

  const [choiceIndex, setChoiceIndex] = useState(0);
  const [toggled, setToggled] = useState<Set<number>>(new Set());
  const [textValue, setTextValue] = useState('');

  useEffect(() => {
    if (!field) return;
    setTextValue(field.kind === 'boolean' ? '' : String(initialFieldValue(field) ?? ''));
    setChoiceIndex(field.kind === 'boolean' ? (field.defaultValue ? 0 : 1) : 0);
    setToggled(new Set());
  }, [field]);

  function startCommand(command: GuidedCommand) {
    setSelectedCommand(command);
    setValues({});
    if (command.fields.length === 0) {
      setConfirmArgv(buildArgv(command, {}));
      setScreen('confirm');
    } else {
      setFieldIndex(0);
      setScreen('wizard');
    }
  }

  function advanceField(value: unknown) {
    if (!selectedCommand || !field) return;
    const nextValues = { ...values, [field.key]: value };
    setValues(nextValues);

    if (fieldIndex + 1 < selectedCommand.fields.length) {
      setFieldIndex(fieldIndex + 1);
    } else {
      setConfirmArgv(buildArgv(selectedCommand, nextValues));
      setScreen('confirm');
    }
  }

  function goBack() {
    if (fieldIndex === 0) {
      setScreen('menu');
      setSelectedCommand(undefined);
    } else {
      setFieldIndex(fieldIndex - 1);
    }
  }

  async function runSelectedCommand() {
    setRunning(true);
    await run(confirmArgv);
    setRunning(false);
    setScreen('menu');
    setSelectedCommand(undefined);
  }

  useInput((input, key) => {
    if (running) return;

    if (screen === 'menu') {
      if (key.escape) {
        exit();
        return;
      }
      if (key.upArrow) setMenuIndex(current => nextSelectableIndex(menuRows, current, -1));
      if (key.downArrow) setMenuIndex(current => nextSelectableIndex(menuRows, current, 1));
      if (key.return) {
        const row = menuRows[menuIndex];
        if (row?.command) startCommand(row.command);
      }
      return;
    }

    if (screen === 'wizard' && field) {
      if (key.escape) {
        goBack();
        return;
      }

      if (field.kind === 'text') return; // TextInput handles typing + submit

      if (key.upArrow) setChoiceIndex(current => nextSelectableIndex(choiceRows(field), current, -1));
      if (key.downArrow) setChoiceIndex(current => nextSelectableIndex(choiceRows(field), current, 1));
      if (field.kind === 'multiselect' && input === ' ') {
        setToggled(current => toggleSelection(current, choiceIndex));
      }
      if (key.return) {
        if (field.kind === 'boolean') advanceField(choiceIndex === 0);
        else if (field.kind === 'select') advanceField(field.choices?.[choiceIndex]);
        else if (field.kind === 'multiselect') {
          const options = field.choices ?? [];
          advanceField([...toggled].map(i => options[i]).filter((v): v is string => Boolean(v)));
        }
      }
      return;
    }

    if (screen === 'confirm') {
      if (key.escape) {
        setScreen('wizard');
        if (selectedCommand) setFieldIndex(Math.max(0, selectedCommand.fields.length - 1));
        return;
      }
      if (key.return) void runSelectedCommand();
    }
  });

  if (screen === 'confirm') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Run this command?</Text>
        <Text color="cyan">ctxhub {confirmArgv.join(' ')}</Text>
        <Box marginTop={1}>
          <Text color="gray">{running ? 'running...' : 'enter run · esc edit'}</Text>
        </Box>
      </Box>
    );
  }

  if (screen === 'wizard' && selectedCommand && field) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>
          {selectedCommand.path} <Text color="gray">({fieldIndex + 1}/{selectedCommand.fields.length})</Text>
        </Text>
        <Text>{field.label}{field.required ? ' (required)' : ''}</Text>
        <Box marginTop={1}>
          {field.kind === 'text' ? (
            <Box>
              <Text color="cyan">{'> '}</Text>
              <TextInput value={textValue} onChange={setTextValue} onSubmit={value => advanceField(value)} />
            </Box>
          ) : field.kind === 'boolean' ? (
            <SelectList items={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]} selectedIndex={choiceIndex} />
          ) : (
            <SelectList
              items={(field.choices ?? []).map(choice => ({ key: choice, label: choice }))}
              selectedIndex={choiceIndex}
              markerFor={
                field.kind === 'multiselect'
                  ? (_item, index) => (toggled.has(index) ? '[x] ' : '[ ] ')
                  : undefined
              }
            />
          )}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">
            {field.kind === 'text'
              ? 'enter confirm · esc back'
              : field.kind === 'multiselect'
                ? '↑/↓ move · space toggle · enter confirm · esc back'
                : '↑/↓ move · enter confirm · esc back'}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>ctxhub — guided menu</Text>
      <Box>
        <Text color="cyan">{'> '}</Text>
        <TextInput value={filter} onChange={setFilter} placeholder="type to filter commands..." />
      </Box>
      <Box marginTop={1}>
        <SelectList items={menuRows} selectedIndex={menuIndex} />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑/↓ move · enter select · esc quit</Text>
      </Box>
    </Box>
  );
}

function choiceRows(field: GuidedField): SelectListItem[] {
  if (field.kind === 'boolean') return [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }];
  return (field.choices ?? []).map(choice => ({ key: choice, label: choice }));
}
