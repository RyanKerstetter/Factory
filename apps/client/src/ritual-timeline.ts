import type { Offering } from '../../../packages/shared/src/index.ts'

// How an altar's ritual is shown over its time (see altar.ts), as fractions of it, 0 to 1: the pedestals' items are drawn
// in one after another up to ITEMS_END, then the barrels' liquid one after another up to LIQUID_END, and the rest is
// the ending, the items closing in and the burst. (With no liquid the items take up to LIQUID_END; with no items the
// liquid starts at once.) The simulation knows nothing of this: only how far through the ritual the altar is.
export const ITEMS_END = 0.55
export const LIQUID_END = 0.8

// When each offering (in the altar's order) is drawn in: its beam from `start` to `end`.
export function offeringWindows(offerings: readonly Offering[]): Array<{ start: number; end: number }> {
  const items = offerings.filter((offering) => offering.item).length
  const liquids = offerings.length - items
  const itemsEnd = liquids === 0 ? LIQUID_END : items === 0 ? 0 : ITEMS_END
  let item = 0
  let liquid = 0
  return offerings.map((offering) => {
    if (offering.item) {
      const span = itemsEnd / items
      return { start: item * span, end: ++item * span }
    }
    const span = (LIQUID_END - itemsEnd) / liquids
    return { start: itemsEnd + liquid * span, end: itemsEnd + ++liquid * span }
  })
}

// How far through being drawn in an offering is at `t`, 0 (not yet) to 1 (done).
export function drawnAt(window: { start: number; end: number }, t: number): number {
  return Math.min(1, Math.max(0, (t - window.start) / Math.max(1e-6, window.end - window.start)))
}
