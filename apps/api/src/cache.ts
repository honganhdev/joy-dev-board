/**
 * In-memory TTL cache over a HelpDesk fetch. Concurrent callers share one
 * in-flight request.
 *
 * Tickets are no longer cached here — SQLite is the cache for those, and a
 * second layer over it would only make staleness harder to reason about. What
 * is left is the tag directory: a HelpDesk-side lookup table that the mirror
 * deliberately does not store, so it still needs somewhere to live between
 * detail views.
 */
export class TtlCache<T> {
  private entry: { value: T; loadedAt: string } | null = null;
  private inFlight: Promise<{ value: T; loadedAt: string }> | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number
  ) {}

  private isFresh(): boolean {
    return this.entry !== null && Date.now() - Date.parse(this.entry.loadedAt) < this.ttlMs;
  }

  /** Cached value when fresh, otherwise a new load. Errors propagate. */
  async get(): Promise<{ value: T; loadedAt: string; fromCache: boolean }> {
    if (this.entry && this.isFresh()) return { ...this.entry, fromCache: true };
    return { ...(await this.refresh()), fromCache: false };
  }

  /** Forces a new load, ignoring the TTL. */
  async refresh(): Promise<{ value: T; loadedAt: string }> {
    // A second caller arriving mid-load waits on the same request instead of
    // starting another round trip to HelpDesk.
    this.inFlight ??= this.load()
      .then((value) => {
        const entry = { value, loadedAt: new Date().toISOString() };
        this.entry = entry;
        return entry;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }
}
