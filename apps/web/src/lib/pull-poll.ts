import { ApiRequestError, fetchPullStatus } from '@/lib/api';
import type { PullSummary } from '@/types';

export type FollowPullOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
};

/** Long enough for a slow database read, short enough to notice a dead socket. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Polls until the pull stops running, or until `timeoutMs` gives up on it.
 * Resolves with the last summary seen — still `running` means it gave up,
 * not that it failed. A 401 or three consecutive request failures propagate.
 *
 * Each request carries its own deadline, because the cap is only checked
 * between ticks: without one, a socket that opens and then never answers would
 * park the loop for good and leave the button saying "Pulling…" forever.
 */
export async function followPull(options: FollowPullOptions = {}): Promise<PullSummary | null> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  // Never longer than the whole follow is allowed to take.
  const requestTimeoutMs =
    options.requestTimeoutMs ?? Math.min(DEFAULT_REQUEST_TIMEOUT_MS, timeoutMs);
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  let lastSummary: PullSummary | null = null;

  while (true) {
    try {
      lastSummary = await fetchPullStatus(requestTimeoutMs);
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
