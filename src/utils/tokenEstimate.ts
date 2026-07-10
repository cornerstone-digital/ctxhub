// Rough token estimate (chars/4) for workspace text -- not a real tokenizer, but good
// enough as a directional signal for the usage-stats savings numbers, without adding a
// tokenizer dependency for what's meant to be a heuristic, not exact accounting.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
