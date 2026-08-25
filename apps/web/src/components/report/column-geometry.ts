/**
 * Shared geometry for the two column panels, so `CREATED VS DONE PER WEEK` and
 * `BACKLOG AT EACH WEEK END` land on the same x-axis rather than approximately
 * on it. Both panels lay their weeks out with these three numbers and nothing
 * else, which is what makes the vertical alignment structural.
 *
 * These are **numbers**, reaching the DOM through the `style` attribute. They are
 * never interpolated into a class name: Tailwind v4 scans source text, so a
 * built-at-runtime `w-[NNpx]` matches nothing in source, generates no CSS, and
 * would silently zero every column in both panels at once.
 */
export const COLUMN_GEOMETRY = {
  /**
   * Widest one week's slot may draw. Slots share the panel width evenly and stop
   * growing here, so 4 weeks do not become four fat blocks and 52 weeks still fit
   * without a horizontal scrollbar — which would let the two panels scroll apart.
   */
  slotMaxWidth: 64,
  /** Gap between week slots. */
  gap: 6,
  /** Tallest a bar may draw, in pixels. */
  plotHeight: 132,
} as const;

/** One week's slot: equal share of the row, capped, never below a visible sliver. */
export const SLOT_STYLE = {
  flex: '1 1 0',
  minWidth: 8,
  maxWidth: COLUMN_GEOMETRY.slotMaxWidth,
} as const;

/**
 * Bar height as a fraction of the panel's tallest value. The max is floored at 1
 * so a range with nothing in it draws empty bars instead of dividing by zero.
 */
export function barHeight(value: number, max: number): number {
  return (value / Math.max(1, max)) * COLUMN_GEOMETRY.plotHeight;
}
