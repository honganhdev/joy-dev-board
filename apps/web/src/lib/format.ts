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
