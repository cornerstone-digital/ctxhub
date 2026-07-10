import { spawn } from 'node:child_process';

// A cross-platform desktop notification, shelling out to whatever the OS already provides --
// same "no new dependency, reuse platform tools" pattern as report.ts's openReportCommand.
// Best-effort only: if the platform tool isn't installed (e.g. notify-send missing on a minimal
// Linux box), this silently no-ops rather than failing the command that triggered it. A desktop
// notification is a nice-to-have, never something indexing/watch should treat as load-bearing.
export function notify(title: string, message: string, platform: NodeJS.Platform = process.platform): void {
  const { command, args } = notifyCommand(title, message, platform);
  if (!command) return;

  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  // Swallow spawn failures (e.g. ENOENT when the platform tool isn't installed) instead of
  // letting an unhandled 'error' event crash the process that only wanted to send a notification.
  child.on('error', () => {});
  child.unref();
}

export function notifyCommand(title: string, message: string, platform: NodeJS.Platform): { command?: string; args: string[] } {
  if (platform === 'darwin') {
    return { command: 'osascript', args: ['-e', `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`] };
  }
  if (platform === 'linux') {
    return { command: 'notify-send', args: [title, message] };
  }
  // Windows has no single reliably-preinstalled CLI notification tool (toast notifications need
  // an app identity most CLI-launched scripts don't have) -- a documented no-op beats a
  // half-working notification here.
  return { args: [] };
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
