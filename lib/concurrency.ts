/**
 * A bulkhead: caps how many tasks run at once and sheds the rest immediately
 * rather than queueing them.
 *
 * Shedding is the point. Queueing would keep every caller waiting and still
 * hold their payloads in memory, which is the resource being protected — a
 * fast "try again" is more useful than a slow success.
 *
 * The counter lives in one process, so this protects a single instance from
 * concurrent load. It is not rate limiting: a distributed flood needs a shared
 * store and belongs at the edge.
 */

export class TooBusyError extends Error {
  constructor(limit: number) {
    super(`Already running ${limit} tasks`);
    this.name = "TooBusyError";
  }
}

export type Bulkhead = <T>(task: () => Promise<T>) => Promise<T>;

export function createBulkhead(limit: number): Bulkhead {
  if (limit < 1) throw new Error("Bulkhead limit must be at least 1");

  let inFlight = 0;

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (inFlight >= limit) throw new TooBusyError(limit);

    inFlight += 1;
    try {
      return await task();
    } finally {
      inFlight -= 1;
    }
  };
}
