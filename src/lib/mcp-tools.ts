"use client";

import { logActivity } from "@/lib/activity";
import { daysBetween } from "@/lib/dates";
import { notifyBoardChanged, notifyBriefChanged } from "@/lib/events";
import { getSessionId } from "@/lib/session";
import { computeTripReadiness, TRIP_ARCHETYPES, type BoardLineLike } from "@/lib/trip-readiness";
import { mergeReadinessWithWeather } from "@/lib/weather";
import type { WeatherOutlook } from "@/lib/types";

/**
 * Fieldward's WebMCP tool surface — registered with the raw
 * `document.modelContext.registerTool(...)` API (no wrapper library).
 *
 * The pivot in tool terms: there is no cart and no checkout here. The board
 * is the shared document, and the agent is a co-editor of it: it can search
 * the gear library, place and arrange cards, annotate its picks with a
 * first-person note, ground itself in the trip brief and a REAL weather
 * outlook, propose (never write) trip-brief changes and day orders, check
 * the plan's readiness, and read the shared activity log.
 *
 * Design rule, central to this demo: agents get tools for everything
 * reversible. Locking the plan is not a tool and never will be — it is a
 * plain button only a human can click (POST /api/brief/lock from an onClick
 * handler). Starting a new plan isn't a tool either. And the two proposal
 * tools (brief updates, day orders) never apply anything themselves — the
 * human accepts or dismisses every consequential suggestion.
 *
 * Every `execute` is wrapped in try/catch and returns
 * `{ success: false, error }` on failure instead of throwing.
 */

export type ToolResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string };

export type WebMCToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
};

export const FIELDWARD_TOOL_NAMES = [
  "search_gear",
  "filter_gear",
  "get_gear_details",
  "compare_gear",
  "place_on_board",
  "mark_item_owned",
  "move_board_item",
  "remove_from_board",
  "get_board_state",
  "get_trip_brief",
  "get_weather_outlook",
  "compare_trip_dates",
  "propose_trip_brief_update",
  "propose_day_block",
  "suggest_day_order",
  "check_trip_readiness",
  "get_activity_log",
] as const;

/** Builds the fourteen Fieldward tool definitions (pure — no DOM registration). */
type Json = Record<string, unknown>;

async function callJsonApi(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Json }> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as Json;
  return { ok: response.ok, status: response.status, data };
}

