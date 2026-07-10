import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyCommand } from './notify.js';

test('notifyCommand builds an osascript display-notification call on macOS', () => {
  const result = notifyCommand('ctxhub', 'Indexed 3 files', 'darwin');
  assert.equal(result.command, 'osascript');
  assert.deepEqual(result.args, ['-e', 'display notification "Indexed 3 files" with title "ctxhub"']);
});

test('notifyCommand escapes double quotes and backslashes for AppleScript, not shell-interpolated', () => {
  const result = notifyCommand('ctxhub', 'said "hello" and used a \\ backslash', 'darwin');
  assert.equal(result.args[1], 'display notification "said \\"hello\\" and used a \\\\ backslash" with title "ctxhub"');
});

test('notifyCommand builds a notify-send call on Linux', () => {
  const result = notifyCommand('ctxhub', 'Indexed 3 files', 'linux');
  assert.deepEqual(result, { command: 'notify-send', args: ['ctxhub', 'Indexed 3 files'] });
});

test('notifyCommand is a documented no-op on platforms without a reliable CLI notifier', () => {
  const result = notifyCommand('ctxhub', 'Indexed 3 files', 'win32');
  assert.equal(result.command, undefined);
});
