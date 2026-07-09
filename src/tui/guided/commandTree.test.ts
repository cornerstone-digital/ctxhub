import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Argument, Command, Option } from 'commander';
import { buildArgv, extractGuidedCommands, type GuidedCommand } from './commandTree.js';
import { buildProgram } from '../../cli/program.js';

function findCommand(commands: GuidedCommand[], path: string): GuidedCommand {
  const command = commands.find(c => c.path === path);
  assert.ok(command, `expected to find guided command for "${path}"`);
  return command as GuidedCommand;
}

test('extractGuidedCommands builds a leaf command with a required text argument and a boolean option', () => {
  const program = new Command();
  program
    .command('thing')
    .description('Do a thing')
    .argument('<name>', 'Thing name')
    .option('-f, --force', 'Overwrite')
    .action(() => undefined);

  const [command] = extractGuidedCommands(program);
  assert.equal(command.path, 'thing');
  assert.equal(command.description, 'Do a thing');
  assert.equal(command.category, 'Other');

  const nameField = command.fields.find(f => f.key === 'name');
  assert.equal(nameField?.kind, 'text');
  assert.equal(nameField?.required, true);
  assert.equal(nameField?.isOption, false);

  const forceField = command.fields.find(f => f.key === 'force');
  assert.equal(forceField?.kind, 'boolean');
  assert.equal(forceField?.isOption, true);
  assert.equal(forceField?.flag, '--force');
});

test('extractGuidedCommands recurses into group commands and joins the path', () => {
  const program = new Command();
  const group = program.command('repo').description('group');
  group.command('add').argument('<name>').argument('<path>').action(() => undefined);

  const [command] = extractGuidedCommands(program);
  assert.equal(command.path, 'repo add');
});

test('extractGuidedCommands marks variadic + choices arguments as multiselect, plain variadic as text', () => {
  const program = new Command();
  program
    .command('withChoices')
    .addArgument(new Argument('[agents...]', 'Agents').choices(['claude', 'codex']))
    .action(() => undefined);
  program
    .command('withoutChoices')
    .argument('[tags...]', 'Tags')
    .action(() => undefined);

  const commands = extractGuidedCommands(program);
  const withChoices = findCommand(commands, 'withChoices');
  assert.equal(withChoices.fields[0].kind, 'multiselect');
  assert.deepEqual(withChoices.fields[0].choices, ['claude', 'codex']);

  const withoutChoices = findCommand(commands, 'withoutChoices');
  assert.equal(withoutChoices.fields[0].kind, 'text');
  assert.equal(withoutChoices.fields[0].variadic, true);
});

test('extractGuidedCommands marks a non-variadic choices option as select', () => {
  const program = new Command();
  program
    .command('withAgentOption')
    .addOption(new Option('--fix-agent <name>', 'Agent').choices(['claude', 'codex']))
    .action(() => undefined);

  const [command] = extractGuidedCommands(program);
  const field = command.fields.find(f => f.key === 'fixAgent');
  assert.equal(field?.kind, 'select');
  assert.deepEqual(field?.choices, ['claude', 'codex']);
});

test('extractGuidedCommands excludes mcp from the menu', () => {
  const program = new Command();
  program.command('mcp').description('server').action(() => undefined);
  program.command('doctor').description('health').action(() => undefined);

  const commands = extractGuidedCommands(program);
  assert.ok(!commands.some(c => c.path === 'mcp'));
  assert.ok(commands.some(c => c.path === 'doctor'));
});

test('extractGuidedCommands against the real ctxhub program: every top-level command has a category, mcp is excluded', () => {
  const commands = extractGuidedCommands(buildProgram());
  assert.ok(commands.length > 10);
  assert.ok(!commands.some(c => c.path === 'mcp' || c.path.startsWith('mcp ')));

  const uncategorized = commands.filter(c => c.category === 'Other');
  assert.deepEqual(uncategorized, [], `expected no uncategorized commands, got: ${uncategorized.map(c => c.path).join(', ')}`);
});

test('buildArgv emits the path, required args, and toggled boolean flags', () => {
  const command: GuidedCommand = {
    path: 'repo hook',
    description: '',
    category: 'Repositories',
    fields: [
      { key: 'name', label: 'Repository name', kind: 'text', required: true, variadic: false, isOption: false },
      { key: 'force', label: 'Overwrite', kind: 'boolean', required: false, variadic: false, isOption: true, flag: '--force' }
    ]
  };

  assert.deepEqual(buildArgv(command, { name: 'my-repo', force: false }), ['repo', 'hook', 'my-repo']);
  assert.deepEqual(buildArgv(command, { name: 'my-repo', force: true }), ['repo', 'hook', 'my-repo', '--force']);
});

test('buildArgv skips optional values that match their default', () => {
  const command: GuidedCommand = {
    path: 'search',
    description: '',
    category: 'Search & Context',
    fields: [
      { key: 'query', label: 'Query', kind: 'text', required: false, variadic: false, isOption: false },
      { key: 'limit', label: 'Limit', kind: 'text', required: false, variadic: false, isOption: true, flag: '--limit', defaultValue: '5' }
    ]
  };

  assert.deepEqual(buildArgv(command, { query: '', limit: '5' }), ['search', '--interactive']);
  assert.deepEqual(buildArgv(command, { query: 'auth', limit: '20' }), ['search', 'auth', '--limit', '20', '--interactive']);
});

test('buildArgv emits multiselect values as trailing positional args or repeated option values', () => {
  const argCommand: GuidedCommand = {
    path: 'skills install',
    description: '',
    category: 'Agents & Skills',
    fields: [
      { key: 'agents', label: 'Agents', kind: 'multiselect', required: false, variadic: true, isOption: false, choices: ['claude', 'codex'] }
    ]
  };
  assert.deepEqual(buildArgv(argCommand, { agents: ['claude'] }), ['skills', 'install', 'claude']);
  assert.deepEqual(buildArgv(argCommand, { agents: [] }), ['skills', 'install']);
});