function apiError(data: Json, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function logToolCall(name: string, input: Record<string, unknown>): void {
  console.log(`[fieldward:mcp] tool executed: ${name}`, input);
}

/**
 * Every successful tool execution lands in the shared ActivityEvent table
 * (action "tool:<name>") — the same log the human's toast strip and the
 * get_activity_log tool read. Non-throwing: logging must never break a tool.
 */
function logAgentAction(tool: string, detail: string): Promise<unknown> {
  return logActivity({ actor: "agent", action: `tool:${tool}`, tool, detail });
}

/** Short excerpt of a note for the activity line. */
function excerpt(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The activity line for a weather fetch — the dataSource is ALWAYS visible in
 * the copy, so the human always knows whether the agent is quoting a real
 * forecast or a seasonal guess.
 */
function weatherLogLine(outlook: WeatherOutlook): string {
  if (outlook.dataSource === "forecast") {
    return `Agent checked the weather — real forecast for ${outlook.location.name}`;
  }
  if (outlook.dataSource === "historical-average") {
    return `Agent checked the weather — historical average for ${outlook.location.name} (trip ${horizonPhrase(outlook.dateRange.start)})`;
  }
  return `Agent checked the weather — not available (${excerpt(outlook.reason, 70)})`;
}

/** "7 weeks away" / "3 months away" phrasing for log copy. */
function horizonPhrase(isoDate: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const days = daysBetween(today, isoDate);
  if (days <= 0) return "already underway";
  if (days < 60) return `${Math.max(1, Math.round(days / 7))} weeks away`;
  return `${Math.max(1, Math.round(days / 30))} months away`;
}

export function buildToolDefinitions(): WebMCToolDefinition[] {
  return [
    {
      name: "search_gear",
      description:
        "Search the Fieldward gear library by free-text query. Matches gear name, description, and tags (e.g. 'waterproof boots', 'ultralight tent'). Returns gear with id, name, price, category, tags, and availability. Ground the query in the trip brief (get_trip_brief): a winter-backpacking trip means terms like 'winter-rated' and 'waterproof' belong in the query, and prefer picks under the stated budget.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text, e.g. 'waterproof hiking boots'" },
          limit: { type: "number", description: "Max results to return (default 10, max 50)" },
        },
        required: ["query"],
      },
      execute: async (input) => {
        logToolCall("search_gear", input);
        try {
          const query = asString(input.query);
          if (query === undefined) {
            return { success: false, error: 'Input "query" (non-empty string) is required.' };
          }
          const limit = asPositiveInt(input.limit) ?? 10;
          const { ok, data } = await callJsonApi(
            `/api/gear/search?q=${encodeURIComponent(query)}&limit=${limit}`,
          );
          if (!ok) return { success: false, error: apiError(data, "Search failed.") };
          await logAgentAction("search_gear", `Agent searched the gear library — “${query}”`);
          return {
            success: true,
            query,
            count: data.count,
            results: data.results,
          };
        } catch (error) {
          console.error("[fieldward:mcp] search_gear failed", error);
          return { success: false, error: "Search request failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "filter_gear",
      description:
        "Filter the Fieldward gear library by category, price range, and/or tags. Categories: 'Backpacks', 'Footwear', 'Shelter', 'Cook Gear'. Prices are in DOLLARS (e.g. minPrice 100, maxPrice 250). A gear item matches when it has ANY of the given tags. When the trip brief (get_trip_brief) has a budget, use it as maxPrice. Combine with search_gear when free text works better.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["Backpacks", "Footwear", "Shelter", "Cook Gear"],
            description: "Restrict results to one category",
          },
          minPrice: { type: "number", description: "Minimum price in dollars (inclusive)" },
          maxPrice: { type: "number", description: "Maximum price in dollars (inclusive)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to match, e.g. ['waterproof', 'winter-rated']. Any match qualifies.",
          },
        },
      },
      execute: async (input) => {
        logToolCall("filter_gear", input);
        try {
          const category = asString(input.category);
          const minPrice = typeof input.minPrice === "number" && Number.isFinite(input.minPrice) ? input.minPrice : undefined;
          const maxPrice = typeof input.maxPrice === "number" && Number.isFinite(input.maxPrice) ? input.maxPrice : undefined;
          const tags = Array.isArray(input.tags) ? input.tags.filter((tag) => typeof tag === "string") : undefined;

          const { ok, data } = await callJsonApi("/api/gear/filter", {
            method: "POST",
            body: JSON.stringify({
              ...(category ? { category } : {}),
              ...(minPrice !== undefined ? { minPrice } : {}),
              ...(maxPrice !== undefined ? { maxPrice } : {}),
              ...(tags ? { tags } : {}),
            }),
          });
          if (!ok) return { success: false, error: apiError(data, "Filter failed.") };

          const bits: string[] = [];
          if (category) bits.push(category.toLowerCase());
          if (minPrice !== undefined || maxPrice !== undefined) {
            bits.push(`${minPrice !== undefined ? `$${minPrice}` : "$0"}–${maxPrice !== undefined ? `$${maxPrice}` : "∞"}`);
          }
          if (tags && tags.length > 0) bits.push(tags.join(" / "));
          await logAgentAction(
            "filter_gear",
            `Agent filtered the gear library — ${bits.length > 0 ? bits.join(", ") : "everything"}`,
          );
          return { success: true, count: data.count, appliedFilters: data.appliedFilters, results: data.results };
        } catch (error) {
          console.error("[fieldward:mcp] filter_gear failed", error);
          return { success: false, error: "Filter request failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "get_gear_details",
      description:
        "Get full details for a single gear item by id: name, description, price, category, tags, image URL, and availability. Use ids returned by search_gear or filter_gear.",
      inputSchema: {
        type: "object",
        properties: {
          gearItemId: { type: "string", description: "The gear item id, e.g. the id from search results" },
        },
        required: ["gearItemId"],
      },
      execute: async (input) => {
        logToolCall("get_gear_details", input);
        try {
          const gearItemId = asString(input.gearItemId);
          if (gearItemId === undefined) {
            return { success: false, error: 'Input "gearItemId" (non-empty string) is required.' };
          }
          const { ok, status, data } = await callJsonApi(`/api/gear/${encodeURIComponent(gearItemId)}`);
          if (!ok) {
            return { success: false, error: apiError(data, status === 404 ? "Gear item not found." : "Lookup failed.") };
          }
          const gear = data.gear as { name?: string } | undefined;
          await logAgentAction(
            "get_gear_details",
            `Agent looked up ${gear?.name ?? "a gear item"}`,
          );
          return { success: true, gear: data.gear };
        } catch (error) {
          console.error("[fieldward:mcp] get_gear_details failed", error);
          return { success: false, error: "Gear lookup failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "compare_gear",
      description:
        "Compare 2 to 4 Fieldward gear items side by side. Pass gear item ids in the order you want them compared; every field (price, tags, availability, description) comes back for each item.",
      inputSchema: {
        type: "object",
        properties: {
          gearItemIds: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 4,
            description: "Two to four gear item ids to compare",
          },
        },
        required: ["gearItemIds"],
      },
      execute: async (input) => {
        logToolCall("compare_gear", input);
        try {
          const gearItemIds = Array.isArray(input.gearItemIds)
            ? input.gearItemIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            : [];
          if (gearItemIds.length < 2 || gearItemIds.length > 4) {
            return { success: false, error: 'Input "gearItemIds" must contain between 2 and 4 gear item ids.' };
          }
          const { ok, status, data } = await callJsonApi("/api/gear/compare", {
            method: "POST",
            body: JSON.stringify({ gearItemIds }),
          });
          if (!ok) {
            return { success: false, error: apiError(data, status === 404 ? "One or more gear items not found." : "Compare failed.") };
          }
          await logAgentAction("compare_gear", `Agent compared ${gearItemIds.length} items side by side`);
          return { success: true, count: data.count, gear: data.gear };
        } catch (error) {
          console.error("[fieldward:mcp] compare_gear failed", error);
          return { success: false, error: "Compare request failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "place_on_board",
      description:
        "Place a gear item from the library onto the shared trip-planning board — the same board the human is looking at. Your placement appears there live, attributed to you. Coordinates are optional board pixels (x: 0–2400, y: 0–1600, origin top-left); omit them and the server picks the next open slot, so you never need layout math. Pass a short first-person `note` so the human sees your reasoning beside the card. Group related gear near the human's day blocks with move_board_item after placing. Note: locking the plan is deliberately not available to agents; only the human can do that.",
      inputSchema: {
        type: "object",
        properties: {
          gearItemId: { type: "string", description: "The gear item id to place (from search_gear / filter_gear)" },
          x: { type: "number", description: "Optional board x position in pixels (0–2400); omit for the next open slot" },
          y: { type: "number", description: "Optional board y position in pixels (0–1600); omit for the next open slot" },
          note: {
            type: "string",
            description:
              "A short first-person reason for this pick, shown to the user beside the card, e.g. 'I picked this over the cheaper option — better rain rating for your trip.'",
          },
        },
        required: ["gearItemId"],
      },
      execute: async (input) => {
        logToolCall("place_on_board", input);
        try {
          const gearItemId = asString(input.gearItemId);
          if (gearItemId === undefined) {
            return { success: false, error: 'Input "gearItemId" (non-empty string) is required.' };
          }
          const note = asString(input.note);
          if (note !== undefined && note.length > 280) {
            return { success: false, error: 'Input "note" must be at most 280 characters.' };
          }
          const x = typeof input.x === "number" && Number.isFinite(input.x) ? input.x : undefined;
          const y = typeof input.y === "number" && Number.isFinite(input.y) ? input.y : undefined;
          if ((x === undefined) !== (y === undefined)) {
            return { success: false, error: 'Provide both "x" and "y", or neither (the server picks a slot).' };
          }

          const { ok, status, data } = await callJsonApi("/api/board/place", {
            method: "POST",
            body: JSON.stringify({
              sessionId: getSessionId(),
              itemType: "gear",
              gearItemId,
              ...(x !== undefined && y !== undefined ? { x, y } : {}),
              // Hardcoded on purpose: the tool call itself is the signal that
              // the agent placed this card — never trust an input field for it.
              addedBy: "agent",
              ...(note !== undefined ? { note } : {}),
            }),
          });
          if (!ok) {
            return {
              success: false,
              error: apiError(
                data,
                status === 404 ? "Gear item not found." : "Couldn't place that on the board.",
              ),
            };
          }
          const item = data.item as { name?: string; x?: number; y?: number } | undefined;
          const noteSuffix = note !== undefined ? ` — “${excerpt(note)}”` : "";
          await logAgentAction(
            "place_on_board",
            `Agent placed ${item?.name ?? "an item"} on the board${noteSuffix}`,
          );
          notifyBoardChanged();
          return { success: true, item: data.item };
        } catch (error) {
          console.error("[fieldward:mcp] place_on_board failed", error);
          return { success: false, error: "Placement failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "mark_item_owned",
      description:
        "Mark a piece of gear that the user already owns (e.g. from a photo of their gear closet or mentioned in chat). Fuzzy-matches against existing catalog gear or registers personal gear. Places it into the 'Already have' lane on the board. Fully satisfies readiness check requirements without consuming the trip's gear acquisition budget.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the owned gear item, e.g. 'Hollowpine 2P Tent' or 'Grandpa's Wool Blanket'" },
          category: {
            type: "string",
            description: "Optional category, e.g. 'Shelter', 'Backpacks', 'Footwear', 'Cook Gear', or 'Other'",
          },
          note: {
            type: "string",
            description: "Optional note or reasoning for this owned item",
          },
        },
        required: ["name"],
      },
      execute: async (input) => {
        logToolCall("mark_item_owned", input);
        try {
          const name = asString(input.name);
          if (name === undefined) {
            return { success: false, error: 'Input "name" (non-empty string) is required.' };
          }
          const category = asString(input.category);
          const note = asString(input.note);
          if (note !== undefined && note.length > 280) {
            return { success: false, error: 'Input "note" must be at most 280 characters.' };
          }

          const { ok, status, data } = await callJsonApi("/api/gear/owned", {
            method: "POST",
            body: JSON.stringify({
              sessionId: getSessionId(),
              name,
              ...(category !== undefined ? { category } : {}),
              ...(note !== undefined ? { note } : {}),
            }),
          });

          if (!ok) {
            return {
              success: false,
              error: apiError(data, "Couldn't mark that item as owned on the board."),
            };
          }

          const item = data.item as { name?: string } | undefined;
          const matchedExisting = Boolean(data.matchedExisting);
          const detail = matchedExisting
            ? `Agent marked ${item?.name ?? name} as already owned (matched catalog item)`
            : `Agent added personal owned gear: ${name}`;

          await logAgentAction("mark_item_owned", detail);
          notifyBoardChanged();
          return {
            success: true,
            item: data.item,
            matchedExisting,
            ownership: "owned",
            note: "Placed in 'Already have' zone. Satisfies readiness requirements with $0 budget impact.",
          };
        } catch (error) {
          console.error("[fieldward:mcp] mark_item_owned failed", error);
          return { success: false, error: "Marking owned item failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "move_board_item",
      description:
        "Move a card that's already on the board — yours or the human's — to a new position. Coordinates are board pixels (x: 0–2400, y: 0–1600, origin top-left, clamped to the board). Use it to arrange the plan: group cook gear under the Day 2 block, line up shelter options together, tidy after the human drags things around. The card animates to its new spot on the human's screen, exactly like their own drags.",
      inputSchema: {
        type: "object",
        properties: {
          boardItemId: { type: "string", description: "The board item id to move (from get_board_state)" },
          x: { type: "number", description: "New board x position in pixels (0–2400)" },
          y: { type: "number", description: "New board y position in pixels (0–1600)" },
        },
        required: ["boardItemId", "x", "y"],
      },
      execute: async (input) => {
        logToolCall("move_board_item", input);
        try {
          const boardItemId = asString(input.boardItemId);
          if (boardItemId === undefined) {
            return { success: false, error: 'Input "boardItemId" (non-empty string) is required.' };
          }
          const x = typeof input.x === "number" && Number.isFinite(input.x) ? input.x : undefined;
          const y = typeof input.y === "number" && Number.isFinite(input.y) ? input.y : undefined;
          if (x === undefined || y === undefined) {
            return { success: false, error: 'Inputs "x" and "y" (finite numbers) are required.' };
          }

          const { ok, status, data } = await callJsonApi("/api/board/move", {
            method: "POST",
            body: JSON.stringify({ boardItemId, x, y }),
          });
          if (!ok) {
            return {
              success: false,
              error: apiError(data, status === 404 ? "Board item not found." : "Couldn't move that card."),
            };
          }
          const item = data.item as { name?: string; itemType?: string; label?: string } | undefined;
          const what =
            item?.itemType === "day" ? `the ${item?.label ?? "day"} block` : item?.name ?? "a card";
          await logAgentAction("move_board_item", `Agent moved ${what}`);
          notifyBoardChanged();
          return { success: true, item: data.item };
        } catch (error) {
          console.error("[fieldward:mcp] move_board_item failed", error);
          return { success: false, error: "Move failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "remove_from_board",
      description:
        "Remove one card from the board by board item id — the `id` field from get_board_state (not the gear item id). Works on your cards and the human's. The activity log records the removal either way, so the human always sees what changed.",
      inputSchema: {
        type: "object",
        properties: {
          boardItemId: { type: "string", description: "The board item id to remove (from get_board_state)" },
        },
        required: ["boardItemId"],
      },
      execute: async (input) => {
        logToolCall("remove_from_board", input);
        try {
          const boardItemId = asString(input.boardItemId);
          if (boardItemId === undefined) {
            return { success: false, error: 'Input "boardItemId" (non-empty string) is required.' };
          }
          const { ok, status, data } = await callJsonApi(
            `/api/board/${encodeURIComponent(boardItemId)}`,
            { method: "DELETE" },
          );
          if (!ok) {
            return {
              success: false,
              error: apiError(data, status === 404 ? "Board item not found." : "Couldn't remove that card."),
            };
          }
          const item = data.item as { name?: string; itemType?: string; label?: string } | undefined;
          const what =
            item?.itemType === "day" ? `the ${item?.label ?? "day"} block` : item?.name ?? "a card";
          await logAgentAction("remove_from_board", `Agent removed ${what} from the board`);
          notifyBoardChanged();
          return { success: true, removed: true, item: data.item };
        } catch (error) {
          console.error("[fieldward:mcp] remove_from_board failed", error);
          return { success: false, error: "Remove request failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "get_board_state",
      description:
        "Read the current board: every card with its position, type (gear or day block), name, quantity, who placed it, and any agent note — plus the gear total, whether the plan is locked, and any pending day-order suggestion awaiting the human's call. Call this before placing or moving so you don't duplicate cards, and to see where the human's day blocks are so you can group gear under them. Day blocks read in board order: top-to-bottom, then left-to-right — the same order the export uses, and the order suggest_day_order proposes changes to.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (input) => {
        logToolCall("get_board_state", input);
        try {
          const sessionId = getSessionId();
          const { ok, data } = await callJsonApi(`/api/board?sessionId=${encodeURIComponent(sessionId)}`);
          if (!ok) return { success: false, error: apiError(data, "Couldn't read the board.") };
          const itemCount = typeof data.itemCount === "number" ? data.itemCount : 0;
          await logAgentAction(
            "get_board_state",
            itemCount > 0 ? `Agent checked the board — ${itemCount} card(s)` : "Agent checked the board — empty",
          );
          return {
            success: true,
            itemCount,
            gearTotalCents: data.gearTotalCents,
            gearTotalDisplay: data.gearTotalDisplay,
            locked: data.locked,
            pendingDayOrder: data.pendingDayOrder ?? null,
            pendingDayBlock: data.pendingDayBlock ?? null,
            items: data.items,
          };
        } catch (error) {
          console.error("[fieldward:mcp] get_board_state failed", error);
          return { success: false, error: "Board read failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "get_trip_brief",
      description:
        "Read the trip brief — what kind of trip the human is planning, their budget (or null when nothing is set), and the trip's place and dates when the human has filled them in. CALL THIS FIRST, before searching or recommending: the trip description suggests which categories and tags matter, the budget should cap maxPrice in filter_gear, the place and dates ground get_weather_outlook, and check_trip_readiness compares the board against all of it. Also returns any pending proposal you've made that the human hasn't resolved yet.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (input) => {
        logToolCall("get_trip_brief", input);
        try {
          const sessionId = getSessionId();
          const { ok, data } = await callJsonApi(`/api/brief?sessionId=${encodeURIComponent(sessionId)}`);
          if (!ok) return { success: false, error: apiError(data, "Couldn't read the trip brief.") };
          const brief = (data.brief ?? null) as Record<string, unknown> | null;
          await logAgentAction(
            "get_trip_brief",
            brief === null ? "Agent checked the trip brief — none set yet" : "Agent checked the trip brief",
          );
          if (brief === null) {
            return {
              success: true,
              brief: null,
              hint: "No trip brief set yet. Ask the human what the trip looks like, or suggest one with propose_trip_brief_update.",
            };
          }
          return { success: true, brief };
        } catch (error) {
          console.error("[fieldward:mcp] get_trip_brief failed", error);
          return { success: false, error: "Trip-brief read failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "get_weather_outlook",
      description:
        "Get the weather outlook for this trip, grounded in real data — not a guess from the trip description. Reads the trip's place and dates straight off the trip brief (the human sets them; get_trip_brief shows what's set) and returns exactly one of three clearly-labeled states: dataSource 'forecast' (a real Open-Meteo daily forecast — only reliable when the trip is within about 16 days), 'historical-average' (the same calendar window averaged over the last few years — the honest answer for trips further out), or 'unavailable' with a reason (place or dates not set yet, place not found, service unreachable). CALL THIS EARLY in a planning session, before searching gear: rain or freezing nights change what belongs on the board, and check_trip_readiness folds this outlook into its gear gaps.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (input) => {
        logToolCall("get_weather_outlook", input);
        try {
          const sessionId = getSessionId();
          const { ok, data } = await callJsonApi(`/api/weather?sessionId=${encodeURIComponent(sessionId)}`);
          if (!ok) return { success: false, error: apiError(data, "Couldn't fetch the weather outlook.") };
          const outlook = (data.outlook ?? null) as WeatherOutlook | null;
          if (outlook === null) {
            return { success: false, error: "The weather outlook came back malformed." };
          }
          await logAgentAction("get_weather_outlook", weatherLogLine(outlook));
          if (outlook.dataSource === "unavailable") {
            return {
              success: true,
              ...outlook,
              hint: /place|dates/i.test(outlook.reason)
                ? "Ask the human to set the trip's place and dates in the brief panel — then call this again."
                : undefined,
            };
          }
          return { success: true, ...outlook };
        } catch (error) {
          console.error("[fieldward:mcp] get_weather_outlook failed", error);
          return { success: false, error: "Weather lookup failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "compare_trip_dates",
      description:
        "Compare 2–3 candidate date ranges for the trip side-by-side without modifying the stored trip brief. Concurrently evaluates live Open-Meteo forecasts (near-term) or historical averages (future) along with readiness gaps for each window independently. Returns a side-by-side preview with honest dataSource labels per range.",
      inputSchema: {
        type: "object",
        properties: {
          dateRanges: {
            type: "array",
            description: "2 or 3 candidate date ranges to compare",
            items: {
              type: "object",
              properties: {
                startDate: { type: "string", description: "First trip day in YYYY-MM-DD format" },
                endDate: { type: "string", description: "Last trip day in YYYY-MM-DD format" },
                label: { type: "string", description: "Optional friendly label, e.g. 'Option A: Early September'" },
              },
              required: ["startDate", "endDate"],
            },
          },
        },
        required: ["dateRanges"],
      },
      execute: async (input) => {
        logToolCall("compare_trip_dates", input);
        try {
          const rawRanges = input.dateRanges;
          if (!Array.isArray(rawRanges) || rawRanges.length < 2 || rawRanges.length > 3) {
            return { success: false, error: 'Input "dateRanges" must be an array of 2 or 3 date ranges.' };
          }

          const sessionId = getSessionId();
          const { ok, data } = await callJsonApi("/api/weather/compare", {
            method: "POST",
            body: JSON.stringify({
              sessionId,
              dateRanges: rawRanges,
            }),
          });

          if (!ok) {
            return { success: false, error: apiError(data, "Couldn't compare candidate trip dates.") };
          }

          const comparisons = (Array.isArray(data.comparisons) ? data.comparisons : []) as Array<{
            label?: string;
            startDate: string;
            endDate: string;
            weather: { dataSource: string; summary?: string; reason?: string };
            readiness: { gaps: string[]; covered: string[] };
          }>;

          const summaryLines = comparisons.map((c) => {
            const label = c.label || `${c.startDate} → ${c.endDate}`;
            const weatherDesc = c.weather.summary || c.weather.reason || c.weather.dataSource;
            return `${label}: [${c.weather.dataSource}] ${weatherDesc}`;
          });

          await logAgentAction(
            "compare_trip_dates",
            `Agent compared ${comparisons.length} candidate date ranges: ${summaryLines.join(" | ")}`,
          );

          return {
            success: true,
            location: data.location,
            comparisonCount: comparisons.length,
            comparisons: data.comparisons,
          };
        } catch (error) {
          console.error("[fieldward:mcp] compare_trip_dates failed", error);
          return { success: false, error: "Date comparison failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "propose_trip_brief_update",
      description:
        "Suggest an update to the trip brief — e.g. you learned the trip is three days instead of one, winter gear matters, or the budget changed. This lands as a PENDING suggestion the human must accept or dismiss; it never overwrites what they wrote. Send only the fields that changed. budget is in DOLLARS (pass 0 to propose clearing it); tripDescription is a short phrase (pass an empty string to propose clearing it).",
      inputSchema: {
        type: "object",
        properties: {
          tripDescription: {
            type: "string",
            description: "Proposed trip description, e.g. '3-day winter backpacking trip in the Cascades'",
          },
          budget: { type: "number", description: "Proposed budget in dollars, e.g. 400 (0 proposes clearing it)" },
        },
      },
      execute: async (input) => {
        logToolCall("propose_trip_brief_update", input);
        try {
          const tripDescription =
            typeof input.tripDescription === "string" ? input.tripDescription.trim().slice(0, 500) : undefined;
          let budgetDollars: number | undefined;
          if (typeof input.budget === "number") {
            if (!Number.isFinite(input.budget) || input.budget < 0 || input.budget > 1_000_000) {
              return { success: false, error: 'Input "budget" must be a dollar amount between 0 and 1,000,000.' };
            }
            budgetDollars = input.budget;
          }
          if (tripDescription === undefined && budgetDollars === undefined) {
            return { success: false, error: "Provide at least one of tripDescription or budget." };
          }
          const { ok, data } = await callJsonApi("/api/brief/propose", {
            method: "POST",
            body: JSON.stringify({
              sessionId: getSessionId(),
              ...(tripDescription !== undefined ? { tripDescription } : {}),
              ...(budgetDollars !== undefined ? { budget: budgetDollars } : {}),
            }),
          });
          if (!ok) return { success: false, error: apiError(data, "Couldn't propose that brief update.") };
          await logAgentAction(
            "propose_trip_brief_update",
            "Agent suggested a trip-brief change — accept or dismiss",
          );
          notifyBriefChanged();
          return {
            success: true,
            brief: data.brief,
            note: "Pending until the human accepts or dismisses it in the board UI.",
          };
        } catch (error) {
          console.error("[fieldward:mcp] propose_trip_brief_update failed", error);
          return { success: false, error: "Brief update failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "propose_day_block",
      description:
        "Propose adding a new day block to the itinerary with a trail title and optional distance/elevation details and reasoning (e.g. 'Day 1 — Trailhead to Cairn Lake', '6.2 mi · 1,900 ft gain · Alpine meadow camp'). This lands as a PENDING suggestion the human accepts (with details), adds as a blank day, or dismisses in the board UI; it never places the card directly. Use this to help the human structure their route day-by-day without forcing unapproved itinerary onto their board.",
      inputSchema: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Title of the day block, e.g. 'Day 1 — Trailhead to Cairn Lake'",
          },
          text: {
            type: "string",
            description: "Optional trail segment summary, distance, or elevation notes, e.g. '6.2 mi · 1,900 ft gain · Alpine meadow camp'",
          },
          note: {
            type: "string",
            description: "Optional reasoning for this itinerary day, e.g. 'Breaks up the pass ascent before tomorrow morning.'",
          },
        },
        required: ["label"],
      },
      execute: async (input) => {
        logToolCall("propose_day_block", input);
        try {
          const label = asString(input.label);
          if (label === undefined) {
            return { success: false, error: 'Input "label" is required and cannot be empty.' };
          }
          if (label.length > 120) {
            return { success: false, error: 'Input "label" must be at most 120 characters.' };
          }
          const text = asString(input.text);
          if (text !== undefined && text.length > 280) {
            return { success: false, error: 'Input "text" must be at most 280 characters.' };
          }
          const note = asString(input.note);
          if (note !== undefined && note.length > 280) {
            return { success: false, error: 'Input "note" must be at most 280 characters.' };
          }

          const { ok, status, data } = await callJsonApi("/api/board/day-block/propose", {
            method: "POST",
            body: JSON.stringify({
              sessionId: getSessionId(),
              label,
              ...(text !== undefined ? { text } : {}),
              ...(note !== undefined ? { note } : {}),
            }),
          });
          if (!ok) {
            return {
              success: false,
              error: apiError(
                data,
                status === 409 ? "This plan is locked — the board is read-only." : "Couldn't propose that day block.",
              ),
            };
          }
          const noteSuffix = note !== undefined ? ` — “${excerpt(note)}”` : "";
          await logAgentAction(
            "propose_day_block",
            `Agent proposed a day block: ${label}${noteSuffix}`,
          );
          notifyBoardChanged();
          return {
            success: true,
            proposal: data.proposal,
            note: "Pending until the human accepts or dismisses it in the board UI.",
          };
        } catch (error) {
          console.error("[fieldward:mcp] propose_day_block failed", error);
          return { success: false, error: "Day block proposal failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "suggest_day_order",
      description:
        "Suggest a new order for the human's day blocks — e.g. you realize a pass is safer before the storm window, or the lake camp makes a better first night. Pass the FULL ordered list of day-block board item ids (get_board_state lists them; their current order reads top-to-bottom, then left-to-right — that's the itinerary the export uses). This lands as a PENDING suggestion the human accepts or dismisses in the board UI; it never reorders anything itself. It works only on day blocks the human already created — you still cannot create, delete, or edit day blocks.",
      inputSchema: {
        type: "object",
        properties: {
          orderedBoardItemIds: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 20,
            description: "Every day-block board item id, in the order you propose the days should run",
          },
          note: {
            type: "string",
            description:
              "Optional first-person reasoning shown with the suggestion, e.g. 'The pass is calmer before noon — I'd put Day 2 first.'",
          },
        },
        required: ["orderedBoardItemIds"],
      },
      execute: async (input) => {
        logToolCall("suggest_day_order", input);
        try {
          const orderedIds = Array.isArray(input.orderedBoardItemIds)
            ? input.orderedBoardItemIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            : [];
          if (orderedIds.length < 2) {
            return { success: false, error: 'Input "orderedBoardItemIds" must list at least two day-block ids in the order you propose.' };
          }
          if (new Set(orderedIds).size !== orderedIds.length) {
            return { success: false, error: 'Input "orderedBoardItemIds" lists the same day block more than once.' };
          }
          const note = asString(input.note);
          if (note !== undefined && note.length > 280) {
            return { success: false, error: 'Input "note" must be at most 280 characters.' };
          }

          const { ok, status, data } = await callJsonApi("/api/board/day-order/propose", {
            method: "POST",
            body: JSON.stringify({
              sessionId: getSessionId(),
              orderedBoardItemIds: orderedIds,
              ...(note !== undefined ? { note } : {}),
            }),
          });
          if (!ok) {
            return {
              success: false,
              error: apiError(
                data,
                status === 404 ? "Every id must be a day block on this board — gear cards and unknown ids are rejected." : "Couldn't suggest that day order.",
              ),
            };
          }
          const noteSuffix = note !== undefined ? ` — “${excerpt(note)}”` : "";
          await logAgentAction(
            "suggest_day_order",
            `Agent suggested a new day order (${orderedIds.length} days, your call)${noteSuffix}`,
          );
          notifyBoardChanged();
          return {
            success: true,
            proposal: data.proposal,
            currentOrder: data.currentOrder,
            note: "Pending until the human accepts or dismisses it in the board UI.",
          };
        } catch (error) {
          console.error("[fieldward:mcp] suggest_day_order failed", error);
          return { success: false, error: "Day-order suggestion failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "check_trip_readiness",
      description:
        "Check the current board against the trip in the brief — trip type AND real weather — and report what's missing, all in one result: e.g. 'no winter-rated sleep system on the board', 'rain likely on day 2 — no board item tagged waterproof yet'. Folds in the get_weather_outlook state (real forecast or seasonal average, when the trip's place and dates are set) so weather-driven gaps sit next to the trip-type gaps instead of in a second system you have to reconcile. Read-only analysis: it never adds anything; use the gaps to frame suggestions, then let the human decide. Great before summarizing the plan or when the human asks 'what else do we need?'.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (input) => {
        logToolCall("check_trip_readiness", input);
        try {
          const sessionId = getSessionId();
          const [boardRes, briefRes, weatherRes] = await Promise.all([
            callJsonApi(`/api/board?sessionId=${encodeURIComponent(sessionId)}`),
            callJsonApi(`/api/brief?sessionId=${encodeURIComponent(sessionId)}`),
            callJsonApi(`/api/weather?sessionId=${encodeURIComponent(sessionId)}`),
          ]);
          if (!boardRes.ok) return { success: false, error: apiError(boardRes.data, "Couldn't read the board.") };

          const items = Array.isArray(boardRes.data.items) ? (boardRes.data.items as BoardLineLike[]) : [];
          const brief = (briefRes.ok ? (briefRes.data.brief ?? null) : null) as
            | { tripDescription?: string }
            | null;
          const tripDescription = typeof brief?.tripDescription === "string" ? brief.tripDescription : "";
          const outlook: WeatherOutlook =
            weatherRes.ok && weatherRes.data.outlook !== undefined
              ? (weatherRes.data.outlook as WeatherOutlook)
              : { dataSource: "unavailable", reason: "The weather outlook couldn't be loaded." };

          const base = computeTripReadiness(items, tripDescription);
          const merged = mergeReadinessWithWeather(base, outlook, items);
          const weatherLabel =
            outlook.dataSource === "forecast"
              ? "weather: real forecast"
              : outlook.dataSource === "historical-average"
                ? "weather: historical average"
                : "weather: unavailable";

          await logAgentAction(
            "check_trip_readiness",
            base.matched
              ? `Agent checked your board against ${base.trip} (${weatherLabel})`
              : `Agent checked the board (${weatherLabel}, but no trip type was set to check against)`,
          );

          if (!base.matched) {
            return {
              success: true,
              ...merged,
              hint:
                tripDescription.trim().length === 0
                  ? "No trip description is set. Ask the human about the trip (or propose one with propose_trip_brief_update), then check again."
                  : `Couldn't recognize the trip type from "${tripDescription}". Known types: ${TRIP_ARCHETYPES.map((a) => a.label).join(", ")}.`,
            };
          }
          return {
            success: true,
            ...merged,
            hint: merged.gaps.length === 0 ? "The board covers the trip — nothing missing." : undefined,
          };
        } catch (error) {
          console.error("[fieldward:mcp] check_trip_readiness failed", error);
          return { success: false, error: "Readiness check failed — the board may be unreachable." };
        }
      },
    },
    {
      name: "get_activity_log",
      description:
        "Read the board's recent activity log — newest first, both sides of the collaboration: gear the human viewed or placed, cards they moved or removed, day blocks they added, brief edits and proposal verdicts, plus every tool call you (the agent) have made. Catch up BEFORE acting: don't re-suggest gear the human just removed, build on the gear they've been eyeing, group around day blocks they just added, and respect it if they've locked the plan.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max events to return (default 20, max 100)" },
          sinceMinutes: { type: "number", description: "Only events from the last N minutes (default: no time filter)" },
        },
      },
      execute: async (input) => {
        logToolCall("get_activity_log", input);
        try {
          const limit = asPositiveInt(input.limit) ?? 20;
          const sinceMinutes = asPositiveInt(input.sinceMinutes);
          const sessionId = getSessionId();
          const params = new URLSearchParams({ sessionId, limit: String(limit) });
          if (sinceMinutes !== undefined) params.set("sinceMinutes", String(sinceMinutes));
          const { ok, data } = await callJsonApi(`/api/activity?${params.toString()}`);
          if (!ok) return { success: false, error: apiError(data, "Couldn't read the activity log.") };
          const events = Array.isArray(data.events) ? data.events : [];
          await logAgentAction(
            "get_activity_log",
            events.length > 0
              ? `Agent caught up on the activity log — ${events.length} recent event(s)`
              : "Agent caught up on the activity log — nothing new",
          );
          return { success: true, count: events.length, events };
        } catch (error) {
          console.error("[fieldward:mcp] get_activity_log failed", error);
          return { success: false, error: "Activity-log read failed — the board may be unreachable." };
        }
      },
    },
  ];
}

/**
 * Registers all Fieldward tools with a raw WebMCP model context.
 * Returns nothing; unregister each tool individually via
 * `unregisterFieldwardTools`.
 */
export async function registerFieldwardTools(modelContext: {
  registerTool: (definition: WebMCToolDefinition) => Promise<void> | void;
}): Promise<void> {
  for (const definition of buildToolDefinitions()) {
    await modelContext.registerTool(definition);
  }
}

/**
 * Unregisters every Fieldward tool — one unregisterTool(name) per tool, no
 * bulk convenience exists in the WebMCP spec.
 *
 * Some early native builds expose registerTool without unregisterTool yet;
 * when it is missing we skip gracefully (tools die with the document anyway)
 * rather than throwing from an effect cleanup.
 */
export async function unregisterFieldwardTools(modelContext: {
  registerTool: (definition: WebMCToolDefinition) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
}): Promise<void> {
  if (typeof modelContext.unregisterTool !== "function") {
    console.log("[fieldward:mcp] modelContext.unregisterTool is not available in this runtime — skipping individual unregistration.");
    return;
  }
  for (const name of FIELDWARD_TOOL_NAMES) {
    await modelContext.unregisterTool(name);
  }
}
