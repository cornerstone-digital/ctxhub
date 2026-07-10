import { encode as encodeToon } from '@toon-format/toon';

// Any object carrying both `content` (the full indexed chunk) and `snippet` (a short preview)
// only needs the snippet for orientation -- `open_chunk`/`get_file_context` are the explicit,
// documented follow-up for full text, and neither of those responses ever carries a `snippet`
// field, so this check never strips anything from them.
function stripRedundantContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRedundantContent);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const hasBoth = entries.some(([key]) => key === 'content') && entries.some(([key]) => key === 'snippet');
    const next: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      if (hasBoth && key === 'content') continue;
      next[key] = stripRedundantContent(val);
    }
    return next;
  }
  return value;
}

// TOON's sweet spot is uniform arrays of objects (search/architecture results); it's not
// guaranteed to win on deeply nested/mixed shapes (context_pack, memory_status). Rather than
// hardcoding a format per tool, encode both and keep whichever is actually smaller for this
// specific payload.
export function compactEncode(value: unknown): string {
  const stripped = stripRedundantContent(value);
  const json = JSON.stringify(stripped);

  let toon: string | undefined;
  try {
    toon = encodeToon(stripped as never);
  } catch {
    toon = undefined;
  }

  return toon !== undefined && toon.length < json.length ? toon : json;
}
