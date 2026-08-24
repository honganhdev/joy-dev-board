/**
 * In-memory TTL cache over a HelpDesk fetch, so the board does not hit HelpDesk
 * on every page load. Concurrent callers share one in-flight request.
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
