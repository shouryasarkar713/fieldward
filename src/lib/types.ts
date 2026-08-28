/**
 * Shared DTO types used by the API routes, the client stores, and the WebMCP
 * tools. Money is integers in cents everywhere; `*Display` fields carry a
 * pre-formatted string so LLM agents get human-readable values too.
 *
 * Board positions (x, y) are board-relative pixels — see board-geometry.ts.
 */

export const CATEGORIES = ["Backpacks", "Footwear", "Shelter", "Cook Gear"] as const;
export type Category = (typeof CATEGORIES)[number];

export const ADDED_BY = ["human", "agent"] as const;
export type AddedBy = (typeof ADDED_BY)[number];

export const ITEM_TYPES = ["gear", "day"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type GearItemDTO = {
  id: string;
  name: string;
  description: string;
  /** Reference price in cents — feeds the board's budget roll-up. */
  price: number;
  priceDisplay: string;
  category: Category | string;
  tags: string[];
  imageUrl: string;
  /** Flavor text, e.g. "In stock", "Low stock — 3 left", "Waitlist until March". */
  availability: string;
  /** True when the item can realistically be had before a near-term trip. */
  available: boolean;
};

export type BoardItemDTO = {
  /** The board item id (used for move/remove), distinct from gearItemId. */
  id: string;
  itemType: ItemType;
  /** Set for gear cards; null for day blocks. */
  gearItemId: string | null;
  name: string;
  imageUrl: string | null;
  /** Gear category — lets the readiness check work straight off board items. */
  category: string | null;
  /** Gear tags at read time. */
  tags: string[];
  /** Unit price in cents, snapshotted from the gear item at read time. */
  unitPrice: number | null;
  priceDisplay: string | null;
  quantity: number;
  addedBy: AddedBy;
  /** Optional first-person reasoning left by the agent when it placed this. */
  note: string | null;
  x: number;
  y: number;
  /** Day blocks only: short title, e.g. "Day 1 — Cairn Lake". */
  label: string | null;
  /** Day blocks only: segment notes, e.g. "6 mi · 1,900 ft gain". */
  text: string | null;
  createdAt: string;
};

export type BoardSummary = {
  items: BoardItemDTO[];
  /** Total number of gear cards (day blocks don't count). */
  itemCount: number;
  /** Sum of unitPrice × quantity across gear cards, in cents. */
  gearTotalCents: number;
  gearTotalDisplay: string;
  /** True while the human has locked this plan — the board is read-only. */
  locked: boolean;
  /** The agent's pending day-order suggestion, when one awaits the human's call. */
  pendingDayOrder: DayOrderProposal | null;
};

/** A pending agent suggestion for the trip brief — never applied until accepted. */
export type TripBriefProposal = {
  tripDescription?: string;
  /** Budget in cents; null means the proposal clears the budget. */
  budget: number | null;
};

/**
 * A pending agent suggestion for the order of the human's day blocks — the
 * same accept/dismiss mechanism as brief proposals, applied to a second
 * domain. orderedBoardItemIds is the FULL proposed sequence: every day block
 * on the board, in the order the agent thinks the days should run.
 */
export type DayOrderProposal = {
  orderedBoardItemIds: string[];
  /** Optional first-person reasoning shown with the suggestion. */
  note: string | null;
};

export type TripBriefDTO = {
  tripDescription: string;
  /** Budget in cents, null when unset. */
  budget: number | null;
  /** Budget in dollars — the unit agents and the UI speak. */
  budgetDollars: number | null;
  budgetDisplay: string | null;
  /** Free-text place name, e.g. "Rocky Mountain National Park". */
  location: string | null;
  /** First trip day, "YYYY-MM-DD", null when unset. */
  startDate: string | null;
  /** Last trip day, "YYYY-MM-DD", null when unset. */
  endDate: string | null;
  updatedBy: AddedBy;
  updatedAt: string;
  /** Set when the human has locked the plan; ISO timestamp. */
  lockedAt: string | null;
  /** The agent's pending suggestion, when one awaits the human's call. */
  pendingProposal: TripBriefProposal | null;
};

/** One row of the shared activity log — written by both human and agent paths. */
export type ActivityEventDTO = {
  id: string;
  actor: AddedBy;
  /** Machine-y verb, e.g. "view_gear", "place_gear", "tool:place_on_board". */
  action: string;
  /** Short human-readable line, e.g. "Agent placed Trail Runner Boots". */
  detail: string;
  /** ISO timestamp. */
  at: string;
};

/* ── Weather outlook (see src/lib/weather.ts for the logic) ──────────────── */

/** Which of the three honest weather states an outlook is in. */
export type WeatherDataSource = "forecast" | "historical-average" | "unavailable";

/** One day of an outlook. precipChancePct is forecast-only (null otherwise). */
export type WeatherDay = {
  /** "YYYY-MM-DD" — the trip day this entry describes. */
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipSumMm: number;
  /** Forecast-only precipitation probability; null for historical averages. */
  precipChancePct: number | null;
  /** Short condition label, e.g. "Clear", "Rain showers" (forecast-only). */
  condition: string | null;
};

export type WeatherOutlook =
  | {
      dataSource: "forecast";
      location: { name: string; region: string | null; country: string | null };
      dateRange: { start: string; end: string };
      days: WeatherDay[];
      summary: string;
    }
  | {
      dataSource: "historical-average";
      location: { name: string; region: string | null; country: string | null };
      dateRange: { start: string; end: string };
      days: WeatherDay[];
      summary: string;
      /** How many past years went into the average (honesty about the guess). */
      sampledYears: number;
    }
  | {
      dataSource: "unavailable";
      reason: string;
    };

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function isAddedBy(value: unknown): value is AddedBy {
  return typeof value === "string" && (ADDED_BY as readonly string[]).includes(value);
}

export function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value);
}
