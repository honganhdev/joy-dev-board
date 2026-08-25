import { ApiRequestError, fetchPullStatus } from '@/lib/api';
import type { PullSummary } from '@/types';

export type FollowPullOptions = { intervalMs?: number; timeoutMs?: number };

/**
 * Polls until the pull stops running, or until `timeoutMs` gives up on it.
 * Resolves with the last summary seen — still `running` means it gave up,
 * not that it failed. A 401 or three consecutive request failures propagate.
 */
export async function followPull(options: FollowPullOptions = {}): Promise<PullSummary | null> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  let lastSummary: PullSummary | null = null;

  while (true) {
    try {
      lastSummary = await fetchPullStatus();
      consecutiveFailures = 0;
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) throw cause;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) throw cause;
    }

    if (consecutiveFailures === 0 && (lastSummary === null || lastSummary.status !== 'running')) {
      return lastSummary;
    }
    if (Date.now() - startedAt >= timeoutMs) return lastSummary;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
