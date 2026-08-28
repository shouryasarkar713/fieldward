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

/** Y coordinate boundary dividing the "Already have" (top) and "Need to get" (bottom) zones. */
export const OWNED_ZONE_BOUNDARY_Y = 380;

/** Scan origins for the two zones */
export const OWNED_SCAN_ORIGIN = { x: 48, y: 72 };
export const NEEDED_SCAN_ORIGIN = { x: 48, y: 440 };
export const SCAN_WIDTH = 1800;

export type Point = { x: number; y: number };

/** Pull a point back inside the board so a card's top-left is always valid. */
export function clampPosition(point: Point): Point {
  return {
    x: Math.min(Math.max(point.x, 0), BOARD_WIDTH - CARD_WIDTH),
    y: Math.min(Math.max(point.y, 0), BOARD_HEIGHT - CARD_HEIGHT),
  };
}

/** Determine ownership based on board Y coordinate */
export function getOwnershipFromY(y: number): "owned" | "needed" {
  return y < OWNED_ZONE_BOUNDARY_Y ? "owned" : "needed";
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
 * Scan for an open slot within the "Already have" (top) zone.
 */
export function nextOpenOwnedPosition(occupied: Point[]): Point {
  const stepX = CARD_WIDTH + CARD_GUTTER;
  const stepY = CARD_HEIGHT + CARD_GUTTER;

  for (let y = OWNED_SCAN_ORIGIN.y; y <= OWNED_ZONE_BOUNDARY_Y - CARD_HEIGHT; y += stepY) {
    for (let x = OWNED_SCAN_ORIGIN.x; x <= OWNED_SCAN_ORIGIN.x + SCAN_WIDTH - CARD_WIDTH; x += stepX) {
      const candidate = { x, y };
      if (!occupied.some((p) => rectsOverlap(candidate, p))) {
        return candidate;
      }
    }
  }

  // Fallback if top lane is crowded: overflow to right of top lane
  return clampPosition({
    x: OWNED_SCAN_ORIGIN.x + (occupied.length % 6) * stepX,
    y: OWNED_SCAN_ORIGIN.y,
  });
}

/**
 * First free slot in the needed/working region (bottom zone).
 */
export function nextOpenPosition(occupied: Point[]): Point {
  const stepX = CARD_WIDTH + CARD_GUTTER;
  const stepY = CARD_HEIGHT + CARD_GUTTER;

  for (let y = NEEDED_SCAN_ORIGIN.y; y <= BOARD_HEIGHT - CARD_HEIGHT - 48; y += stepY) {
    for (let x = NEEDED_SCAN_ORIGIN.x; x <= NEEDED_SCAN_ORIGIN.x + SCAN_WIDTH - CARD_WIDTH; x += stepX) {
      const candidate = { x, y };
      if (!occupied.some((p) => rectsOverlap(candidate, p))) {
        return candidate;
      }
    }
  }

  // Working region full — cascade down
  const overflowIndex = Math.max(0, occupied.length);
  return clampPosition({
    x: NEEDED_SCAN_ORIGIN.x + (overflowIndex % 4) * stepX,
    y: NEEDED_SCAN_ORIGIN.y + Math.floor(overflowIndex / 4) * stepY,
  });
}
