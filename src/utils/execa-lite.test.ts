import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execa } from './execa-lite.js';

test('execa resolves stdout/stderr on a zero exit code', async () => {
  const { stdout } = await execa('node', ['-e', 'process.stdout.write("hello")']);
  assert.equal(stdout, 'hello');
});

test('execa rejects with stderr context on a non-zero exit code', async () => {
  await assert.rejects(
    execa('node', ['-e', 'process.stderr.write("boom"); process.exit(1)']),
    /failed with code 1: boom/
  );
});

test('execa pipes `input` to the child process stdin', async () => {
  const { stdout } = await execa('node', ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'piped text' });
  assert.equal(stdout, 'piped text');
});

test('execa rejects once timeoutMs elapses for a hung process', async () => {
  await assert.rejects(
    execa('node', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 }),
    /timed out after 50ms/
  );
});

test('execa does not time out a process that finishes before timeoutMs', async () => {
  const { stdout } = await execa('node', ['-e', 'process.stdout.write("fast")'], { timeoutMs: 5000 });
  assert.equal(stdout, 'fast');
});
