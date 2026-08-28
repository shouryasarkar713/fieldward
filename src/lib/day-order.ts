/**
 * Day-order logic — pure. A trip's "day order" is not a stored sequence: it
 * is the day blocks' SPATIAL reading order (top-to-bottom, then left-to-right
 * — the same rule the export view uses to turn the board into an itinerary).
 *
 * So applying a proposed order means reassigning positions: the existing
 * positions become "slots" in reading order, and the proposed sequence
 * decides which block occupies which slot. The human's layout shape is
 * preserved exactly — same spots on the canvas — while the sequence the
 * blocks read in becomes the agent's proposal. Cards glide to their new
 * slots with the same transform transitions as any other move, and every
 * consumer of day order (the export itinerary, the banner, the tools) sees
 * the change with zero new plumbing.
 */

export type DaySlotItem = {
  id: string;
  x: number;
  y: number;
  createdAt: Date | string;
};

/** The spatial reading order of a set of day blocks (y, then x, then createdAt for stability). */
export function spatialDayOrder<T extends DaySlotItem>(days: T[]): T[] {
  return [...days].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    const at = (value: Date | string) => (value instanceof Date ? value.getTime() : Date.parse(value));
    return at(a.createdAt) - at(b.createdAt);
  });
}

/**
 * True when orderedIds is a complete ordering of dayIds — every id known, no
 * duplicates, nothing missing. A proposal is always the FULL sequence.
 */
export function isCompletePermutation(orderedIds: string[], dayIds: string[]): boolean {
  if (orderedIds.length !== dayIds.length) return false;
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) return false;
  return dayIds.every((id) => unique.has(id));
}

/**
 * The position updates that apply a proposed order: slot i (in spatial
 * reading order) receives the i-th block of the proposed sequence. Only
 * blocks that actually move are returned.
 */
export function planDayOrderReassignment(
  days: DaySlotItem[],
  orderedIds: string[],
): { id: string; x: number; y: number }[] {
  const slots = spatialDayOrder(days);
  const updates: { id: string; x: number; y: number }[] = [];
  for (let index = 0; index < orderedIds.length && index < slots.length; index++) {
    const slot = slots[index];
    const block = days.find((day) => day.id === orderedIds[index]);
    if (block === undefined) continue;
    if (block.x !== slot.x || block.y !== slot.y) {
      updates.push({ id: block.id, x: slot.x, y: slot.y });
    }
  }
  return updates;
}
