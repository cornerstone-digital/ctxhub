import type { Ora } from 'ora';
import type { IndexProgressEvent } from '../../indexing/indexer.js';
import { formatFileProgress } from './applyIndexProgress.js';

// Only used to decide whether to also print plain progress lines below -- not a
// TTY-detection duplicate of shouldUseInteractive(), which already decided whether we're
// in this (ora/plain) code path at all. `--plain` can still be requested in a real
// terminal, where ora's animated `.text` updates already work; this adds visibility for
// the case ora can't help with: truly piped/non-TTY output (CI logs, `| tee`, etc.),
// where ora only ever prints its start line and its final succeed() line.
const PLAIN_LOG_THROTTLE_MS = 2000;

// Keeps the plain (non-interactive) spinner responsive during a long index run --
// without this, a large repo just sits on "Indexing workspace knowledge" with no
// feedback until the whole thing finishes.
export function updateSpinnerOnProgress(spinner: Ora, baseText: string): (event: IndexProgressEvent) => void {
  let lastLoggedAt = 0;

  return event => {
    const detail =
      event.type === 'repo-start'
        ? `${event.repo}...`
        : event.type === 'repo-progress'
          ? `${event.repo} — ${formatFileProgress(event.scanned, event.total)}`
          : event.type === 'repo-missing'
            ? `${event.repo} (path missing, skipping)`
            : undefined;

    spinner.text = detail ? `${baseText}: ${detail}` : baseText;

    if (!process.stdout.isTTY && detail) {
      const now = Date.now();
      const isFirst = lastLoggedAt === 0;
      if (isFirst || now - lastLoggedAt >= PLAIN_LOG_THROTTLE_MS) {
        console.log(`${new Date().toISOString()} ${detail}`);
        lastLoggedAt = now;
      }
    }
  };
}
