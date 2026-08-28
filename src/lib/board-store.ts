"use client";

import { create } from "zustand";

import { logActivity } from "@/lib/activity";
import { notifyBoardChanged, pushActivity, subscribeToBoardChanges } from "@/lib/events";
import { getSessionId } from "@/lib/session";
import type { BoardItemDTO, BoardSummary, DayBlockProposal, DayOrderProposal } from "@/lib/types";

/**
 * Client-side board state. The board lives on the server (keyed by
 * sessionId) so an external agent calling WebMCP tools mutates the exact
 * same board the UI is looking at. This store:
 *
 * - polls the board every 1.5s (cheap, no websockets needed),
 * - refreshes instantly when a WebMCP tool fires `fieldward:board-changed`,
 *   which is what makes agent placements and moves animate live on screen,
 * - exposes actions for the human UI path (addedBy: "human").
 *
 * Optimistic drags: a human drag updates the item's x/y locally on drop
 * before the server confirms, so the card never snaps back on a fast move.
 */

const POLL_INTERVAL_MS = 1500;

type BoardResponse = BoardSummary & { sessionId: string };

export type PlaceGearInput = {
  gearItemId: string;
  name?: string;
  x?: number;
  y?: number;
  quantity?: number;
  note?: string;
};

export type PlaceDayInput = {
  label: string;
  text?: string;
};

type BoardState = {
  sessionId: string | null;
  items: BoardItemDTO[];
  itemCount: number;
  gearTotalCents: number;
  gearTotalDisplay: string;
  locked: boolean;
  /** The agent's pending day-order suggestion, rendered by the workspace banner. */
  pendingDayOrder: DayOrderProposal | null;
  /** The agent's pending day-block suggestion, rendered by the workspace banner. */
  pendingDayBlock: DayBlockProposal | null;
  busyItemIds: string[];
  /** True once init() has run — guards against duplicate polling loops. */
  initialized: boolean;

  init: () => void;
  refresh: () => Promise<void>;
  /** Apply a drag's new position locally (optimistic) — no server call. */
  applyLocalMove: (boardItemId: string, x: number, y: number) => void;
  /** Local (unpersisted) edits to a day block's label — keeps typing ahead of the poll. */
  applyLocalLabelEdit: (boardItemId: string, label: string) => void;
  /** Local (unpersisted) edits to a day block's text. */
  applyLocalTextEdit: (boardItemId: string, text: string) => void;
  /** Human drag end: persist a new position. */
  moveItem: (boardItemId: string, x: number, y: number, name?: string) => Promise<void>;
  /** Human path: place gear from the tray (drag-drop or the + button). */
  placeGear: (input: PlaceGearInput) => Promise<boolean>;
  /** Human path: add a day/route block. */
  placeDay: (input: PlaceDayInput) => Promise<boolean>;
  /** Human path: change a gear card's quantity. */
  updateQuantity: (boardItemId: string, quantity: number) => Promise<void>;
  /** Human path: edit a day block's label/text. */
  updateDay: (boardItemId: string, label: string, text: string) => Promise<void>;
  removeItem: (boardItemId: string) => Promise<void>;
  /** Human answer to a pending day-order proposal (Accept/Dismiss banner). */
  resolveDayOrder: (decision: "accept" | "dismiss") => Promise<boolean>;
  /** Human answer to a pending day-block proposal (Accept/Add Blank/Dismiss banner). */
  resolveDayBlock: (decision: "accept" | "blank" | "dismiss") => Promise<boolean>;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshingBoard = false;
let latestBoardVersion = 0;

/**
 * Board item ids with un-persisted local edits (day blocks mid-typing). The
 * poll loop must not clobber these — see refresh(). Cleared once the edit
 * is saved (or the card is removed).
 */
const locallyEditedIds = new Set<string>();

function boardChanged(a: BoardItemDTO, b: BoardItemDTO): boolean {
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.quantity !== b.quantity ||
    a.note !== b.note ||
    a.label !== b.label ||
    a.text !== b.text ||
    a.addedBy !== b.addedBy ||
    a.name !== b.name
  );
}

