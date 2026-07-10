import type { Command } from 'commander';

export type FieldKind = 'text' | 'boolean' | 'select' | 'multiselect';

export type GuidedField = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  variadic: boolean;
  choices?: string[];
  defaultValue?: unknown;
  isOption: boolean;
  flag?: string;
};

export type GuidedCommand = {
  path: string;
  description: string;
  category: string;
  fields: GuidedField[];
};

// `mcp` starts a long-running stdio JSON-RPC server meant to be launched by an agent's
// MCP config (claude/codex/copilot), not by a human sitting at this menu -- running it
// here would just hang the terminal. Still fully usable via raw `ctxhub mcp`.
// `menu` is this guided mode's own explicit entry point -- selecting it from within the
// menu would just spawn a nested copy of itself, so it's omitted from its own listing.
const EXCLUDED_COMMANDS = new Set(['mcp', 'menu']);
const EXCLUDED_OPTIONS = new Set(['--plain', '--no-interactive']);

// Keyed by top-level command name only (not full leaf paths) so this stays small and
// doesn't need updating every time a subcommand is added under an existing group.
// Anything not listed here falls into "Other" -- fail-open, so a future new command
// never silently vanishes from the guided menu.
const CATEGORY_BY_TOP_LEVEL: Record<string, string> = {
  init: 'Setup',
  onboard: 'Setup',
  doctor: 'Setup',
  repo: 'Repositories',
  index: 'Index & Sync',
  sync: 'Index & Sync',
  watch: 'Index & Sync',
  search: 'Search & Context',
  pack: 'Search & Context',
  explain: 'Search & Context',
  ask: 'Search & Context',
  replay: 'Search & Context',
  open: 'Search & Context',
  'pr-context': 'Search & Context',
  handoff: 'Search & Context',
  memory: 'Memory',
  stats: 'Memory',
  agent: 'Agents & Skills',
  skills: 'Agents & Skills',
  note: 'Team notes',
  diagram: 'Team notes',
  eval: 'Quality & CI',
  validate: 'Quality & CI',
  graph: 'Quality & CI',
  ci: 'Quality & CI',
  report: 'Reports'
};

export function extractGuidedCommands(program: Command): GuidedCommand[] {
  return program.commands.flatMap(command => walk(command, []));
}

function walk(command: Command, parentNames: string[]): GuidedCommand[] {
  const names = [...parentNames, command.name()];

  if (command.commands.length > 0) {
    return command.commands.flatMap(child => walk(child, names));
  }

  const path = names.join(' ');
  if (EXCLUDED_COMMANDS.has(path)) return [];

  return [
    {
      path,
      description: command.description(),
      category: CATEGORY_BY_TOP_LEVEL[names[0]] ?? 'Other',
      fields: buildFields(command)
    }
  ];
}

function buildFields(command: Command): GuidedField[] {
  const argFields: GuidedField[] = command.registeredArguments.map(arg => {
    const hasChoices = Boolean(arg.argChoices?.length);
    return {
      key: arg.name(),
      label: arg.description || arg.name(),
      kind: fieldKind({ isBoolean: false, variadic: arg.variadic, hasChoices }),
      required: arg.required,
      variadic: arg.variadic,
      choices: arg.argChoices,
      defaultValue: arg.defaultValue,
      isOption: false
    };
  });

  const optionFields: GuidedField[] = command.options.filter(option => !EXCLUDED_OPTIONS.has(option.long ?? '')).map(option => {
    const isBoolean = !option.required && !option.optional && !option.variadic;
    const hasChoices = Boolean(option.argChoices?.length);
    return {
      key: option.attributeName(),
      label: option.description || option.long || option.flags,
      kind: fieldKind({ isBoolean, variadic: option.variadic, hasChoices }),
      required: option.mandatory,
      variadic: option.variadic,
      choices: option.argChoices,
      defaultValue: option.defaultValue,
      isOption: true,
      flag: option.long ?? option.short ?? option.flags
    };
  });

  return [...argFields, ...optionFields];
}

function fieldKind(opts: { isBoolean: boolean; variadic: boolean; hasChoices: boolean }): FieldKind {
  if (opts.isBoolean) return 'boolean';
  if (opts.variadic) return opts.hasChoices ? 'multiselect' : 'text';
  return opts.hasChoices ? 'select' : 'text';
}

// Builds the argv Commander expects (positional args in order, then option flags),
// skipping unchanged-from-default values so the confirmation line stays readable.
// `search` always gets --interactive appended -- the guided menu's "search" entry is
// meant to launch the existing live search TUI, not print-and-return.
export function buildArgv(command: GuidedCommand, values: Record<string, unknown>): string[] {
  const argv = command.path.split(' ');

  for (const field of command.fields) {
    if (field.isOption) continue;
    const value = values[field.key];

    if (field.kind === 'multiselect') {
      argv.push(...toStringArray(value));
      continue;
    }

    const text = toTrimmedString(value);
    if (!text) continue;
    if (!field.required && text === defaultAsString(field.defaultValue)) continue;
    argv.push(text);
  }

  for (const field of command.fields) {
    if (!field.isOption || !field.flag) continue;
    const value = values[field.key];

    if (field.kind === 'boolean') {
      if (value === true) argv.push(field.flag);
      continue;
    }

    if (field.kind === 'multiselect') {
      const selected = toStringArray(value);
      if (selected.length) argv.push(field.flag, ...selected);
      continue;
    }

    const text = toTrimmedString(value);
    if (!text || text === defaultAsString(field.defaultValue)) continue;
    argv.push(field.flag, text);
  }

  if (command.path === 'search') argv.push('--interactive');

  return argv;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function defaultAsString(defaultValue: unknown): string {
  return defaultValue === undefined || defaultValue === null ? '' : String(defaultValue);
}
