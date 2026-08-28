/**
 * Board geometry — the one place that knows the board's size and how new
 * cards find a home.
 *
 * Coordinates are board-relative pixels: (0,0) is the board's top-left
 * corner INSIDE the scrolled content (not the viewport). The board is a
 * fixed, bounded canvas — 2400×1600 — large enough for a full trip, small
 * enough that "scroll to find things" never happens.
 *
 * Two jobs live here:
 *
 * 1. clamping — every write (human drag or agent tool) is clamped to the
 *    board bounds server-side, so nobody can fling a card into the void;
 * 2. default placement — place_on_board works without x/y: the server scans
 *    a working region left-to-right, top-to-bottom for the first slot that
 *    doesn't collide with an existing card. The agent should think about the
 *    trip, not layout math.
 */

export const BOARD_WIDTH = 2400;
export const BOARD_HEIGHT = 1600;

/** Approximate card footprint used for collision + clamping (px). */
export const CARD_WIDTH = 232;
export const CARD_HEIGHT = 168;

/** Gutter between cards in the default-placement grid (px). */
export const CARD_GUTTER = 24;

/** The default-placement scan starts here and stays in this region (px). */
const SCAN_ORIGIN = { x: 48, y: 48 };
const SCAN_WIDTH = 1440;
const SCAN_HEIGHT = 960;

export type Point = { x: number; y: number };

/** Pull a point back inside the board so a card's top-left is always valid. */
export function clampPosition(point: Point): Point {
  return {
    x: Math.min(Math.max(point.x, 0), BOARD_WIDTH - CARD_WIDTH),
    y: Math.min(Math.max(point.y, 0), BOARD_HEIGHT - CARD_HEIGHT),
  };
}

/** True when two card rects (top-left + approx size) overlap. */
function rectsOverlap(a: Point, b: Point): boolean {
  return (
    a.x < b.x + CARD_WIDTH &&
    a.x + CARD_WIDTH > b.x &&
    a.y < b.y + CARD_HEIGHT &&
    a.y + CARD_HEIGHT > b.y
  );
}

/**
 * First free slot in the working region, scanning columns left-to-right,
 * rows top-to-bottom. Deterministic — the same board state always yields the
 * same next slot, so repeated placements cascade down the board instead of
 * stacking. If the working region fills up, fall back to a staggered
 * position past the scan area (still clamped).
 */
export function nextOpenPosition(occupied: Point[]): Point {
  const stepX = CARD_WIDTH + CARD_GUTTER;
  const stepY = CARD_HEIGHT + CARD_GUTTER;

  for (let y = SCAN_ORIGIN.y; y <= SCAN_ORIGIN.y + SCAN_HEIGHT - CARD_HEIGHT; y += stepY) {
    for (let x = SCAN_ORIGIN.x; x <= SCAN_ORIGIN.x + SCAN_WIDTH - CARD_WIDTH; x += stepX) {
      const candidate = { x, y };
      if (!occupied.some((p) => rectsOverlap(candidate, p))) {
        return candidate;
      }
    }
  }

  // Working region full — cascade down the right edge, staggered so cards
  // remain visible rather than perfectly stacked.
  const overflowIndex = Math.max(0, occupied.length);
  return clampPosition({
    x: SCAN_ORIGIN.x + SCAN_WIDTH + (overflowIndex % 3) * stepX,
    y: SCAN_ORIGIN.y + Math.floor(overflowIndex / 3) * stepY,
  });
}