export const useBoardStore = create<BoardState>((set, get) => ({
  sessionId: null,
  items: [],
  itemCount: 0,
  gearTotalCents: 0,
  gearTotalDisplay: "$0.00",
  locked: false,
  pendingDayOrder: null,
  pendingDayBlock: null,
  busyItemIds: [],
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ initialized: true, sessionId: getSessionId() });

    void get().refresh();

    if (pollTimer === null) {
      pollTimer = setInterval(() => {
        // Skip polling while the tab is hidden — the store also refreshes on
        // focus and whenever a WebMCP tool reports a board change.
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void get().refresh();
      }, POLL_INTERVAL_MS);
    }

    subscribeToBoardChanges(() => void get().refresh());

    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => void get().refresh());
    }
  },

  refresh: async () => {
    const sessionId = get().sessionId ?? getSessionId();
    if (sessionId.length === 0 || isRefreshingBoard) return;
    isRefreshingBoard = true;
    const reqVersion = ++latestBoardVersion;

    try {
      const response = await fetch(`/api/board?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (!response.ok || reqVersion < latestBoardVersion) return;
      const board: BoardResponse = await response.json();
      if (reqVersion < latestBoardVersion) return;

      // Only overwrite state when the payload actually differs, so polling
      // does not re-render (or re-trigger entry animations) on every tick.
      // Items with un-persisted local edits (a day block mid-typing) are
      // protected: the poll keeps the local version until it's saved.
      const current = get();
      const hasLocalEdits = current.items.some((item) => locallyEditedIds.has(item.id));
      const effectiveBoard = hasLocalEdits
        ? board.items.map((incoming) => {
            const local = current.items.find((item) => item.id === incoming.id);
            return local !== undefined && locallyEditedIds.has(local.id) ? local : incoming;
          })
        : board.items;
      const dayOrderChanged =
        JSON.stringify(current.pendingDayOrder) !== JSON.stringify(board.pendingDayOrder);
      const dayBlockChanged =
        JSON.stringify(current.pendingDayBlock) !== JSON.stringify(board.pendingDayBlock);
      if (
        current.locked !== board.locked ||
        dayOrderChanged ||
        dayBlockChanged ||
        current.items.length !== board.items.length ||
        current.items.some((item, i) => item.id !== effectiveBoard[i]?.id || boardChanged(item, effectiveBoard[i]))
      ) {
        set({
          sessionId,
          items: effectiveBoard,
          itemCount: board.itemCount,
          gearTotalCents: board.gearTotalCents,
          gearTotalDisplay: board.gearTotalDisplay,
          locked: board.locked,
          pendingDayOrder: board.pendingDayOrder,
          pendingDayBlock: board.pendingDayBlock,
        });
      } else if (current.sessionId !== sessionId) {
        set({ sessionId });
      }
    } catch {
      // Network hiccup — the next poll will recover.
    } finally {
      isRefreshingBoard = false;
    }
  },

  applyLocalMove: (boardItemId, x, y) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === boardItemId ? { ...item, x, y } : item)),
    }));
  },

  applyLocalLabelEdit: (boardItemId, label) => {
    locallyEditedIds.add(boardItemId);
    set((state) => ({
      items: state.items.map((item) =>
        item.id === boardItemId && item.itemType === "day" ? { ...item, label } : item,
      ),
    }));
  },

  applyLocalTextEdit: (boardItemId, text) => {
    locallyEditedIds.add(boardItemId);
    set((state) => ({
      items: state.items.map((item) =>
        item.id === boardItemId && item.itemType === "day" ? { ...item, text } : item,
      ),
    }));
  },

  moveItem: async (boardItemId, x, y, name) => {
    get().applyLocalMove(boardItemId, x, y);
    latestBoardVersion++;
    try {
      const response = await fetch("/api/board/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardItemId, x, y }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't move that card." });
        await get().refresh();
      } else {
        latestBoardVersion++;
        if (name !== undefined) {
          void logActivity({ actor: "human", action: "move_board_item", detail: `You moved ${name}.`, quiet: true });
        }
      }
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
      await get().refresh();
    }
  },

  placeGear: async (input) => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const response = await fetch("/api/board/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          itemType: "gear",
          gearItemId: input.gearItemId,
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          addedBy: "human",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't place that item." });
        return false;
      }
      // Recorded in the shared activity log — the agent can read what you did
      // (get_activity_log) before it acts next.
      const name = input.name ?? "an item";
      await logActivity({ actor: "human", action: "place_gear", detail: `You placed ${name} on the board.` });
      await get().refresh();
      return true;
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
      return false;
    }
  },

  placeDay: async (input) => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const response = await fetch("/api/board/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          itemType: "day",
          label: input.label,
          ...(input.text !== undefined ? { text: input.text } : {}),
          addedBy: "human",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't add that day block." });
        return false;
      }
      await logActivity({ actor: "human", action: "place_day", detail: `You added a day block — ${input.label}.` });
      await get().refresh();
      return true;
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
      return false;
    }
  },

  updateQuantity: async (boardItemId, quantity) => {
    const name = get().items.find((item) => item.id === boardItemId)?.name ?? "an item";
    set((state) => ({ busyItemIds: [...state.busyItemIds, boardItemId] }));
    try {
      const response = await fetch("/api/board/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardItemId, quantity }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't update that card." });
      } else {
        await logActivity({
          actor: "human",
          action: "update_quantity",
          detail: `You set ${name} to ×${quantity}.`,
          quiet: true,
        });
      }
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
    } finally {
      set((state) => ({ busyItemIds: state.busyItemIds.filter((id) => id !== boardItemId) }));
      await get().refresh();
    }
  },

  updateDay: async (boardItemId, label, text) => {
    set((state) => ({ busyItemIds: [...state.busyItemIds, boardItemId] }));
    try {
      const response = await fetch("/api/board/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardItemId, label, text }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't update that day block." });
      } else {
        locallyEditedIds.delete(boardItemId);
        await logActivity({
          actor: "human",
          action: "update_day",
          detail: `You edited a day block — ${label}.`,
          quiet: true,
        });
      }
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
    } finally {
      set((state) => ({ busyItemIds: state.busyItemIds.filter((id) => id !== boardItemId) }));
      await get().refresh();
    }
  },

  removeItem: async (boardItemId) => {
    const item = get().items.find((entry) => entry.id === boardItemId);
    locallyEditedIds.delete(boardItemId);
    set((state) => ({ busyItemIds: [...state.busyItemIds, boardItemId] }));
    try {
      const response = await fetch(`/api/board/${encodeURIComponent(boardItemId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't remove that card." });
      } else {
        const what = item?.itemType === "day" ? `the ${item.label ?? "day"} block` : item?.name ?? "an item";
        await logActivity({
          actor: "human",
          action: "remove_board_item",
          detail: `You removed ${what} from the board.`,
        });
      }
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
    } finally {
      set((state) => ({ busyItemIds: state.busyItemIds.filter((id) => id !== boardItemId) }));
      await get().refresh();
    }
  },

  resolveDayOrder: async (decision) => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const response = await fetch("/api/board/day-order/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, decision }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        // A stale suggestion (day blocks changed) is cleared server-side —
        // refresh either way so the banner matches reality.
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't resolve that day order." });
        await get().refresh();
        return false;
      }
      await logActivity({
        actor: "human",
        action: "resolve_day_order_proposal",
        detail:
          decision === "accept"
            ? "You accepted the agent's day order."
            : "You dismissed the agent's day order.",
        quiet: true, // the cards visibly rearrange (or don't) — that's the feedback
      });
      await get().refresh();
      return true;
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
      return false;
    }
  },

  resolveDayBlock: async (decision) => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const response = await fetch("/api/board/day-block/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, decision }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        pushActivity({ kind: "error", message: body?.error ?? "Couldn't resolve that day block proposal." });
        await get().refresh();
        return false;
      }
      await logActivity({
        actor: "human",
        action: "resolve_day_block_proposal",
        detail:
          decision === "accept"
            ? "You accepted the agent's day block proposal."
            : decision === "blank"
              ? "You added the proposed day as a blank block."
              : "You dismissed the agent's day block proposal.",
        quiet: true,
      });
      await get().refresh();
      return true;
    } catch {
      pushActivity({ kind: "error", message: "Couldn't reach the board. Try again." });
      return false;
    }
  },
}));

/** Fire-and-forget nudge used after human actions so other UI surfaces sync. */
export function nudgeBoardRefresh(): void {
  notifyBoardChanged();
}
