// A small, dependency-free bounded-concurrency batch runner. Indexing's slow per-file work
// (read, hash, chunk, optional LLM summary) is I/O-bound, not CPU-bound, so real OS threads
// (worker_threads) wouldn't help -- Node's event loop already runs concurrent I/O/subprocess
// calls fine without them. This just stops a loop from serializing that I/O behind unnecessary
// per-item awaits, while still processing (and returning) results in input order.
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: boundedLimit }, () => worker()));
  return results;
}
