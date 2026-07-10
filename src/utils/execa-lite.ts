import { spawn } from 'node:child_process';

type Options = { cwd?: string; input?: string; timeoutMs?: number };

export function execa(command: string, args: string[], options: Options = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: [options.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // Bounded one-shot calls (e.g. shelling out to an agent CLI) must not hang the caller
    // forever if the child process never exits on its own.
    const timeout = options.timeoutMs !== undefined
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGTERM');
          reject(new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : undefined;

    if (options.input !== undefined) child.stdin?.end(options.input);

    child.stdout?.on('data', data => (stdout += String(data)));
    child.stderr?.on('data', data => (stderr += String(data)));

    child.on('error', error => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed with code ${code}: ${stderr}`));
    });
  });
}
