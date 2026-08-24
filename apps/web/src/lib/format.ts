const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Card date: `24 Aug`. Empty string when the ticket has no usable date. */
export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DAY_MONTH.format(date);
}

/** Detail date: `24 Aug 2026, 10:06`. */
export function formatFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : FULL.format(date);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse elapsed time: `3h 20m`, `2d 4h`, `<1m`. Deliberately two units — this
 * is read at a glance, not measured.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return '<1m';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/** How long ago an ISO timestamp was: `3h 20m ago`. */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'never';
  const elapsed = formatDuration(now - at);
  return elapsed === '<1m' ? 'just now' : `${elapsed} ago`;
}
