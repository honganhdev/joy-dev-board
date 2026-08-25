import type { Db } from './db/client';
import { sweepInterruptedPulls } from './db/sync';

/** Sweeps state that can only belong to the previous API process. */
export function bootstrap(db: Db): number {
  const swept = sweepInterruptedPulls(db);
  if (swept > 0) {
    console.log(`[joy-dev-board api] swept ${swept} pull(s) interrupted by a restart`);
  }
  return swept;
}
