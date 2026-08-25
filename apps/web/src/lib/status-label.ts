/**
 * Display names for HelpDesk's raw enum-ish strings (`tsStatus`, `appPlan`,
 * `priority`).
 *
 * None of them is a closed enum — production already carries a dozen `tsStatus`
 * values and HelpDesk adds more without telling anyone. So this humanises by
 * rule rather than by lookup table: an unrecognised value renders as a readable
 * phrase instead of blank or a crash. The raw value stays discoverable in the
 * UI (a `title` on the badge), because that is what a HelpDesk search needs.
 */

/** `dev_fixing` → `Dev fixing`, `advanced_2026` → `Advanced 2026`. `''` if empty. */
export function humanise(raw: string | null | undefined): string {
  const words = (raw ?? '').replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** A status always renders as something — blank would read as "no data". */
export function statusLabel(raw: string | null | undefined): string {
  return humanise(raw) || 'No status';
}
