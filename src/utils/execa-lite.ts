import { spawn } from 'node:child_process';

type Options = { cwd?: string };

export function execa(command: string, args: string[], options: Options = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => (stdout += String(data)));
    child.stderr.on('data', data => (stderr += String(data)));

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed with code ${code}: ${stderr}`));
    });
  });
}
