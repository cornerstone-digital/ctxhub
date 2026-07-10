// Rough token estimate (chars/4) for workspace text -- not a real tokenizer, but good
// enough as a directional signal for the usage-stats savings numbers, without adding a
// tokenizer dependency for what's meant to be a heuristic, not exact accounting.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type TokenBudgetResult<T> = { kept: T[]; droppedIds: string[] };

// Greedily keeps highest-scoring items (assumes `items` is already sorted best-first, as every
// ctxhub search result list is) until `maxTokens` is spent, rather than always shipping every
// item up to a flat count-based `limit` regardless of size. Always keeps at least the first item
// even if it alone exceeds the budget, so a single large chunk never produces an empty result.
export function trimToTokenBudget<T extends { id: string }>(
  items: T[],
  maxTokens: number,
  estimate: (item: T) => number = item => estimateTokens(JSON.stringify(item))
): TokenBudgetResult<T> {
  const kept: T[] = [];
  const droppedIds: string[] = [];
  let used = 0;

  for (const item of items) {
    const cost = estimate(item);
    if (kept.length > 0 && used + cost > maxTokens) {
      droppedIds.push(item.id);
      continue;
    }
    kept.push(item);
    used += cost;
  }

  return { kept, droppedIds };
}
